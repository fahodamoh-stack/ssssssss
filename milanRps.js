"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanRps(client) {
  const CHOICES = {
    rock: {
      label: "\u062d\u062c\u0631",
      emoji: "\u{1FAA8}",
      beats: "scissors",
    },
    paper: {
      label: "\u0648\u0631\u0642\u0629",
      emoji: "\u{1F4C4}",
      beats: "rock",
    },
    scissors: {
      label: "\u0645\u0642\u0635",
      emoji: "\u2702\uFE0F",
      beats: "paper",
    },
  };

  const TIMEOUT_MS = 60_000;
  const active = new Set();

  function button(id, label, emoji, disabled = false) {
    return {
      type: 2,
      style: 2,
      custom_id: id,
      label,
      emoji: { name: emoji },
      disabled,
    };
  }

  function payload(ownerId, gameId, text, disabled = false) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          {
            type: 10,
            content: "### \u{1F3AE} MILAN \u2022 ROCK PAPER SCISSORS",
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content: `<@${ownerId}>\n${text}`,
          },
          {
            type: 1,
            components: [
              button(`milan_rps:${gameId}:rock`, CHOICES.rock.label, CHOICES.rock.emoji, disabled),
              button(`milan_rps:${gameId}:paper`, CHOICES.paper.label, CHOICES.paper.emoji, disabled),
              button(`milan_rps:${gameId}:scissors`, CHOICES.scissors.label, CHOICES.scissors.emoji, disabled),
            ],
          },
        ],
      }],
      allowedMentions: { parse: [], repliedUser: false },
      failIfNotExists: false,
    };
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if ((message.content || "").trim().toLowerCase() !== ".rps") return;

    const ownerId = message.author.id;
    const key = `${message.guild.id}:${ownerId}`;

    if (active.has(key)) {
      await message.reply({
        content: "\u0639\u0646\u062f\u0643 \u0644\u0639\u0628\u0629 \u0634\u063a\u0627\u0644\u0629 \u0628\u0627\u0644\u0641\u0639\u0644.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false,
      }).catch(console.error);
      return;
    }

    active.add(key);
    const gameId = message.id;
    let gameMessage;

    try {
      gameMessage = await message.reply(payload(
        ownerId,
        gameId,
        "\u0627\u062e\u062a\u0627\u0631 \u062d\u062c\u0631 \u0623\u0648 \u0648\u0631\u0642\u0629 \u0623\u0648 \u0645\u0642\u0635. \u0645\u0639\u0627\u0643 60 \u062b\u0627\u0646\u064a\u0629."
      ));

      const collector = gameMessage.createMessageComponentCollector({
        time: TIMEOUT_MS,
      });

      let completed = false;

      collector.on("collect", async interaction => {
        try {
          if (interaction.user.id !== ownerId) {
            await interaction.reply({
              content: "\u0627\u0644\u0644\u0639\u0628\u0629 \u062f\u064a \u0645\u0634 \u0644\u064a\u0643. \u0627\u0643\u062a\u0628 `.rps` \u0639\u0634\u0627\u0646 \u062a\u0644\u0639\u0628.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const prefix = `milan_rps:${gameId}:`;
          if (!interaction.customId.startsWith(prefix)) return;

          const playerChoice = interaction.customId.slice(prefix.length);
          if (!Object.hasOwn(CHOICES, playerChoice)) return;

          // Prevent two rapid button presses from settling twice.
          if (completed) {
            await interaction.deferUpdate().catch(() => {});
            return;
          }
          completed = true;

          const keys = Object.keys(CHOICES);
          const botChoice = keys[randomInt(keys.length)];
          const player = CHOICES[playerChoice];
          const bot = CHOICES[botChoice];

          let result;
          if (playerChoice === botChoice) {
            result = "\u{1F91D} **\u062a\u0639\u0627\u062f\u0644!**";
          } else if (player.beats === botChoice) {
            result = "\u{1F389} **\u0627\u0646\u062a \u0643\u0633\u0628\u062a!**";
          } else {
            result = "\u{1F916} **\u0627\u0644\u0628\u0648\u062a \u0643\u0633\u0628!**";
          }

          const text = [
            `\u0627\u062e\u062a\u064a\u0627\u0631\u0643: ${player.emoji} **${player.label}**`,
            `\u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0628\u0648\u062a: ${bot.emoji} **${bot.label}**`,
            "",
            result,
          ].join("\n");

          const next = payload(ownerId, gameId, text, true);
          // failIfNotExists is for replies, not interaction updates.
          delete next.failIfNotExists;
          await interaction.update(next);
          collector.stop("completed");
        } catch (error) {
          console.error("RPS INTERACTION ERROR:", error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: "\u062d\u0635\u0644 \u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0644\u0639\u0628\u0629.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
          collector.stop("error");
        }
      });

      collector.on("end", async (_collected, reason) => {
        active.delete(key);

        if (reason === "completed") return;

        try {
          const next = payload(
            ownerId,
            gameId,
            reason === "time"
              ? "\u23F3 \u0627\u0646\u062a\u0647\u0649 \u0627\u0644\u0648\u0642\u062a. \u0627\u0643\u062a\u0628 `.rps` \u0639\u0634\u0627\u0646 \u062a\u0644\u0639\u0628 \u062a\u0627\u0646\u064a."
              : "\u0627\u062a\u0642\u0641\u0644\u062a \u0627\u0644\u0644\u0639\u0628\u0629 \u0628\u0633\u0628\u0628 \u062e\u0637\u0623.",
            true
          );
          delete next.failIfNotExists;
          await gameMessage.edit(next);
        } catch (error) {
          console.error("RPS END ERROR:", error);
        }
      });
    } catch (error) {
      active.delete(key);
      console.error("RPS START ERROR:", error);
      await message.reply({
        content: "\u0645\u0634 \u0642\u0627\u062f\u0631 \u0623\u0628\u062f\u0623 \u0627\u0644\u0644\u0639\u0628\u0629. \u0631\u0627\u062c\u0639 \u0644\u0648\u062c \u0627\u0644\u0628\u0648\u062a.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false,
      }).catch(() => {});
    }
  });

  console.log("MILAN RPS LOADED");
};