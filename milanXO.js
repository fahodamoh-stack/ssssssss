"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanXO(client, db) {
  const LOG_CHANNEL = "1566559654924914728";
  const COIN = "";
  const MAX_BALANCE = 1_000_000_000;
  const JOIN_MS = 15_000;
  const TURN_MS = 60_000;
  const FLAG = MessageFlags.IsComponentsV2;
  const games = new Map();
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_xo_escrow (
      game_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      player_x TEXT NOT NULL,
      player_o TEXT NOT NULL,
      stake INTEGER NOT NULL,
      status TEXT NOT NULL,
      winner TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );
  `);

  const walletExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'fizzy_wallets'
  `).get();

  if (!walletExists) {
    throw new Error("XO requires fizzy_wallets. Register economy before XO.");
  }

  const wallet = db.prepare(`
    SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?
  `);

  const ensure = db.prepare(`
    INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)
  `);

  const debit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance - ?
    WHERE guild = ? AND user = ? AND balance >= ?
  `);

  const credit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ?
  `);

  const insertEscrow = db.prepare(`
    INSERT INTO milan_xo_escrow
      (game_id, guild, player_x, player_o, stake, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'held', ?)
  `);

  const escrowById = db.prepare(`
    SELECT * FROM milan_xo_escrow WHERE game_id = ?
  `);

  const closeEscrow = db.prepare(`
    UPDATE milan_xo_escrow
    SET status = ?, winner = ?, settled_at = ?
    WHERE game_id = ? AND status = 'held'
  `);

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function settle(id, winner) {
    return transaction(() => {
      const row = escrowById.get(id);
      if (!row || row.status !== "held") return null;

      ensure.run(row.guild, row.player_x);
      ensure.run(row.guild, row.player_o);

      // No automatic refunds. Keep unresolved stakes recorded for staff review.
      let actualWinner = winner;

      if (actualWinner !== row.player_x && actualWinner !== row.player_o) {
        actualWinner = null;
      }

      if (actualWinner) {
        const current = wallet.get(row.guild, actualWinner).balance;
        if (current + row.stake * 2 > MAX_BALANCE) {
          actualWinner = null;
        }
      }

      if (actualWinner) {
        credit.run(row.stake * 2, row.guild, actualWinner);
      }

      closeEscrow.run(
        actualWinner ? "won" : "review",
        actualWinner,
        Date.now(),
        id
      );

      return { row, winner: actualWinner };
    });
  }

  // Mark unfinished player-vs-player games for staff review after restart.
  const pending = db.prepare(`
    SELECT game_id FROM milan_xo_escrow WHERE status = 'held'
  `).all();

  for (const row of pending) {
    settle(row.game_id, null);
  }

  if (pending.length) {
    console.log(`XO marked ${pending.length} unfinished game(s) for staff review.`);
  }

  function winnerOf(board) {
    for (const [a, b, c] of lines) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return board.every(Boolean) ? "draw" : null;
  }

  function minimax(board, turn, depth) {
    const result = winnerOf(board);
    if (result === "O") return 10 - depth;
    if (result === "X") return depth - 10;
    if (result === "draw") return 0;

    const scores = [];
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = turn;
      scores.push(minimax(board, turn === "O" ? "X" : "O", depth + 1));
      board[i] = "";
    }

    return turn === "O" ? Math.max(...scores) : Math.min(...scores);
  }

  function botMove(board) {
    let best = -Infinity;
    let choices = [];

    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = "O";
      const score = minimax(board, "X", 0);
      board[i] = "";

      if (score > best) {
        best = score;
        choices = [i];
      } else if (score === best) {
        choices.push(i);
      }
    }

    return choices[randomInt(choices.length)];
  }

  function panel(text, color = 0x203234) {
    return {
      flags: FLAG,
      components: [{
        type: 17,
        accent_color: color,
        components: [
          { type: 10, content: "### MILAN • XO" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text },
        ],
      }],
      allowedMentions: { parse: [], repliedUser: false },
    };
  }

  function gamePayload(game, text, disabled = false) {
    const components = [
      { type: 10, content: "### MILAN • XO" },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: text },
    ];

    for (let row = 0; row < 3; row++) {
      const buttons = [];

      for (let col = 0; col < 3; col++) {
        const i = row * 3 + col;
        const mark = game.board[i];

        buttons.push({
          type: 2,
          style: mark === "X" ? 1 : mark === "O" ? 3 : 2,
          custom_id: `milan_xo:${game.id}:${i}`,
          label: mark || "\u200b",
          disabled: disabled || Boolean(mark),
        });
      }

      components.push({ type: 1, components: buttons });
    }

    return {
      flags: FLAG,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components,
      }],
      allowedMentions: { parse: [], repliedUser: false },
    };
  }

  async function logSettlement(guild, result, reason) {
    if (!result) return;
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;

      const row = result.row;
      const outcome = result.winner
        ? `Winner: <@${result.winner}>\nPayout: ${row.stake * 2} Coin`
        : "Stakes held for staff review; open a ticket.";

      await channel.send(panel(
        `**XO transaction**\n` +
        `Game: \`${row.game_id}\`\n` +
        `Players: <@${row.player_x}> / <@${row.player_o}>\n` +
        `Stake per player: ${row.stake} Coin\n` +
        `${outcome}\nReason: ${reason}`
      ));
    } catch (error) {
      console.error("XO LOG ERROR:", error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const parts = (message.content || "").trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== ".xo") return;

    if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[1])) {
      await message.reply({
        ...panel(`Usage: \`.xo 100\`\nMinimum stake: ${COIN} 100 Coin.`),
        failIfNotExists: false,
      }).catch(console.error);
      return;
    }

    const stake = Number(parts[1]);
    if (!Number.isSafeInteger(stake) || stake < 100 || stake > MAX_BALANCE / 2) {
      await message.reply({
        ...panel(`Stake must be between 100 and ${MAX_BALANCE / 2} Coin.`),
        failIfNotExists: false,
      }).catch(console.error);
      return;
    }

    const game = {
      id: message.id,
      guild: message.guild.id,
      x: message.author.id,
      o: null,
      stake,
      board: Array(9).fill(""),
      turn: "X",
      state: "waiting",
      busy: false,
      timer: null,
      collector: null,
      msg: null,
    };

    const waitingPayload = {
      ...panel(
        `<@${game.x}> started an XO game.\n` +
        `${COIN} Stake: **${stake} Coin per player**\n` +
        `Join within **15 seconds**, or play the bot for free.`
      ),
      failIfNotExists: false,
    };

    waitingPayload.components[0].components.push({
      type: 1,
      components: [{
        type: 2,
        style: 2,
        custom_id: `milan_xo:${game.id}:join`,
        label: "Join",
      }],
    });

    try {
      game.msg = await message.reply(waitingPayload);
      games.set(game.id, game);

      game.collector = game.msg.createMessageComponentCollector({
        time: JOIN_MS + 20 * TURN_MS,
      });

      function cancelTimer() {
        if (game.timer) clearTimeout(game.timer);
        game.timer = null;
      }

      async function finish(text, winner, reason) {
        if (game.state === "ended" || game.state === "settling") return;

        const previousState = game.state;
        game.state = "settling";
        cancelTimer();

        let result;
        try {
          result = settle(game.id, winner);
        } catch (error) {
          // Do not claim that the payout or refund succeeded.
          // Leave the escrow held so startup recovery can retry.
          game.state = previousState;
          console.error("XO SETTLEMENT FAILED:", error);

          await game.msg.edit(gamePayload(
            game,
            "Settlement failed. The escrow remains pending; check the console before retrying.",
            true
          )).catch(console.error);

          game.collector.stop("settlement-error");
          return;
        }

        game.state = "ended";

        if (result && winner && !result.winner) {
          text += "\nPayout could not be completed; stakes held for staff review. Open a ticket.";
        }

        await game.msg.edit(gamePayload(game, text, true)).catch(console.error);
        await logSettlement(message.guild, result, reason);
        game.collector.stop("finished");
      }

      function startTurnTimer() {
        cancelTimer();
        game.timer = setTimeout(() => {
          void finish(
            " Time expired. Any held stakes are marked for staff review; open a ticket.",
            null,
            "turn timeout"
          ).catch(console.error);
        }, TURN_MS);
      }

      game.timer = setTimeout(async () => {
        if (game.state !== "waiting") return;
        game.state = "bot";
        game.o = "bot";
        game.turn = "X";

        await game.msg.edit(gamePayload(
          game,
          `<@${game.x}> vs  Bot\nFree game — no Coin at risk.\nYour turn: **X**`
        )).catch(console.error);

        startTurnTimer();
      }, JOIN_MS);

      game.collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;
        const prefix = `milan_xo:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (game.busy) {
          await interaction.reply({
            content: "Please wait for the current move.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        game.busy = true;

        try {
          const action = interaction.customId.slice(prefix.length);

          if (action === "join") {
            if (game.state !== "waiting") {
              await interaction.reply({
                content: "This game has already started.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            if (interaction.user.id === game.x || interaction.user.bot) {
              await interaction.reply({
                content: "Another member must join.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            const opponent = interaction.user.id;

            const held = transaction(() => {
              ensure.run(game.guild, game.x);
              ensure.run(game.guild, opponent);

              const xBalance = wallet.get(game.guild, game.x).balance;
              const oBalance = wallet.get(game.guild, opponent).balance;

              if (xBalance < stake) return "creator";
              if (oBalance < stake) return "opponent";

              // Ensure either possible winner can receive the full pot.
              if (xBalance - stake + stake * 2 > MAX_BALANCE ||
                  oBalance - stake + stake * 2 > MAX_BALANCE) return "cap";

              debit.run(stake, game.guild, game.x, stake);
              debit.run(stake, game.guild, opponent, stake);
              insertEscrow.run(
                game.id, game.guild, game.x, opponent, stake, Date.now()
              );
              return "ok";
            });

            if (held !== "ok") {
              await interaction.reply({
                content: held === "creator"
                  ? "The creator does not have enough saved Coin."
                  : held === "opponent"
                  ? "You do not have enough saved Coin."
                  : "A possible payout would exceed the balance limit.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            cancelTimer();
            game.o = opponent;
            game.state = "pvp";
            game.turn = "X";

            await interaction.update(gamePayload(
              game,
              `<@${game.x}> **X** vs <@${game.o}> **O**\n` +
              `${COIN} Pot: **${stake * 2} Coin**\n` +
              `Turn: <@${game.x}>`
            ));

            startTurnTimer();
            return;
          }

          if (!["pvp", "bot"].includes(game.state)) {
            await interaction.reply({
              content: "This game is not active.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const index = Number(action);
          if (!/^[0-8]$/.test(action) || game.board[index]) {
            await interaction.reply({
              content: "Invalid move.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const expected = game.turn === "X" ? game.x : game.o;
          if (interaction.user.id !== expected) {
            await interaction.reply({
              content: "It is not your turn.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          cancelTimer();
          game.board[index] = game.turn;
          let result = winnerOf(game.board);

          if (!result && game.state === "bot") {
            const move = botMove(game.board);
            game.board[move] = "O";
            result = winnerOf(game.board);
          } else if (!result) {
            game.turn = game.turn === "X" ? "O" : "X";
          }

          if (result) {
            await interaction.deferUpdate();

            let winner = null;
            let text;

            if (result === "draw") {
              text = " **Draw!**";
              if (game.state === "pvp") text += " Stakes held for staff review; open a ticket.";
            } else if (game.state === "bot") {
              text = result === "X" ? " **You won!**" : " **Bot won!**";
              text += "\nFree game — no Coin gained or lost.";
            } else {
              winner = result === "X" ? game.x : game.o;
              text = ` Winner: <@${winner}>\n${COIN} Payout: **${stake * 2} Coin**`;
            }

            await finish(text, winner, result);
            return;
          }

          const turnText = game.state === "bot"
            ? `<@${game.x}> vs  Bot\nFree game — your turn: **X**`
            : `<@${game.x}> **X** vs <@${game.o}> **O**\n` +
              `${COIN} Pot: **${stake * 2} Coin**\n` +
              `Turn: <@${game.turn === "X" ? game.x : game.o}>`;

          await interaction.update(gamePayload(game, turnText));
          startTurnTimer();
        } catch (error) {
          console.error("XO INTERACTION ERROR:", error);

          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: "XO error. Any held stakes require staff review; open a ticket.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          await finish("Game stopped due to an error. Stakes require staff review; open a ticket.", null, "error")
            .catch(console.error);
        } finally {
          game.busy = false;
        }
      });

      game.collector.on("end", async (_collected, reason) => {
        cancelTimer();
        games.delete(game.id);

        if (game.state !== "ended") {
          try {
            const result = settle(game.id, null);
            game.state = "ended";
            await game.msg.edit(gamePayload(
              game,
              "Game closed. Any held stakes require staff review; open a ticket.",
              true
            )).catch(() => {});
            await logSettlement(message.guild, result, reason);
          } catch (error) {
            console.error("XO REFUND ERROR:", error);
          }
        }
      });
    } catch (error) {
      console.error("XO START ERROR:", error);
      games.delete(game.id);
      await message.reply({
        ...panel("Could not start XO. Check the bot console."),
        failIfNotExists: false,
      }).catch(() => {});
    }
  });

  console.log("MILAN XO LOADED");
};