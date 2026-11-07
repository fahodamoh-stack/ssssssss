"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerImposter(client) {
  const active = new Map();
  const words = [
    "Pizza", "Beach", "Football", "Coffee", "Airport",
    "School", "Cinema", "Computer", "Restaurant", "Moon"
  ];

  function panel(game, text, rows = []) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN • IMPOSTER" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text },
          ...rows
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  function button(game, action, label, disabled = false) {
    return {
      type: 2,
      style: 2,
      custom_id: `milan_imposter:${game.id}:${action}`,
      label,
      disabled
    };
  }

  function roster(game) {
    return game.players.map((id, i) => `${i + 1}. <@${id}>`).join("\n");
  }

  function lobby(game) {
    return panel(
      game,
      `**Players: ${game.players.length}/5**\n${roster(game)}\n\n` +
      `Join, then the host starts the game. Minimum: 3 players.`,
      [{
        type: 1,
        components: [
          button(game, "join", "Join"),
          button(game, "start", "Start"),
          button(game, "cancel", "Cancel")
        ]
      }]
    );
  }

  function playing(game) {
    return panel(
      game,
      `**Players**\n${roster(game)}\n\n` +
      `Press **My Role** privately. Discuss, then the host starts voting.`,
      [{
        type: 1,
        components: [
          button(game, "role", "My Role"),
          button(game, "vote", "Start Voting")
        ]
      }]
    );
  }

  function voting(game) {
    return panel(
      game,
      `**Vote for the Imposter**\n${roster(game)}\n\n` +
      `Votes: **${game.votes.size}/${game.players.length}**\n` +
      `Each player gets one vote.`,
      [{
        type: 1,
        components: game.players.map((_, i) =>
          button(game, `pick${i}`, `Player ${i + 1}`)
        )
      }]
    );
  }

  async function privateReply(interaction, content) {
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    }).catch(console.error);
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if ((message.content || "").trim().toLowerCase() !== ".imposter") return;

    const key = `${message.guild.id}:${message.channel.id}`;

    if (active.has(key)) {
      await message.reply({
        ...panel(null, "An Imposter game is already active in this channel."),
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    const game = {
      id: message.id,
      host: message.author.id,
      players: [message.author.id],
      state: "lobby",
      imposter: null,
      word: null,
      votes: new Map(),
      busy: false
    };

    // Reserve before awaiting the Discord response.
    active.set(key, game);

    try {
      const sent = await message.reply({
        ...lobby(game),
        failIfNotExists: false
      });

      const collector = sent.createMessageComponentCollector({
        time: 5 * 60_000
      });

      collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;

        const prefix = `milan_imposter:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (game.busy) {
          await privateReply(interaction, "Please wait for the current action.");
          return;
        }

        game.busy = true;

        try {
          const action = interaction.customId.slice(prefix.length);
          const user = interaction.user.id;
          const isHost = user === game.host;
          const isPlayer = game.players.includes(user);

          if (action === "join") {
            if (game.state !== "lobby") {
              await privateReply(interaction, "The game has already started.");
              return;
            }
            if (isPlayer) {
              await privateReply(interaction, "You already joined.");
              return;
            }
            if (game.players.length >= 5) {
              await privateReply(interaction, "The game is full.");
              return;
            }

            game.players.push(user);
            await interaction.update(lobby(game));
            return;
          }

          if (action === "cancel") {
            if (!isHost || game.state !== "lobby") {
              await privateReply(interaction, "Only the host can cancel the lobby.");
              return;
            }

            game.state = "ended";
            await interaction.update(panel(game, "The host cancelled the game."));
            collector.stop("cancelled");
            return;
          }

          if (action === "start") {
            if (!isHost || game.state !== "lobby") {
              await privateReply(interaction, "Only the host can start the lobby.");
              return;
            }
            if (game.players.length < 3) {
              await privateReply(interaction, "At least 3 players are required.");
              return;
            }

            game.imposter = game.players[randomInt(game.players.length)];
            game.word = words[randomInt(words.length)];
            game.state = "playing";

            await interaction.update(playing(game));
            return;
          }

          if (action === "role") {
            if (game.state !== "playing" || !isPlayer) {
              await privateReply(interaction, "You are not in the active game.");
              return;
            }

            const text = user === game.imposter
              ? "You are the **Imposter**. You do not know the secret word."
              : `You are a **player**. Secret word: **${game.word}**`;

            await privateReply(interaction, text);
            return;
          }

          if (action === "vote") {
            if (!isHost || game.state !== "playing") {
              await privateReply(interaction, "Only the host can start voting.");
              return;
            }

            game.state = "voting";
            await interaction.update(voting(game));
            return;
          }

          if (/^pick[0-4]$/.test(action)) {
            if (game.state !== "voting" || !isPlayer) {
              await privateReply(interaction, "Only players can vote.");
              return;
            }
            if (game.votes.has(user)) {
              await privateReply(interaction, "You already voted.");
              return;
            }

            const index = Number(action.slice(4));
            const target = game.players[index];

            if (!target || target === user) {
              await privateReply(interaction, "Choose another player.");
              return;
            }

            game.votes.set(user, target);

            if (game.votes.size < game.players.length) {
              await interaction.update(voting(game));
              return;
            }

            const counts = new Map();
            for (const vote of game.votes.values()) {
              counts.set(vote, (counts.get(vote) || 0) + 1);
            }

            const highest = Math.max(...counts.values());
            const leaders = [...counts.entries()]
              .filter(([, count]) => count === highest)
              .map(([id]) => id);

            game.state = "ended";

            let result;
            if (leaders.length !== 1) {
              result = "**Tie:** no player was selected. Imposter wins.";
            } else if (leaders[0] === game.imposter) {
              result = "**Players win:** the Imposter was found.";
            } else {
              result = "**Imposter wins:** the selected player was innocent.";
            }

            await interaction.update(panel(
              game,
              `${result}\n\n` +
              `Imposter: <@${game.imposter}>\n` +
              `Secret word: **${game.word}**`
            ));

            collector.stop("finished");
          }
        } catch (error) {
          console.error("IMPOSTER INTERACTION ERROR:", error);

          if (!interaction.replied && !interaction.deferred) {
            await privateReply(interaction, "An error occurred; the game is closing.");
          }

          game.state = "ended";
          await sent.edit(panel(game, "Game closed due to an error."))
            .catch(console.error);
          collector.stop("error");
        } finally {
          game.busy = false;
        }
      });

      collector.on("end", async (_collected, reason) => {
        active.delete(key);

        if (["finished", "cancelled", "error"].includes(reason)) return;

        game.state = "ended";
        await sent.edit(panel(game, "Game timed out and closed."))
          .catch(console.error);
      });
    } catch (error) {
      active.delete(key);
      console.error("IMPOSTER START ERROR:", error);
    }
  });

  console.log("MILAN IMPOSTER LOADED");
};