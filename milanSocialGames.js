"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerSocialGames(client) {
  const active = new Map();

  const cases = [
    {
      place: "The museum",
      clue: "The missing painting was moved after closing.",
      evidence: "A visitor's pass was used near the gallery."
    },
    {
      place: "The hotel",
      clue: "A locked room was entered during the night.",
      evidence: "The hallway camera shows someone carrying a key."
    },
    {
      place: "The library",
      clue: "A rare book disappeared before opening.",
      evidence: "A staff door was opened shortly before dawn."
    },
    {
      place: "The theatre",
      clue: "An important prop vanished before the show.",
      evidence: "Fresh footprints lead away from backstage."
    }
  ];

  function panel(title, text, rows = []) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: `### MILAN • ${title}` },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text },
          ...rows
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  function button(game, action, label) {
    return {
      type: 2,
      style: 2,
      custom_id: `milan_social:${game.id}:${action}`,
      label
    };
  }

  function row(buttons) {
    return { type: 1, components: buttons };
  }

  function roster(game) {
    return game.players.map((id, i) =>
      `**${i + 1}.** <@${id}>`
    ).join("\n");
  }

  function lobby(game) {
    return panel(
      game.type.toUpperCase(),
      `**Players: ${game.players.length}/5**\n${roster(game)}\n\n` +
      `Minimum: **3 players**. The host starts the game.`,
      [row([
        button(game, "join", "Join"),
        button(game, "start", "Start"),
        button(game, "cancel", "Cancel")
      ])]
    );
  }

  function playing(game) {
    let description;

    if (game.type === "mafia") {
      description =
        "One player is Mafia. Everyone else is a Citizen.\n" +
        "Read your secret role, discuss, then vote for the Mafia.";
    } else if (game.type === "thief") {
      description =
        "One player is the Thief. Everyone else is a Guard.\n" +
        "Read your secret role, discuss, then vote for the Thief.";
    } else {
      description =
        `**Case:** ${game.case.place}\n` +
        `**Clue:** ${game.case.clue}\n` +
        "One player is the culprit and one is the Detective.\n" +
        "The Detective receives extra evidence in their secret role.\n" +
        "Discuss, then vote for the culprit.";
    }

    return panel(
      game.type.toUpperCase(),
      `**Players**\n${roster(game)}\n\n${description}\n\n` +
      "Press **My Role** privately. Only the host can start voting.",
      [row([
        button(game, "role", "My Role"),
        button(game, "vote", "Start Voting"),
        button(game, "end", "End Game")
      ])]
    );
  }

  function voting(game) {
    return panel(
      game.type.toUpperCase(),
      `**Vote for the suspect**\n${roster(game)}\n\n` +
      `Votes: **${game.votes.size}/${game.players.length}**\n` +
      "Each player votes once and cannot vote for themselves.",
      [row(game.players.map((_, index) =>
        button(game, `pick${index}`, `Player ${index + 1}`)
      ))]
    );
  }

  function roleText(game, user) {
    if (game.type === "mafia") {
      return user === game.suspect
        ? "You are **Mafia**. Avoid being selected in the vote."
        : "You are a **Citizen**. Discuss and find the Mafia.";
    }

    if (game.type === "thief") {
      return user === game.suspect
        ? "You are the **Thief**. Avoid being selected in the vote."
        : "You are a **Guard**. Discuss and find the Thief.";
    }

    if (user === game.suspect) {
      return "You are the **Culprit**. Avoid being selected in the vote.";
    }

    if (user === game.detective) {
      return `You are the **Detective**.\nExtra evidence: ${game.case.evidence}`;
    }

    return "You are a **Witness**. Discuss the case and find the culprit.";
  }

  async function privateReply(interaction, text) {
    await interaction.reply({
      content: text,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    }).catch(error => console.error("SOCIAL PRIVATE REPLY ERROR:", error));
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const command = (message.content || "").trim().toLowerCase();
    const commands = {
      ".mafia": "mafia",
      ".thief": "thief",
      ".detective": "detective"
    };
    const type = commands[command];
    if (!type) return;

    const key = `${message.guild.id}:${message.channel.id}`;
    if (active.has(key)) {
      await message.reply({
        ...panel("SOCIAL GAMES", "A social game is already active here."),
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    const game = {
      id: message.id,
      type,
      host: message.author.id,
      players: [message.author.id],
      state: "lobby",
      suspect: null,
      detective: null,
      case: null,
      votes: new Map(),
      busy: false
    };

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

        const prefix = `milan_social:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (game.busy) {
          await privateReply(interaction, "Please wait for the current action.");
          return;
        }

        game.busy = true;
        try {
          const action = interaction.customId.slice(prefix.length);
          const user = interaction.user.id;
          const host = user === game.host;
          const player = game.players.includes(user);

          if (action === "join") {
            if (game.state !== "lobby") {
              await privateReply(interaction, "The game has started.");
              return;
            }
            if (player) {
              await privateReply(interaction, "You already joined.");
              return;
            }
            if (game.players.length >= 5) {
              await privateReply(interaction, "The lobby is full.");
              return;
            }

            game.players.push(user);
            await interaction.update(lobby(game));
            return;
          }

          if (action === "cancel") {
            if (!host || game.state !== "lobby") {
              await privateReply(interaction, "Only the host can cancel the lobby.");
              return;
            }

            game.state = "ended";
            await interaction.update(panel(type.toUpperCase(), "Lobby cancelled."));
            collector.stop("cancelled");
            return;
          }

          if (action === "start") {
            if (!host || game.state !== "lobby") {
              await privateReply(interaction, "Only the host can start the game.");
              return;
            }
            if (game.players.length < 3) {
              await privateReply(interaction, "At least 3 players are required.");
              return;
            }

            game.suspect = game.players[randomInt(game.players.length)];
            if (type === "detective") {
              const candidates = game.players.filter(id => id !== game.suspect);
              game.detective = candidates[randomInt(candidates.length)];
              game.case = cases[randomInt(cases.length)];
            }

            game.state = "playing";
            await interaction.update(playing(game));
            return;
          }

          if (action === "role") {
            if (game.state !== "playing" || !player) {
              await privateReply(interaction, "You are not in the active game.");
              return;
            }
            await privateReply(interaction, roleText(game, user));
            return;
          }

          if (action === "end") {
            if (!host || game.state !== "playing") {
              await privateReply(interaction, "Only the host can end the game.");
              return;
            }
            game.state = "ended";
            await interaction.update(panel(type.toUpperCase(), "Game ended by the host."));
            collector.stop("cancelled");
            return;
          }

          if (action === "vote") {
            if (!host || game.state !== "playing") {
              await privateReply(interaction, "Only the host can start voting.");
              return;
            }
            game.state = "voting";
            await interaction.update(voting(game));
            return;
          }

          if (/^pick[0-4]$/.test(action)) {
            if (game.state !== "voting" || !player) {
              await privateReply(interaction, "Only players can vote.");
              return;
            }
            if (game.votes.has(user)) {
              await privateReply(interaction, "You already voted.");
              return;
            }

            const target = game.players[Number(action.slice(4))];
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

            const roleName = type === "mafia" ? "Mafia" :
              type === "thief" ? "Thief" : "Culprit";

            let outcome;
            if (leaders.length !== 1) {
              outcome = `**Tie:** the ${roleName} escapes.`;
            } else if (leaders[0] === game.suspect) {
              outcome = `**Players win:** the ${roleName} was found.`;
            } else {
              outcome = `**${roleName} wins:** an innocent player was selected.`;
            }

            game.state = "ended";
            await interaction.update(panel(
              type.toUpperCase(),
              `${outcome}\n\n${roleName}: <@${game.suspect}>` +
              (game.detective ? `\nDetective: <@${game.detective}>` : "")
            ));
            collector.stop("finished");
          }
        } catch (error) {
          console.error("SOCIAL GAME INTERACTION ERROR:", error);
          game.state = "ended";

          if (!interaction.replied && !interaction.deferred) {
            await privateReply(interaction, "An error occurred; the game is closing.");
          }

          await sent.edit(panel(type.toUpperCase(), "Game closed due to an error."))
            .catch(console.error);
          collector.stop("error");
        } finally {
          game.busy = false;
        }
      });

      collector.on("end", async (_collected, reason) => {
        if (active.get(key) === game) active.delete(key);

        if (["finished", "cancelled", "error"].includes(reason)) return;

        game.state = "ended";
        await sent.edit(panel(type.toUpperCase(), "Game timed out and closed."))
          .catch(console.error);
      });
    } catch (error) {
      if (active.get(key) === game) active.delete(key);
      console.error("SOCIAL GAME START ERROR:", error);
    }
  });

  console.log("MILAN SOCIAL GAMES LOADED");
};