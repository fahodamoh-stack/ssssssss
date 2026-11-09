"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerCutTweet(client, db) {
  const REWARD = 50;
  const MAX_BALANCE = 1_000_000_000;
  const ROUND_MS = 30_000;
  const COOLDOWN_MS = 60_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568544045041586246>";

  const games = new Map();
  const lastStarted = new Map();

  const questions = [
    { q: "What is 7 + 8?", answers: ["15"], display: "15" },
    { q: "What is 9 x 9?", answers: ["81"], display: "81" },
    { q: "How many days are in a week?", answers: ["7", "seven"], display: "7" },
    { q: "What is the opposite of hot?", answers: ["cold"], display: "Cold" },
    { q: "Which planet do we live on?", answers: ["earth"], display: "Earth" },
    { q: "What is 100 divided by 4?", answers: ["25"], display: "25" },
    { q: "How many months are in a year?", answers: ["12", "twelve"], display: "12" },
    { q: "What is the first month of the year?", answers: ["january"], display: "January" }
  ];

  for (const table of ["fizzy_wallets", "fizzy_transactions"]) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);

    if (!exists) {
      throw new Error(`Cut Tweet requires ${table}. Load economy first.`);
    }
  }

  const ensure = db.prepare(`
    INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)
  `);

  const credit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ? AND balance + ? <= ?
  `);

  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, NULL, 'cuttweet_win', ?, ?)
  `);

  function award(guild, user) {
    db.exec("BEGIN IMMEDIATE");
    try {
      ensure.run(guild, user);

      const result = credit.run(REWARD, guild, user, REWARD, MAX_BALANCE);
      if (Number(result.changes) !== 1) {
        db.exec("ROLLBACK");
        return false;
      }

      record.run(guild, user, REWARD, Date.now());
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
          { type: 10, content: "### MILAN • CUT TWEET" },
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
        console.warn("CUT TWEET: coin log channel unavailable.");
        return;
      }

      await channel.send(panel(
        `**Coin transaction**\n` +
        `Member: <@${userId}>\n` +
        `Reward: ${COIN} **${REWARD} Coin**\n` +
        `Game: \`${gameId}\``
      ));
    } catch (error) {
      console.error("CUT TWEET LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const content = (message.content || "").trim();
    const key = `${message.guild.id}:${message.channel.id}`;

    if (content.toLowerCase() === ".cuttweet") {
      if (games.has(key)) {
        await message.reply({
          ...panel("A Cut Tweet round is already active here."),
          failIfNotExists: false
        }).catch(console.error);
        return;
      }

      const wait = (lastStarted.get(key) || 0) + COOLDOWN_MS - Date.now();
      if (wait > 0) {
        await message.reply({
          ...panel(`Wait **${Math.ceil(wait / 1000)} seconds** before starting again.`),
          failIfNotExists: false
        }).catch(console.error);
        return;
      }

      const game = {
        id: message.id,
        question: questions[randomInt(questions.length)],
        state: "starting",
        timer: null,
        display: null
      };

      games.set(key, game);

      try {
        game.display = await message.reply({
          ...panel(
            `**${game.question.q}**\n\n` +
            `Type your answer in this channel.\n` +
            `First correct answer wins ${COIN} **${REWARD} Coin**.\n` +
            `Time: **30 seconds**.`
          ),
          failIfNotExists: false
        });

        game.state = "active";
        lastStarted.set(key, Date.now());

        game.timer = setTimeout(() => {
          if (games.get(key) !== game || game.state !== "active") return;

          game.state = "ended";
          games.delete(key);

          void game.display.edit(panel(
            `**${game.question.q}**\n\n` +
            `Time ended. Answer: **${game.question.display}**`
          )).catch(console.error);
        }, ROUND_MS);
      } catch (error) {
        if (games.get(key) === game) games.delete(key);
        console.error("CUT TWEET START ERROR:", error);
      }

      return;
    }

    const game = games.get(key);
    if (!game || game.state !== "active") return;

    const answer = content.toLowerCase().replace(/\s+/g, " ");
    if (!game.question.answers.includes(answer)) return;

    // Lock before any await so only one answer wins.
    game.state = "settling";
    clearTimeout(game.timer);
    games.delete(key);

    let paid;
    try {
      paid = award(message.guild.id, message.author.id);
    } catch (error) {
      console.error("CUT TWEET AWARD ERROR:", error);
      await game.display.edit(panel(
        "The round ended with an economy error. Check the bot console."
      )).catch(console.error);
      return;
    }

    const result = paid
      ? `Winner: <@${message.author.id}>\n` +
        `Answer: **${game.question.display}**\n` +
        `${COIN} Reward: **${REWARD} Coin**`
      : `Winner: <@${message.author.id}>\n` +
        `Reward not added: balance limit reached.`;

    // A failed Discord edit must not repeat the committed award.
    await game.display.edit(panel(result)).catch(error => {
      console.error("CUT TWEET DISPLAY ERROR:", error);
    });

    if (paid) {
      await logWin(message.guild, message.author.id, game.id);
    }
  });

  console.log("MILAN CUT TWEET LOADED");
};