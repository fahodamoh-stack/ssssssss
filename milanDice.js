"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanDice(client, db) {
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568543923964616705>";
  const MIN_BET = 100;
  const MAX_BET = 100_000;
  const MAX_BALANCE = 1_000_000_000;

  for (const table of ["fizzy_wallets", "fizzy_transactions"]) {
    const found = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);

    if (!found) {
      throw new Error(`DICE requires ${table}. Load economy first.`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_dice_rounds (
      message_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      stake INTEGER NOT NULL,
      player_roll INTEGER NOT NULL,
      bot_roll INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const findRound = db.prepare(
    "SELECT message_id FROM milan_dice_rounds WHERE message_id = ?"
  );

  const ensureWallet = db.prepare(`
    INSERT OR IGNORE INTO fizzy_wallets (guild, user)
    VALUES (?, ?)
  `);

  const getWallet = db.prepare(`
    SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?
  `);

  const changeBalance = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ?
  `);

  const saveRound = db.prepare(`
    INSERT INTO milan_dice_rounds
      (message_id, guild, user, stake, player_roll, bot_roll,
       outcome, delta, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      ensureWallet.run(guild, user);
      const wallet = getWallet.get(guild, user);

      if (wallet.balance < stake) {
        db.exec("ROLLBACK");
        return { insufficient: true };
      }

      // Check the potential win before rolling.
      if (wallet.balance + stake > MAX_BALANCE) {
        db.exec("ROLLBACK");
        return { limit: true };
      }

      const playerRoll = randomInt(1, 7);
      const botRoll = randomInt(1, 7);

      const outcome = playerRoll > botRoll
        ? "win"
        : playerRoll < botRoll ? "loss" : "draw";

      const delta = outcome === "win"
        ? stake
        : outcome === "loss" ? -stake : 0;

      const now = Date.now();
      const balance = wallet.balance + delta;

      changeBalance.run(delta, guild, user);

      saveRound.run(
        messageId, guild, user, stake,
        playerRoll, botRoll, outcome, delta, balance, now
      );

      record.run(guild, user, `dice_${outcome}`, stake, now);
      db.exec("COMMIT");

      return { playerRoll, botRoll, outcome, delta, balance };
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
          { type: 10, content: "### MILAN • DICE" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function logRound(guild, message, stake, result) {
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);

      if (!channel?.isTextBased() || !channel.send) {
        console.warn("DICE: coin log channel unavailable.");
        return;
      }

      await channel.send(panel(
        `**Coin transaction**\n` +
        `Member: <@${message.author.id}>\n` +
        `Game: \`${message.id}\`\n` +
        `Stake: ${COIN} **${stake.toLocaleString("en-US")} Coin**\n` +
        `Rolls: **${result.playerRoll} / ${result.botRoll}**\n` +
        `Result: **${result.outcome}**\n` +
        `Change: **${result.delta >= 0 ? "+" : ""}${result.delta} Coin**\n` +
        `Saved balance: **${result.balance.toLocaleString("en-US")} Coin**`
      ));
    } catch (error) {
      console.error("DICE LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const parts = (message.content || "").trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== ".dice") return;

    const reply = text => message.reply({
      ...panel(text),
      failIfNotExists: false
    });

    if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[1])) {
      await reply(
        `Usage: \`.dice 100\`\n` +
        `Stake: **${MIN_BET}–${MAX_BET.toLocaleString("en-US")} Coin**.`
      ).catch(console.error);
      return;
    }

    const stake = Number(parts[1]);

    if (!Number.isSafeInteger(stake) ||
        stake < MIN_BET || stake > MAX_BET) {
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
      console.error("DICE TRANSACTION ERROR:", error);
      await reply("Could not complete the game. Check the bot log.")
        .catch(console.error);
      return;
    }

    if (result.duplicate) return;

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
      ? "You win"
      : result.outcome === "loss" ? "You lose" : "Draw";

    const change = `${result.delta >= 0 ? "+" : ""}${result.delta}`;

    // The transaction is already committed; never replay it if sending fails.
    await reply(
      `Your roll: **${result.playerRoll}**\n` +
      `Bot roll: **${result.botRoll}**\n\n` +
      `**${label}** — ${COIN} **${change} Coin**\n` +
      `${COIN} Saved balance: **${result.balance.toLocaleString("en-US")} Coin**`
    ).catch(error => console.error("DICE DISPLAY ERROR:", error));

    await logRound(message.guild, message, stake, result);
  });

  console.log("MILAN DICE LOADED");
};