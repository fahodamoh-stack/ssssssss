"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanVoting(client) {
  const durationMs = 60_000;
  const active = new Set();

  const questions = [
    ["Would you rather travel to the past or the future?", "Past", "Future"],
    ["Would you rather live by the sea or in the mountains?", "Sea", "Mountains"],
    ["Would you rather explore space or the deep ocean?", "Space", "Ocean"],
    ["Would you rather have endless books or endless movies?", "Books", "Movies"],
    ["Would you rather fly or become invisible?", "Fly", "Invisible"]
  ];

  function safeText(value, max) {
    return String(value)
      .replace(/[\r\n]/g, " ")
      .replace(/[`*_~|<>@\\]/g, "")
      .trim()
      .slice(0, max);
  }

  function panel(game, ended) {
    const counts = game.options.map((_, index) =>
      [...game.votes.values()].filter(v => v === index).length
    );

    const resultLines = game.options.map((option, index) =>
      `**${index + 1}. ${option}** — ${counts[index]} vote(s)`
    );

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: `### MILAN • ${game.title}` },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content:
              `**${game.question}**\n\n` +
              resultLines.join("\n") +
              (ended ? "\n\nVoting ended." : "\n\nVote using the buttons below.")
          },
          {
            type: 1,
            components: game.options.map((_, index) => ({
              type: 2,
              style: 2,
              custom_id: `milan_vote:${game.id}:${index}`,
              label: String(index + 1),
              disabled: ended
            }))
          }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  async function startPoll(message, title, question, options) {
    const key = `${message.guild.id}:${message.channel.id}`;

    if (active.has(key)) {
      await message.reply({
        content: "A vote is already active in this channel.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    active.add(key);

    const game = {
      id: message.id,
      title,
      question,
      options,
      votes: new Map()
    };

    try {
      const sent = await message.reply({
        ...panel(game, false),
        failIfNotExists: false
      });

      const collector = sent.createMessageComponentCollector({
        time: durationMs
      });

      collector.on("collect", async interaction => {
        const prefix = `milan_vote:${game.id}:`;
        if (!interaction.isButton() ||
            !interaction.customId.startsWith(prefix)) return;

        const raw = interaction.customId.slice(prefix.length);
        if (!/^\d+$/.test(raw)) {
          await interaction.reply({
            content: "Invalid choice.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        const choice = Number(raw);
        if (choice < 0 || choice >= game.options.length) {
          await interaction.reply({
            content: "Invalid choice.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        // One vote per member; voting again changes the selection.
        game.votes.set(interaction.user.id, choice);

        await interaction.reply({
          content: `Your vote for "${game.options[choice]}" was saved.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] }
        }).catch(console.error);
      });

      collector.on("end", async () => {
        active.delete(key);
        await sent.edit(panel(game, true)).catch(console.error);
      });
    } catch (error) {
      active.delete(key);
      console.error("VOTING START ERROR:", error);

      await message.reply({
        content: "Could not start the vote. Check the bot console.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      }).catch(() => {});
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const content = (message.content || "").trim();

    if (content.toLowerCase() === ".wyr") {
      const [question, first, second] = questions[randomInt(questions.length)];
      await startPoll(message, "WOULD YOU RATHER", question, [first, second]);
      return;
    }

    if (!/^\.vote(?:\s|$)/i.test(content)) return;

    const input = content.replace(/^\.vote\s*/i, "");
    const parts = input.split("|").map(value => safeText(value, 80));

    if (parts.length < 3 || parts.length > 6 || parts.some(value => !value)) {
      await message.reply({
        content:
          "Usage: `.vote Question | Option 1 | Option 2`\n" +
          "Add up to 5 options separated by `|`.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    const [question, ...options] = parts;
    await startPoll(message, "VOTING", question, options);
  });

  console.log("MILAN VOTING LOADED");
};