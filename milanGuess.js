"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanGuess(client, db) {
  const REWARD = 50;
  const MAX_BALANCE = 1_000_000_000;
  const ROUND_MS = 60_000;
  const CHANNEL_COOLDOWN_MS = 60_000;
  const GUESS_COOLDOWN_MS = 3_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568543923964616705>";

  const games = new Map();
  const lastStarted = new Map();

  for (const table of ["fizzy_wallets", "fizzy_transactions"]) {
    const found = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);

    if (!found) {
      throw new Error(`Guess Number requires ${table}. Load economy first.`);
    }
  }

  const ensure = db.prepare(`
    INSERT OR IGNORE INTO fizzy_wallets (guild, user)
    VALUES (?, ?)
  `);

  const credit = db.prepare(`
    UPDATE fizzy_wallets
    SET balance = balance + ?
    WHERE guild = ? AND user = ? AND balance + ? <= ?
  `);

  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, NULL, 'guess_number_win', ?, ?)
  `);

  function award(guildId, userId) {
    db.exec("BEGIN IMMEDIATE");

    try {
      ensure.run(guildId, userId);

      const changed = credit.run(
        REWARD, guildId, userId, REWARD, MAX_BALANCE
      );

      if (Number(changed.changes) !== 1) {
        db.exec("ROLLBACK");
        return false;
      }

      record.run(guildId, userId, REWARD, Date.now());
      db.exec("COMMIT");
      return true;
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
          { type: 10, content: "### MILAN \u2022 GUESS NUMBER" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function logWin(guild, userId, gameId) {
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) {
        console.warn("GUESS: coin log channel unavailable.");
        return;
      }

      await channel.send(panel(
        `**Guess Number reward**\n` +
        `Member: <@${userId}>\n` +
        `${COIN} Reward: **${REWARD} Coin**\n` +
        `Game: \`${gameId}\``
      ));
    } catch (error) {
      console.error("GUESS LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const content = (message.content || "").trim();
    const key = `${message.guild.id}:${message.channel.id}`;

    if (content.toLowerCase() === ".guess") {
      if (games.has(key)) {
        await message.reply({
          ...panel("A Guess Number round is already active here."),
          failIfNotExists: false
        }).catch(console.error);
        return;
      }

      const now = Date.now();
      const wait = (lastStarted.get(key) || 0) + CHANNEL_COOLDOWN_MS - now;

      if (wait > 0) {
        await message.reply({
          ...panel(`Wait **${Math.ceil(wait / 1000)} seconds** before starting another round.`),
          failIfNotExists: false
        }).catch(console.error);
        return;
      }

      // Reserve the channel before awaiting the Discord reply.
      const game = {
        id: message.id,
        number: randomInt(1, 21),
        attempts: new Map(),
        startedAt: now,
        state: "starting",
        timer: null,
        display: null
      };

      games.set(key, game);

      try {
        game.display = await message.reply({
          ...panel(
            `Guess a number from **1 to 20** by sending it in this channel.\n` +
            `First correct answer wins ${COIN} **${REWARD} Coin**.\n` +
            `Time: **60 seconds**. One guess every 3 seconds per member.`
          ),
          failIfNotExists: false
        });

        game.state = "active";
        lastStarted.set(key, Date.now());

        game.timer = setTimeout(async () => {
          if (games.get(key) !== game || game.state !== "active") return;

          game.state = "ended";
          games.delete(key);

          await game.display.edit(panel(
            `Time ended. The number was **${game.number}**.`
          )).catch(console.error);
        }, ROUND_MS);
      } catch (error) {
        if (games.get(key) === game) games.delete(key);
        console.error("GUESS START ERROR:", error);
      }

      return;
    }

    const game = games.get(key);
    if (!game || game.state !== "active") return;
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(content)) return;

    const now = Date.now();
    const lastGuess = game.attempts.get(message.author.id) || 0;
    if (now - lastGuess < GUESS_COOLDOWN_MS) return;

    game.attempts.set(message.author.id, now);

    if (Number(content) !== game.number) return;

    // Lock synchronously before any await.
    game.state = "settling";
    clearTimeout(game.timer);
    games.delete(key);

    let paid;
    try {
      paid = award(message.guild.id, message.author.id);
    } catch (error) {
      console.error("GUESS AWARD ERROR:", error);
      await game.display.edit(panel(
        "The round ended with an economy error. Check the bot console."
      )).catch(console.error);
      return;
    }

    const result = paid
      ? `Winner: <@${message.author.id}>\n` +
        `Number: **${game.number}**\n` +
        `${COIN} Reward: **${REWARD} Coin**`
      : `Winner: <@${message.author.id}>\n` +
        `Number: **${game.number}**\n` +
        `Reward not added: balance limit reached.`;

    // The database award is already committed; a display failure
    // must not cause a second award.
    await game.display.edit(panel(result)).catch(error => {
      console.error("GUESS DISPLAY ERROR:", error);
    });

    if (paid) await logWin(message.guild, message.author.id, game.id);
  });

  console.log("MILAN GUESS NUMBER LOADED");
};