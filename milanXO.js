"use strict";

const { Events, MessageFlags } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerMilanXO(client, db) {
  const MAX_BALANCE = 1_000_000_000;
  const UNLIMITED_ROLE = "1568641134220017774";
  const LOG_CHANNEL = "1566559654924914728";
  const JOIN_MS = 15_000;
  const TURN_MS = 60_000;
  const FLAG = MessageFlags.IsComponentsV2;
  const games = new Map();

  const winningLines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  for (const table of ["fizzy_wallets", "fizzy_transactions", "milan_xo_escrow"]) {
    const found = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!found) throw new Error(`XO requires existing table: ${table}`);
  }

  // Separate table preserves compatibility with existing escrow rows.
  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_xo_funding (
      game_id TEXT PRIMARY KEY,
      x_virtual INTEGER NOT NULL CHECK(x_virtual IN (0, 1)),
      o_virtual INTEGER NOT NULL CHECK(o_virtual IN (0, 1))
    );
  `);

  const wallet = db.prepare(
    "SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?"
  );
  const ensure = db.prepare(
    "INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)"
  );
  const debit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance - ?
    WHERE guild = ? AND user = ? AND balance >= ?
  `);
  const credit = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ? AND balance + ? <= ?
  `);
  const insertEscrow = db.prepare(`
    INSERT INTO milan_xo_escrow
      (game_id, guild, player_x, player_o, stake, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'held', ?)
  `);
  const insertFunding = db.prepare(`
    INSERT INTO milan_xo_funding (game_id, x_virtual, o_virtual)
    VALUES (?, ?, ?)
  `);
  const escrow = db.prepare(
    "SELECT * FROM milan_xo_escrow WHERE game_id = ?"
  );
  const funding = db.prepare(
    "SELECT x_virtual, o_virtual FROM milan_xo_funding WHERE game_id = ?"
  );
  const closeEscrow = db.prepare(`
    UPDATE milan_xo_escrow
    SET status = ?, winner = ?, settled_at = ?
    WHERE game_id = ? AND status = 'held'
  `);
  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
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

  function hold(game, opponent, xVirtual, oVirtual) {
    return transaction(() => {
      if (escrow.get(game.id)) return { error: "This game was already recorded." };

      ensure.run(game.guild, game.x);
      ensure.run(game.guild, opponent);

      const xBalance = wallet.get(game.guild, game.x).balance;
      const oBalance = wallet.get(game.guild, opponent).balance;

      if (!xVirtual && xBalance < game.stake) {
        return { error: "The creator does not have enough saved Coin." };
      }
      if (!oVirtual && oBalance < game.stake) {
        return { error: "You do not have enough saved Coin." };
      }

      // Preserve the current pre-game cap check for ordinary accounts.
      if ((!xVirtual && xBalance + game.stake > MAX_BALANCE) ||
          (!oVirtual && oBalance + game.stake > MAX_BALANCE)) {
        return { error: "A possible payout would exceed the balance limit." };
      }

      const now = Date.now();

      if (!xVirtual) {
        const result = debit.run(game.stake, game.guild, game.x, game.stake);
        if (Number(result.changes) !== 1) throw new Error("Creator debit failed");
      }
      if (!oVirtual) {
        const result = debit.run(game.stake, game.guild, opponent, game.stake);
        if (Number(result.changes) !== 1) throw new Error("Opponent debit failed");
      }

      insertEscrow.run(game.id, game.guild, game.x, opponent, game.stake, now);
      insertFunding.run(game.id, xVirtual ? 1 : 0, oVirtual ? 1 : 0);

      record.run(game.guild, game.x, opponent,
        xVirtual ? "xo_virtual_hold" : "xo_hold", game.stake, now);
      record.run(game.guild, opponent, game.x,
        oVirtual ? "xo_virtual_hold" : "xo_hold", game.stake, now);

      return { ok: true };
    });
  }

  function settle(id, winner, reason) {
    return transaction(() => {
      const row = escrow.get(id);
      if (!row) return { status: "none" };
      if (row.status !== "held") return { status: row.status, row };

      const mode = funding.get(id);
      // Missing funding means an older round: never guess how to pay it.
      if (!mode || (winner !== row.player_x && winner !== row.player_o)) {
        const changed = closeEscrow.run("review", null, Date.now(), id);
        if (Number(changed.changes) !== 1) throw new Error("Review update failed");
        record.run(row.guild, row.player_x, row.player_o, "xo_review", row.stake, Date.now());
        return { status: "review", row, reason };
      }

      const virtual = winner === row.player_x
        ? Boolean(mode.x_virtual) : Boolean(mode.o_virtual);
      const pot = row.stake * 2;

      if (!virtual) {
        ensure.run(row.guild, winner);
        const current = wallet.get(row.guild, winner).balance;
        if (current + pot > MAX_BALANCE) {
          const changed = closeEscrow.run("review", null, Date.now(), id);
          if (Number(changed.changes) !== 1) throw new Error("Review update failed");
          record.run(row.guild, winner, null, "xo_review_cap", pot, Date.now());
          return { status: "review", row, reason: "balance cap" };
        }
        const paid = credit.run(pot, row.guild, winner, pot, MAX_BALANCE);
        if (Number(paid.changes) !== 1) throw new Error("Payout failed");
      }

      const changed = closeEscrow.run("won", winner, Date.now(), id);
      if (Number(changed.changes) !== 1) throw new Error("Settlement update failed");
      record.run(
        row.guild, winner, null,
        virtual ? "xo_virtual_win" : "xo_payout",
        pot, Date.now()
      );

      return {
        status: "won",
        row,
        winner,
        virtual,
        balance: virtual ? null : wallet.get(row.guild, winner).balance,
      };
    });
  }

  // Only one bot instance may use this database.
  const pending = db.prepare(
    "SELECT game_id FROM milan_xo_escrow WHERE status = 'held'"
  ).all();
  for (const row of pending) settle(row.game_id, null, "restart");
  if (pending.length) {
    console.log(`XO marked ${pending.length} unfinished game(s) for staff review.`);
  }

  function winnerOf(board) {
    for (const [a, b, c] of winningLines) {
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

  function panel(text, rows = []) {
    return {
      flags: FLAG,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN / XO" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text },
          ...rows,
        ],
      }],
      allowedMentions: { parse: [], repliedUser: false },
    };
  }

  function waitingPayload(game) {
    return panel(
      `Player 01: <@${game.x}>\n` +
      `Stake: **${game.stake.toLocaleString("en-US")} Coin per player**\n` +
      `Another player can join within **15 seconds**.\n` +
      `Otherwise a free game against MILAN starts.`,
      [{
        type: 1,
        components: [{
          type: 2,
          style: 1,
          custom_id: `milan_xo:${game.id}:join`,
          label: "Join game",
        }],
      }]
    );
  }

  function boardPayload(game, text, disabled = false) {
    const rows = [];
    for (let row = 0; row < 3; row++) {
      const buttons = [];
      for (let col = 0; col < 3; col++) {
        const index = row * 3 + col;
        const mark = game.board[index];
        buttons.push({
          type: 2,
          style: mark === "X" ? 1 : mark === "O" ? 3 : 2,
          custom_id: `milan_xo:${game.id}:${index}`,
          label: mark || String(index + 1),
          disabled: disabled || Boolean(mark),
        });
      }
      rows.push({ type: 1, components: buttons });
    }
    return panel(`${text}\n\nGame ID: \`${game.id}\``, rows);
  }

  function activeText(game) {
    if (game.state === "bot") {
      return `<@${game.x}> **X** vs **MILAN O**\nFree game · Your turn.`;
    }
    return `<@${game.x}> **X** vs <@${game.o}> **O**\n` +
      `Pot: **${(game.stake * 2).toLocaleString("en-US")} Coin**\n` +
      `Turn: <@${game.turn === "X" ? game.x : game.o}>`;
  }

  async function logResult(guild, result, reason) {
    if (!result?.row) return;
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;
      await channel.send(panel(
        `Game: \`${result.row.game_id}\`\n` +
        `Players: <@${result.row.player_x}> / <@${result.row.player_o}>\n` +
        `Stake per player: **${result.row.stake} Coin**\n` +
        `Status: **${result.status}**\n` +
        `Reason: ${reason}`
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
        ...panel("Usage: `.xo 100`\nMinimum stake: **100 Coin**."),
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
      deadline: 0,
      timer: null,
      collector: null,
      msg: null,
    };

    function cancelTimer() {
      if (game.timer) clearTimeout(game.timer);
      game.timer = null;
    }

    async function finish(text, winner, reason) {
      if (game.state === "ended" || game.state === "settling") return;
      const previous = game.state;
      game.state = "settling";
      cancelTimer();

      let result;
      try {
        result = settle(game.id, winner, reason);
      } catch (error) {
        console.error("XO SETTLEMENT ERROR:", error);
        game.state = "ended";
        await game.msg.edit(boardPayload(
          game,
          `Settlement failed. Any held stake remains pending. ` +
          `Open a ticket with game ID \`${game.id}\`.`,
          true
        )).catch(console.error);
        game.collector.stop("settlement-error");
        return;
      }

      game.state = "ended";

      if (previous === "pvp") {
        if (result.status === "won") {
          const pot = (game.stake * 2).toLocaleString("en-US");
          text = result.virtual
            ? `Winner: <@${result.winner}>\n` +
              `Pot: **${pot} Coin** (both stakes)\n` +
              `Unlimited balance: **∞**. No payout was added to saved balance.`
            : `Winner: <@${result.winner}>\n` +
              `Payout: **${pot} Coin** (both stakes)\n` +
              `Saved balance after settlement: **${result.balance.toLocaleString("en-US")} Coin**`;
        } else {
          text = `Stakes are pending staff review. Open a ticket with game ID \`${game.id}\`.`;
        }
      }

      await game.msg.edit(boardPayload(game, text, true)).catch(error => {
        console.error("XO FINAL DISPLAY ERROR:", error);
      });
      await logResult(message.guild, result, reason);
      game.collector.stop("finished");
    }

    function startTurnTimer() {
      cancelTimer();
      game.deadline = Date.now() + TURN_MS;
      game.timer = setTimeout(() => {
        if (!["pvp", "bot"].includes(game.state)) return;
        void finish(
          "Time expired.",
          null,
          "turn timeout"
        ).catch(console.error);
      }, TURN_MS);
    }

    async function startBot() {
      if (game.state !== "waiting") return;
      game.state = "bot";
      game.o = "bot";
      game.turn = "X";
      cancelTimer();

      try {
        await game.msg.edit(boardPayload(game, activeText(game)));
        if (game.state === "bot") startTurnTimer();
      } catch (error) {
        console.error("XO BOT DISPLAY ERROR:", error);
        await finish("Could not start the free game.", null, "bot display error");
      }
    }

    try {
      game.msg = await message.reply({
        ...waitingPayload(game),
        failIfNotExists: false,
      });
      games.set(game.id, game);
      game.deadline = Date.now() + JOIN_MS;

      game.collector = game.msg.createMessageComponentCollector({
        time: JOIN_MS + 20 * TURN_MS,
      });

      game.timer = setTimeout(() => {
        void startBot().catch(console.error);
      }, JOIN_MS);

      game.collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;
        const prefix = `milan_xo:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        if (game.busy) {
          await interaction.reply({
            content: "Please wait for the current action.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        const action = interaction.customId.slice(prefix.length);

        if (action === "join") {
          if (game.state !== "waiting" || Date.now() >= game.deadline) {
            await interaction.reply({
              content: "Joining time has ended.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            if (game.state === "waiting") void startBot().catch(console.error);
            return;
          }

          if (interaction.user.id === game.x || interaction.user.bot) {
            await interaction.reply({
              content: "Another member must join this game.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          game.busy = true;
          const opponent = interaction.user.id;

          try {
            // Acknowledge promptly while roles are fetched.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const [creatorMember, opponentMember] = await Promise.all([
              message.guild.members.fetch({ user: game.x, force: true }),
              message.guild.members.fetch({ user: opponent, force: true }),
            ]);

            // The timer may have started the bot while roles were fetched.
            if (game.state !== "waiting" || Date.now() >= game.deadline) {
              await interaction.editReply("Joining time has ended; the game cannot be joined.");
              if (game.state === "waiting") void startBot().catch(console.error);
              return;
            }

            // No await between this state transition and the database transaction.
            game.state = "joining";
            cancelTimer();

            const xVirtual = creatorMember.roles.cache.has(UNLIMITED_ROLE);
            const oVirtual = opponentMember.roles.cache.has(UNLIMITED_ROLE);
            const result = hold(game, opponent, xVirtual, oVirtual);

            if (!result.ok) {
              game.state = "waiting";
              const remaining = Math.max(0, game.deadline - Date.now());
              game.timer = setTimeout(() => {
                void startBot().catch(console.error);
              }, remaining);
              await interaction.editReply(result.error);
              return;
            }

            game.o = opponent;
            game.state = "pvp";
            game.turn = "X";

            try {
              await game.msg.edit(boardPayload(game, activeText(game)));
              startTurnTimer();
              await interaction.editReply("You joined the game.").catch(() => {});
            } catch (error) {
              console.error("XO JOIN DISPLAY ERROR:", error);
              await interaction.editReply(
                `Game display failed. Stakes require review; open a ticket with game ID ${game.id}.`
              ).catch(() => {});
              await finish("Game display failed.", null, "join display error");
            }
          } catch (error) {
            console.error("XO JOIN ERROR:", error);
            await interaction.editReply(
              "Could not join. If stakes were held, open a ticket with the game ID."
            ).catch(() => {});
            if (game.state === "joining" || game.state === "pvp") {
              await finish("Game stopped.", null, "join error").catch(console.error);
            }
          } finally {
            game.busy = false;
          }
          return;
        }

        if (!["pvp", "bot"].includes(game.state)) {
          await interaction.reply({
            content: "This game is not active.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        if (Date.now() >= game.deadline) {
          await interaction.reply({
            content: "This turn has expired.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          void finish("Time expired.", null, "turn timeout").catch(console.error);
          return;
        }

        if (!/^[0-8]$/.test(action) || game.board[Number(action)]) {
          await interaction.reply({
            content: "This cell is not available.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        const expected = game.turn === "X" ? game.x : game.o;
        if (interaction.user.id !== expected) {
          await interaction.reply({
            content: "It is not your turn.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        game.busy = true;
        cancelTimer();

        try {
          // Change the board synchronously before awaiting Discord.
          game.board[Number(action)] = game.turn;
          let result = winnerOf(game.board);

          if (!result && game.state === "bot") {
            game.board[botMove(game.board)] = "O";
            result = winnerOf(game.board);
          } else if (!result) {
            game.turn = game.turn === "X" ? "O" : "X";
          }

          await interaction.deferUpdate();

          if (result) {
            const winner = game.state === "pvp" && result !== "draw"
              ? (result === "X" ? game.x : game.o)
              : null;
            const text = result === "draw"
              ? "Draw."
              : game.state === "bot"
              ? (result === "X" ? "You won the free game." : "MILAN won the free game.")
              : "Settling game.";
            await finish(text, winner, result);
            return;
          }

          await game.msg.edit(boardPayload(game, activeText(game)));
          startTurnTimer();
        } catch (error) {
          console.error("XO INTERACTION ERROR:", error);
          await finish("Game stopped.", null, "interaction error").catch(console.error);
        } finally {
          game.busy = false;
        }
      });

      game.collector.on("end", async (_collected, reason) => {
        cancelTimer();
        games.delete(game.id);
        if (game.state !== "ended" && game.state !== "settling") {
          await finish("Game closed.", null, reason).catch(console.error);
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