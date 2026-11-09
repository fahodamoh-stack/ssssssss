"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerGeography(client, db) {
  const REWARD = 50;
  const LIMIT = 1_000_000_000;
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "<:coin:1568544045041586246>";
  const active = new Set();

  const capitals = [
    ["What is the capital of Egypt?", ["Cairo", "Riyadh", "Amman", "Doha"], 0],
    ["What is the capital of Japan?", ["Seoul", "Tokyo", "Beijing", "Bangkok"], 1],
    ["What is the capital of France?", ["Rome", "Madrid", "Paris", "Lisbon"], 2],
    ["What is the capital of Canada?", ["Toronto", "Vancouver", "Montreal", "Ottawa"], 3],
    ["What is the capital of Turkey?", ["Ankara", "Istanbul", "Izmir", "Antalya"], 0],
    ["What is the capital of Saudi Arabia?", ["Jeddah", "Riyadh", "Mecca", "Medina"], 1]
  ];

  const flags = [
    ["Which country has this flag? \u{1F1EA}\u{1F1EC}", ["Egypt", "Iraq", "Yemen", "Syria"], 0],
    ["Which country has this flag? \u{1F1EF}\u{1F1F5}", ["China", "Japan", "South Korea", "Vietnam"], 1],
    ["Which country has this flag? \u{1F1EB}\u{1F1F7}", ["Italy", "Netherlands", "France", "Russia"], 2],
    ["Which country has this flag? \u{1F1E7}\u{1F1F7}", ["Argentina", "Mexico", "Portugal", "Brazil"], 3],
    ["Which country has this flag? \u{1F1F8}\u{1F1E6}", ["Saudi Arabia", "Pakistan", "Algeria", "Oman"], 0],
    ["Which country has this flag? \u{1F1E8}\u{1F1E6}", ["United States", "Canada", "Australia", "Denmark"], 1]
  ];

  for (const name of ["fizzy_wallets", "fizzy_transactions"]) {
    const found = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name);
    if (!found) throw new Error(`Geography requires ${name}. Load economy first.`);
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
    VALUES (?, ?, NULL, ?, ?, ?)
  `);

  function award(guild, user, kind) {
    db.exec("BEGIN IMMEDIATE");
    try {
      ensure.run(guild, user);
      const result = credit.run(REWARD, guild, user, REWARD, LIMIT);
      if (Number(result.changes) !== 1) {
        db.exec("ROLLBACK");
        return false;
      }
      record.run(guild, user, kind, REWARD, Date.now());
      db.exec("COMMIT");
      return true;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function panel(game, text, disabled) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: `### MILAN • ${game.title}` },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: `**${game.question}**\n\n${text}` },
          {
            type: 1,
            components: game.answers.map((answer, index) => ({
              type: 2,
              style: 2,
              custom_id: `milan_geo:${game.id}:${index}`,
              label: answer,
              disabled
            }))
          }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function logWin(guild, game, userId) {
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
              `### ${game.title} • COIN LOG\n` +
              `Member: <@${userId}>\n` +
              `Reward: ${COIN} ${REWARD} Coin\n` +
              `Game: \`${game.id}\``
          }]
        }],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.error("GEOGRAPHY LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const command = (message.content || "").trim().toLowerCase();
    if (![".capitals", ".flags"].includes(command)) return;

    const key = `${message.guild.id}:${message.channel.id}`;
    if (active.has(key)) {
      await message.reply({
        content: "A geography game is already active in this channel.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    active.add(key);
    const list = command === ".capitals" ? capitals : flags;
    const [question, answers, correct] = list[randomInt(list.length)];

    const game = {
      id: message.id,
      title: command === ".capitals" ? "CAPITALS" : "FLAGS",
      question,
      answers,
      correct
    };

    let settled = false;

    try {
      const sent = await message.reply({
        ...panel(game, `First correct answer wins ${COIN} **${REWARD} Coin**.\nTime: 30 seconds.`, false),
        failIfNotExists: false
      });

      const collector = sent.createMessageComponentCollector({ time: 30_000 });

      collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;
        const prefix = `milan_geo:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (settled) {
          await interaction.reply({
            content: "This round has ended.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        const raw = interaction.customId.slice(prefix.length);
        if (!/^[0-3]$/.test(raw)) {
          await interaction.reply({
            content: "Invalid answer.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        if (Number(raw) !== game.correct) {
          await interaction.reply({
            content: "Wrong answer. Try again.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        // Lock before awaiting to prevent two winners.
        settled = true;

        try {
          await interaction.deferUpdate();
          const paid = award(
            message.guild.id,
            interaction.user.id,
            command === ".capitals" ? "capitals_win" : "flags_win"
          );

          const result = paid
            ? `Winner: <@${interaction.user.id}>\n${COIN} Reward: **${REWARD} Coin**`
            : `Winner: <@${interaction.user.id}>\nReward not added: balance limit reached.`;

          await sent.edit(panel(game, result, true));
          collector.stop("answered");

          if (paid) await logWin(message.guild, game, interaction.user.id);
        } catch (error) {
          console.error("GEOGRAPHY SETTLEMENT ERROR:", error);
          collector.stop("error");
          await sent.edit(panel(
            game,
            "The round ended with an error. Check the bot log before retrying.",
            true
          )).catch(console.error);
        }
      });

      collector.on("end", async (_collected, reason) => {
        active.delete(key);
        if (reason === "answered" || reason === "error") return;

        await sent.edit(panel(
          game,
          `Time ended. Correct answer: **${game.answers[game.correct]}**`,
          true
        )).catch(console.error);
      });
    } catch (error) {
      active.delete(key);
      console.error("GEOGRAPHY START ERROR:", error);
    }
  });

  console.log("MILAN GEOGRAPHY LOADED");
};