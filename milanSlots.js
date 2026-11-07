"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanSlots(client, db) {
  const MIN_BET = 100;
  const MAX_BET = 10_000;
  const MAX_BALANCE = 1_000_000_000;
  const COOLDOWN_MS = 10_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568543923964616705>";
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
      ? "You win"
      : result.outcome === "loss" ? "You lose" : "Draw — stake returned";

    const change = `${result.delta >= 0 ? "+" : ""}${result.delta}`;

    // The transaction is already committed; a failed reply must not replay it.
    await reply(
      `**[ ${result.symbols.join(" | ")} ]**\n\n` +
      `**${label}** — ${COIN} **${change} Coin**\n` +
      `${COIN} Saved balance: **${result.balance.toLocaleString("en-US")} Coin**`
    ).catch(error => console.error("SLOTS DISPLAY ERROR:", error));

    await logRound(message, stake, result);
  });

  console.log("MILAN SLOTS LOADED");
};