"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanSlots(client, db) {
  const MIN_BET = 100;
  const MAX_BET = 10_000;
  const MAX_BALANCE = 1_000_000_000;
  const COOLDOWN_MS = 10_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568544045041586246>";
  const SYMBOLS = ["Cherry", "Star", "Diamond", "Seven"];

  for (const table of ["fizzy_wallets", "fizzy_transactions"]) {
    if (!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table)) {
      throw new Error(`Slots requires ${table}. Load economy first.`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_slots_rounds (
      message_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      stake INTEGER NOT NULL,
      symbols TEXT NOT NULL,
      outcome TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milan_slots_cooldowns (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      PRIMARY KEY (guild, user)
    );
  `);

  const findRound = db.prepare(
    "SELECT message_id FROM milan_slots_rounds WHERE message_id = ?"
  );
  const ensureWallet = db.prepare(
    "INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)"
  );
  const getWallet = db.prepare(
    "SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?"
  );
  const getCooldown = db.prepare(
    "SELECT played_at FROM milan_slots_cooldowns WHERE guild = ? AND user = ?"
  );
  const setCooldown = db.prepare(`
    INSERT INTO milan_slots_cooldowns (guild, user, played_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild, user) DO UPDATE SET played_at = excluded.played_at
  `);
  const changeBalance = db.prepare(
    "UPDATE fizzy_wallets SET balance = balance + ? WHERE guild = ? AND user = ?"
  );
  const saveRound = db.prepare(`
    INSERT INTO milan_slots_rounds
      (message_id, guild, user, stake, symbols, outcome, delta, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, NULL, ?, ?, ?)
  `);

  function play(messageId, guild, user, stake) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (findRound.get(messageId)) {
        db.exec("ROLLBACK");
        return { duplicate: true };
      }

      const now = Date.now();
      const previous = getCooldown.get(guild, user);
      const wait = previous ? previous.played_at + COOLDOWN_MS - now : 0;

      if (wait > 0) {
        db.exec("ROLLBACK");
        return { wait };
      }

      ensureWallet.run(guild, user);
      const wallet = getWallet.get(guild, user);

      if (wallet.balance < stake) {
        db.exec("ROLLBACK");
        return { insufficient: true };
      }

      // Maximum possible net win is twice the stake.
      if (wallet.balance + stake * 2 > MAX_BALANCE) {
        db.exec("ROLLBACK");
        return { limit: true };
      }

      const symbols = Array.from(
        { length: 3 },
        () => SYMBOLS[randomInt(SYMBOLS.length)]
      );
      const distinct = new Set(symbols).size;
      const outcome = distinct === 1 ? "win" : distinct === 2 ? "draw" : "loss";
      const delta = outcome === "win" ? stake * 2 : outcome === "loss" ? -stake : 0;
      const balance = wallet.balance + delta;

      changeBalance.run(delta, guild, user);
      saveRound.run(
        messageId, guild, user, stake, JSON.stringify(symbols),
        outcome, delta, balance, now
      );
      setCooldown.run(guild, user, now);
      record.run(guild, user, `slots_${outcome}`, stake, now);

      db.exec("COMMIT");
      return { symbols, outcome, delta, balance };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function panel(text) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN • SLOTS" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function logRound(message, stake, result) {
    try {
      const channel = await message.guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) {
        console.warn("SLOTS: coin log channel unavailable.");
        return;
      }

      await channel.send(panel(
        `**Coin transaction**\n` +
        `Member: <@${message.author.id}>\n` +
        `Round: \`${message.id}\`\n` +
        `Stake: ${COIN} **${stake.toLocaleString("en-US")} Coin**\n` +
        `Symbols: **${result.symbols.join(" | ")}**\n` +
        `Result: **${result.outcome}**\n` +
        `Change: **${result.delta >= 0 ? "+" : ""}${result.delta} Coin**\n` +
        `Saved balance: **${result.balance.toLocaleString("en-US")} Coin**`
      ));
    } catch (error) {
      console.error("SLOTS LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const parts = (message.content || "").trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== ".slots") return;

    const reply = text => message.reply({
      ...panel(text),
      failIfNotExists: false
    });

    if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[1])) {
      await reply(
        `Usage: \`.slots 100\`\n` +
        `Stake: **${MIN_BET}–${MAX_BET.toLocaleString("en-US")} Coin**.`
      ).catch(console.error);
      return;
    }

    const stake = Number(parts[1]);
    if (!Number.isSafeInteger(stake) || stake < MIN_BET || stake > MAX_BET) {
      await reply(
        `Stake must be between **${MIN_BET}** and ` +
        `**${MAX_BET.toLocaleString("en-US")} Coin**.`
      ).catch(console.error);
      return;
    }

    let result;
    try {
      result = play(message.id, message.guild.id, message.author.id, stake);
    } catch (error) {
      console.error("SLOTS TRANSACTION ERROR:", error);
      await reply("Could not complete the game. Check the bot log.")
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
      await reply("Your saved Coin balance is not enough for this stake.")
        .catch(console.error);
      return;
    }

    if (result.limit) {
      await reply("A possible win would exceed the balance limit.")
        .catch(console.error);
      return;
    }

    const label = result.outcome === "win"
      ? "TRIPLE MATCH · WIN"
      : result.outcome === "loss" ? "NO MATCH · LOSS" : "DOUBLE MATCH · DRAW";
    const change = `${result.delta >= 0 ? "+" : ""}${result.delta.toLocaleString("en-US")}`;

    // Settlement is already committed before this display.
    await reply(
      `**A R C A D E  /  S L O T S**\n\n` +
      `**[ ${result.symbols.join("  |  ")} ]**\n\n` +
      `— **${label}** —\n` +
      `Player: <@${message.author.id}>\n` +
      `Stake: ${COIN} **${stake.toLocaleString("en-US")} Coin**\n` +
      `Net change: ${COIN} **${change} Coin**\n` +
      `Balance after round: ${COIN} **${result.balance.toLocaleString("en-US")} Coin**\n` +
      `Round: \`${message.id}\``
    ).catch(error => console.error("SLOTS DISPLAY ERROR:", error));

    await logRound(message, stake, result);
  });

  // MILAN 777: separate game, same wallet; existing .slots is unchanged.
  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_777_rounds (
      message_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      stake INTEGER NOT NULL,
      symbols TEXT NOT NULL,
      outcome TEXT NOT NULL,
      virtual INTEGER NOT NULL,
      virtual_delta INTEGER NOT NULL,
      wallet_delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS milan_777_cooldowns (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      PRIMARY KEY (guild, user)
    );
  `);

  const sevenFind = db.prepare(
    "SELECT message_id FROM milan_777_rounds WHERE message_id = ?"
  );
  const sevenCooldown = db.prepare(
    "SELECT played_at FROM milan_777_cooldowns WHERE guild = ? AND user = ?"
  );
  const sevenSetCooldown = db.prepare(`
    INSERT INTO milan_777_cooldowns (guild, user, played_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild, user) DO UPDATE SET played_at = excluded.played_at
  `);
  const sevenSave = db.prepare(`
    INSERT INTO milan_777_rounds
      (message_id, guild, user, stake, symbols, outcome, virtual,
       virtual_delta, wallet_delta, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const SEVEN_SYMBOLS = [
    "\u{1F352}", "\u{1F34B}", "\u{1F347}", "\u{1F349}",
    "\u2B50", "\u{1F48E}", "7\uFE0F\u20E3"
  ];
  const sevenActive = new Set();

  function playSeven(messageId, guild, user, stake, unlimited) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (sevenFind.get(messageId)) {
        db.exec("ROLLBACK");
        return { duplicate: true };
      }

      const now = Date.now();
      const previous = sevenCooldown.get(guild, user);
      const wait = previous ? previous.played_at + 10_000 - now : 0;
      if (wait > 0) {
        db.exec("ROLLBACK");
        return { wait };
      }

      ensureWallet.run(guild, user);
      const balanceBefore = getWallet.get(guild, user).balance;

      if (!unlimited && balanceBefore < stake) {
        db.exec("ROLLBACK");
        return { insufficient: true };
      }
      if (!unlimited && balanceBefore + stake * 2 > MAX_BALANCE) {
        db.exec("ROLLBACK");
        return { limit: true };
      }

      const symbols = Array.from(
        { length: 3 },
        () => SEVEN_SYMBOLS[randomInt(SEVEN_SYMBOLS.length)]
      );
      const distinct = new Set(symbols).size;
      const outcome = distinct === 1 ? "JACKPOT" :
        distinct === 2 ? "SMALL WIN" : "LOSS";
      const delta = distinct === 1 ? stake * 2 :
        distinct === 2 ? Math.floor(stake / 2) : -stake;
      const walletDelta = unlimited ? 0 : delta;
      const balance = balanceBefore + walletDelta;

      if (!unlimited) changeBalance.run(walletDelta, guild, user);
      sevenSave.run(
        messageId, guild, user, stake, JSON.stringify(symbols), outcome,
        unlimited ? 1 : 0, delta, walletDelta, balance, now
      );
      sevenSetCooldown.run(guild, user, now);
      record.run(
        guild, user,
        unlimited ? "777_virtual" : "777_" + outcome.toLowerCase().replace(" ", "_"),
        Math.abs(walletDelta), now
      );

      db.exec("COMMIT");
      return { symbols, outcome, delta, balance, unlimited };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function sevenPanel(text) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN | 777" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function sevenLog(message, stake, result) {
    try {
      const channel = await message.guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;

      await channel.send(sevenPanel(
        `**777 TRANSACTION**\n` +
        `Member: <@${message.author.id}>\n` +
        `Round: \`${message.id}\`\n` +
        `Stake: ${COIN} **${stake} Coin**\n` +
        `Reels: ${result.symbols.join(" | ")}\n` +
        `Outcome: **${result.outcome}**\n` +
        `Game result: **${result.delta >= 0 ? "+" : ""}${result.delta} Coin**` +
        (result.unlimited ? " (virtual)\nWallet change: **0 Coin**\n" : "\n") +
        `Saved balance: **${result.balance} Coin**`
      ));
    } catch (error) {
      console.error("777 LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const parts = (message.content || "").trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== ".777") return;

    const reply = text => message.reply({
      ...sevenPanel(text),
      failIfNotExists: false
    });

    if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[1])) {
      await reply("Usage: `.777 100` — stake 100 to 10,000 Coin.")
        .catch(console.error);
      return;
    }

    const stake = Number(parts[1]);
    if (!Number.isSafeInteger(stake) || stake < 100 || stake > 10_000) {
      await reply("Stake must be between **100** and **10,000 Coin**.")
        .catch(console.error);
      return;
    }

    const key = `${message.guild.id}:${message.author.id}`;
    if (sevenActive.has(key)) {
      await reply("Your previous 777 spin is still being processed.")
        .catch(console.error);
      return;
    }

    sevenActive.add(key);
    try {
      const member = await message.guild.members.fetch({
        user: message.author.id,
        force: true
      }).catch(() => null);

      if (!member) {
        await reply("Could not verify your roles. Please try again.")
          .catch(console.error);
        return;
      }

      let result;
      try {
        result = playSeven(
          message.id,
          message.guild.id,
          message.author.id,
          stake,
          member.roles.cache.has("1568641134220017774")
        );
      } catch (error) {
        console.error("777 TRANSACTION ERROR:", error);
        await reply("Could not complete the spin. Check the bot console.")
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

      const sign = result.delta >= 0 ? "+" : "";
      const change = `${sign}${result.delta.toLocaleString("en-US")}`;
      const finalText =
        `**[ ${result.symbols.join("  |  ")} ]**\n\n` +
        `**${result.outcome}**\n` +
        `Player: <@${message.author.id}>\n` +
        `Stake: ${COIN} **${stake.toLocaleString("en-US")} Coin**\n` +
        (result.unlimited
          ? `Virtual result: ${COIN} **${change} Coin**\n` +
            `Balance: **\u221e** — saved balance unchanged.\n`
          : `Net change: ${COIN} **${change} Coin**\n` +
            `Saved balance: ${COIN} **${result.balance.toLocaleString("en-US")} Coin**\n`) +
        `Round: \`${message.id}\``;

      // Settlement has committed; display errors must never replay the spin.
      let sent;
      try {
        sent = await reply(
          `**[ ${SEVEN_SYMBOLS[0]}  |  ${SEVEN_SYMBOLS[1]}  |  ${SEVEN_SYMBOLS[2]} ]**` +
          `\nSpinning...\nRound: \`${message.id}\``
        );

        for (let locked = 1; locked <= 3; locked++) {
          await new Promise(resolve => setTimeout(resolve, 650));
          const reels = result.symbols.map((symbol, index) =>
            index < locked
              ? symbol
              : SEVEN_SYMBOLS[randomInt(SEVEN_SYMBOLS.length)]
          );

          await sent.edit(sevenPanel(
            locked === 3
              ? finalText
              : `**[ ${reels.join("  |  ")} ]**\nSpinning...\nRound: \`${message.id}\``
          ));
        }
      } catch (error) {
        console.error("777 DISPLAY ERROR:", error);
        if (sent) {
          await sent.edit(sevenPanel(finalText)).catch(fallbackError =>
            console.error("777 FINAL EDIT ERROR:", fallbackError)
          );
        }
      }
      await sevenLog(message, stake, result);
    } finally {
      sevenActive.delete(key);
    }
  });

  console.log("MILAN 777 LOADED");
  console.log("MILAN SLOTS LOADED");
};