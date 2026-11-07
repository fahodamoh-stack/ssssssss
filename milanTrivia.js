"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerTrivia(client, db) {
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568543923964616705>";
  const REWARD = 50;
  const MAX_BALANCE = 1_000_000_000;
  const active = new Set();

  const questions = [
    { q: "What is the capital of Japan?", a: ["Tokyo", "Seoul", "Beijing", "Bangkok"], correct: 0 },
    { q: "Which planet is known as the Red Planet?", a: ["Venus", "Mars", "Jupiter", "Mercury"], correct: 1 },
    { q: "How many sides does a hexagon have?", a: ["Five", "Six", "Seven", "Eight"], correct: 1 },
    { q: "Which ocean is the largest?", a: ["Atlantic", "Indian", "Pacific", "Arctic"], correct: 2 },
    { q: "What is the capital of Egypt?", a: ["Cairo", "Alexandria", "Luxor", "Aswan"], correct: 0 },
    { q: "Which animal is the largest living mammal?", a: ["Elephant", "Blue whale", "Giraffe", "Shark"], correct: 1 },
    { q: "What is 12 multiplied by 8?", a: ["88", "92", "96", "108"], correct: 2 },
    { q: "Which language runs directly in a web browser?", a: ["JavaScript", "SQL", "C", "Swift"], correct: 0 }
  ];

  const walletTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fizzy_wallets'"
  ).get();
  const transactionTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fizzy_transactions'"
  ).get();

  if (!walletTable || !transactionTable) {
    throw new Error("Trivia requires the existing economy module to load first.");
  }

  const ensure = db.prepare(
    "INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)"
  );
  const credit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ? AND balance + ? <= ?
  `);
  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, NULL, 'trivia_win', ?, ?)
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

  function panel(question, gameId, text, disabled) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN • TRIVIA" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: `**${question.q}**\n${text}` },
          {
            type: 1,
            components: question.a.map((answer, index) => ({
              type: 2,
              style: 2,
              custom_id: `milan_trivia:${gameId}:${index}`,
              label: answer,
              disabled,
            })),
          },
        ],
      }],
      allowedMentions: { parse: [], repliedUser: false },
    };
  }

  async function logWin(guild, userId, question, gameId) {
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;

      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [{
          type: 17,
          accent_color: 0x203234,
          components: [{
            type: 10,
            content:
              `### TRIVIA • COIN LOG\n` +
              `Member: <@${userId}>\n` +
              `Reward: ${COIN} **${REWARD} Coin**\n` +
              `Game: \`${gameId}\`\n` +
              `Question: ${question.q}`,
          }],
        }],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("TRIVIA LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if ((message.content || "").trim().toLowerCase() !== ".trivia") return;

    const channelKey = `${message.guild.id}:${message.channel.id}`;

    if (active.has(channelKey)) {
      await message.reply({
        content: "A Trivia game is already active in this channel.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false,
      }).catch(console.error);
      return;
    }

    active.add(channelKey);
    const question = questions[randomInt(questions.length)];
    const gameId = message.id;
    let settled = false;

    try {
      const gameMessage = await message.reply({
        ...panel(question, gameId, "First correct answer wins 50 Coin. Time: 30 seconds.", false),
        failIfNotExists: false,
      });

      const collector = gameMessage.createMessageComponentCollector({
        time: 30_000,
      });

      collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;

        const prefix = `milan_trivia:${gameId}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (settled) {
          await interaction.reply({
            content: "This round has already ended.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        const choice = Number(interaction.customId.slice(prefix.length));

        if (!Number.isInteger(choice) || choice < 0 || choice >= question.a.length) {
          await interaction.reply({
            content: "Invalid choice.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        if (choice !== question.correct) {
          await interaction.reply({
            content: "Wrong answer. You can try again.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        // Set before awaiting so two correct clicks cannot both win.
        settled = true;

        try {
          await interaction.deferUpdate();

          const paid = award(message.guild.id, interaction.user.id);
          const result = paid
            ? `Winner: <@${interaction.user.id}>\n${COIN} Reward: **${REWARD} Coin**`
            : `Winner: <@${interaction.user.id}>\nReward not added: balance limit reached.`;

          await gameMessage.edit(panel(question, gameId, result, true));
          collector.stop("answered");

          if (paid) {
            await logWin(message.guild, interaction.user.id, question, gameId);
          }
        } catch (error) {
          console.error("TRIVIA SETTLEMENT ERROR:", error);
          collector.stop("error");
          await gameMessage.edit(panel(
            question, gameId,
            "The round ended with an error. Check the bot log before retrying.",
            true
          )).catch(console.error);
        }
      });

      collector.on("end", async (_collected, reason) => {
        active.delete(channelKey);

        if (reason === "answered" || reason === "error") return;

        await gameMessage.edit(panel(
          question,
          gameId,
          `Time ended. Correct answer: **${question.a[question.correct]}**`,
          true
        )).catch(console.error);
      });
    } catch (error) {
      active.delete(channelKey);
      console.error("TRIVIA START ERROR:", error);
    }
  });

  console.log("MILAN TRIVIA LOADED");
};