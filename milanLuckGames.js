"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");
const renderRoulette = require("./milanRouletteAnimation");

module.exports = function registerLuckGames(client, db) {
  const MIN = 100;
  const MAX = 10_000;
  const MAX_BALANCE = 1_000_000_000;
  const COOLDOWN = 10_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568544045041586246>";

  for (const table of ["fizzy_wallets", "fizzy_transactions"]) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!exists) {
      throw new Error(`Luck games require ${table}; load economy first.`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_luck_rounds (
      message_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      game TEXT NOT NULL,
      stake INTEGER NOT NULL,
      detail TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milan_luck_cooldowns (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      game TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      PRIMARY KEY (guild, user, game)
    );
  `);

  const findRound = db.prepare(
    "SELECT 1 FROM milan_luck_rounds WHERE message_id = ?"
  );
  const ensure = db.prepare(
    "INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)"
  );
  const wallet = db.prepare(
    "SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?"
  );
  const cooldown = db.prepare(`
    SELECT played_at FROM milan_luck_cooldowns
    WHERE guild = ? AND user = ? AND game = ?
  `);
  const setCooldown = db.prepare(`
    INSERT INTO milan_luck_cooldowns (guild, user, game, played_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild, user, game)
    DO UPDATE SET played_at = excluded.played_at
  `);
  const change = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ?
  `);
  const save = db.prepare(`
    INSERT INTO milan_luck_rounds
      (message_id, guild, user, game, stake, detail, delta, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, NULL, ?, ?, ?)
  `);

  function play(id, guild, user, game, stake, choice, unlimited) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (findRound.get(id)) {
        db.exec("ROLLBACK");
        return { duplicate: true };
      }

      const now = Date.now();
      const last = cooldown.get(guild, user, game);
      const wait = last ? last.played_at + COOLDOWN - now : 0;
      if (wait > 0) {
        db.exec("ROLLBACK");
        return { wait };
      }

      ensure.run(guild, user);
      const current = wallet.get(guild, user).balance;
      if (!unlimited && current < stake) {
        db.exec("ROLLBACK");
        return { insufficient: true };
      }

      // Reject before drawing if the largest possible win exceeds the cap.
      const maxNetWin = game === "roulette"
        ? (choice === "green" ? stake * 14 : stake)
        : stake * 2;

      if (!unlimited && current + maxNetWin > MAX_BALANCE) {
        db.exec("ROLLBACK");
        return { limit: true };
      }

      let detail;
      let delta;

      if (game === "roulette") {
        // European roulette: one green zero, 18 red and 18 black pockets.
        const number = randomInt(37);
        const redNumbers = new Set([
          1, 3, 5, 7, 9, 12, 14, 16, 18,
          19, 21, 23, 25, 27, 30, 32, 34, 36
        ]);
        const color = number === 0 ? "green" : redNumbers.has(number) ? "red" : "black";
        const won = color === choice;
        delta = won ? stake * (color === "green" ? 14 : 1) : -stake;
        detail = `Number ${number} • ${color} • choice ${choice}`;
      } else {
        // Every entry has equal probability.
        const percentages = [0, 50, 100, 200, 300];
        const percentage = percentages[randomInt(percentages.length)];
        const payout = Math.floor(stake * percentage / 100);
        delta = payout - stake;
        detail = `Box payout ${percentage}% • ${payout} Coin`;
      }

      const balance = unlimited ? current : current + delta;
      if (!unlimited) change.run(delta, guild, user);

      // Store actual wallet change as zero for virtual rounds.
      // Preserve the virtual outcome in the detail and transaction kind.
      const savedDetail = unlimited
        ? `${detail} • unlimited virtual delta ${delta}`
        : detail;
      save.run(id, guild, user, game, stake, savedDetail, unlimited ? 0 : delta, balance, now);
      setCooldown.run(guild, user, game, now);

      const outcome = delta > 0 ? "win" : delta < 0 ? "loss" : "draw";
      record.run(
        guild, user,
        unlimited ? `roulette_unlimited_${outcome}` : `${game}_${outcome}`,
        Math.abs(delta), now
      );

      db.exec("COMMIT");
      return { detail, delta, balance, unlimited };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function panel(title, text) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: `### MILAN • ${title}` },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function logRound(message, game, stake, result) {
    try {
      const channel = await message.guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) {
        console.warn("LUCK GAMES: coin log channel unavailable.");
        return;
      }

      const sign = result.delta >= 0 ? "+" : "";
      await channel.send(panel("COIN LOG",
        `**${game.toUpperCase()}**\n` +
        `Member: <@${message.author.id}>\n` +
        `Round: \`${message.id}\`\n` +
        `Stake: ${COIN} **${stake} Coin**\n` +
        `${result.detail}\n` +
        (result.unlimited
          ? `Virtual outcome: **${sign}${result.delta} Coin**; wallet change: **0 Coin**\n`
          : `Change: **${sign}${result.delta} Coin**\n`) +
        `Saved balance: **${result.balance} Coin**`
      ));
    } catch (error) {
      console.error("LUCK GAMES LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const parts = (message.content || "").trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    if (command !== ".roulette" && command !== ".box") return;

    const game = command === ".roulette" ? "roulette" : "box";
    const title = game.toUpperCase();
    const reply = text => message.reply({
      ...panel(title, text),
      failIfNotExists: false
    });

    const validCount = game === "roulette" ? parts.length === 3 : parts.length === 2;
    const choice = game === "roulette" ? parts[2]?.toLowerCase() : null;

    if (!validCount || !/^[1-9]\d*$/.test(parts[1] || "") ||
        (game === "roulette" && !["red", "black", "green"].includes(choice))) {
      await reply(
        game === "roulette"
          ? "Usage: `.roulette 100 red` — choose `red`, `black`, or `green`."
          : "Usage: `.box 100`"
      ).catch(console.error);
      return;
    }

    const stake = Number(parts[1]);
    if (!Number.isSafeInteger(stake) || stake < MIN || stake > MAX) {
      await reply(`Amount must be between **${MIN}** and **${MAX} Coin**.`)
        .catch(console.error);
      return;
    }

    let unlimited = false;
    if (game === "roulette") {
      const member = await message.guild.members.fetch({
        user: message.author.id,
        force: true
      }).catch(() => null);

      if (!member) {
        await reply("Could not verify your roles. Please try again.")
          .catch(console.error);
        return;
      }
      unlimited = member.roles.cache.has("1568641134220017774");
    }

    let result;
    try {
      result = play(message.id, message.guild.id, message.author.id, game, stake, choice, unlimited);
    } catch (error) {
      console.error("LUCK GAMES TRANSACTION ERROR:", error);
      await reply("Could not complete the game. Check the bot console.")
        .catch(console.error);
      return;
    }

    if (result.duplicate) return;
    if (result.wait) {
      await reply(`Wait **${Math.ceil(result.wait / 1000)} seconds**.`)
        .catch(console.error);
      return;
    }
    if (result.insufficient) {
      await reply("Your saved Coin balance is not enough.")
        .catch(console.error);
      return;
    }
    if (result.limit) {
      await reply("A possible win would exceed the balance limit.")
        .catch(console.error);
      return;
    }

    const outcome = result.delta > 0 ? "WIN" :
      result.delta < 0 ? "LOSS" : "DRAW";
    const sign = result.delta >= 0 ? "+" : "";
    const heading = game === "roulette"
      ? "**C A S I N O  /  R O U L E T T E**"
      : "**MYSTERY  /  LUCKY BOX**";
    const section = game === "roulette" ? "SPIN RESULT" : "BOX REVEAL";

    // Settlement is already committed. Rendering failure must not replay it.
    const resultText =
      `${heading}\n\n` +
      `— **${section}** —\n` +
      `**${result.detail}**\n\n` +
      `**${outcome}**\n` +
      `Player: <@${message.author.id}>\n` +
      `Stake: ${COIN} **${stake.toLocaleString("en-US")} Coin**\n` +
      (result.unlimited
        ? `Virtual outcome: ${COIN} **${sign}${result.delta.toLocaleString("en-US")} Coin**\n` +
          `Balance: **\u221e** — saved balance was not changed.\n`
        : `Net change: ${COIN} **${sign}${result.delta.toLocaleString("en-US")} Coin**\n` +
          `Balance after round: ${COIN} **${result.balance.toLocaleString("en-US")} Coin**\n`) +
      `Round: \`${message.id}\``;

    if (game === "roulette") {
      let gif = null;

      try {
        const match = /^Number (\d+) • (red|black|green) • choice /.exec(result.detail);
        if (!match) throw new Error("Could not read settled roulette result.");

        const number = Number(match[1]);
        gif = await renderRoulette(number);
      } catch (error) {
        console.error("ROULETTE ANIMATION ERROR:", error.message);
      }

      try {
        if (gif) {
          const payload = panel(title, resultText);
          payload.components[0].components.push({
            type: 12,
            items: [{
              media: { url: "attachment://milan-roulette.gif" }
            }]
          });

          await message.reply({
            ...payload,
            files: [{ attachment: gif, name: "milan-roulette.gif" }],
            failIfNotExists: false,
          });
        } else {
          await reply(resultText);
        }
      } catch (error) {
        console.error("LUCK GAMES DISPLAY ERROR:", error);

        // A fallback reports the already-settled result; it never plays again.
        if (gif) {
          await reply(resultText).catch(fallbackError =>
            console.error("ROULETTE FALLBACK ERROR:", fallbackError)
          );
        }
      }
    } else {
      await reply(resultText).catch(error =>
        console.error("LUCK GAMES DISPLAY ERROR:", error)
      );
    }
    await logRound(message, game, stake, result);
  });

  console.log("MILAN LUCK GAMES LOADED");
};