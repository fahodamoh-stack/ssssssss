"use strict";

const {
  Events,
  MessageFlags,
  AttachmentBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { randomInt } = require("node:crypto");
const { createWheelGif } = require("./wheelVisual");

module.exports = function registerMilanDailyWheel(client, db) {
  const CHANNEL = "1560996851640045710";
  const PIC_ROLE = "1563058044856696932";
  const LOG_CHANNEL = "1566559654924914728";
  const COOLDOWN = 24 * 60 * 60 * 1000;
  const MAX_BALANCE = 1_000_000_000;
  const COIN = "<:coin:1568543923964616705>";

  const prizes = [
    { label: "Coin", amount: 40,  weight: 20, rarity: "Common" },
    { label: "Coin", amount: 50,  weight: 17, rarity: "Common" },
    { label: "Coin", amount: 100, weight: 10, rarity: "Rare" },
    { label: "XP", amount: 100,   weight: 18, rarity: "Common" },
    { label: "XP", amount: 250,   weight: 14, rarity: "Uncommon" },
    { label: "XP", amount: 350,   weight: 11, rarity: "Rare" },
    { label: "XP", amount: 500,   weight: 9,  rarity: "Epic" },
    { label: "PIC", amount: 1,    weight: 1,  rarity: "Legendary" }
  ];

  const busy = new Set();

  for (const table of ["fizzy_wallets", "fizzy_transactions", "level_members"]) {
    if (!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table)) {
      throw new Error(`Daily wheel requires ${table}.`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_daily_wheel (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      last_spin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild, user)
    );

    CREATE TABLE IF NOT EXISTS milan_daily_wheel_rounds (
      message_id TEXT PRIMARY KEY,
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      prize TEXT NOT NULL,
      amount INTEGER NOT NULL,
      rarity TEXT NOT NULL,
      winner_index INTEGER NOT NULL,
      segments TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS milan_wheel_pending
      ON milan_daily_wheel_rounds(guild, user, status);
  `);

  function tx(fn) {
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

  const pendingQuery = db.prepare(`
    SELECT * FROM milan_daily_wheel_rounds
    WHERE guild = ? AND user = ? AND status = 'pending_role'
    ORDER BY created_at ASC LIMIT 1
  `);

  function choose(list) {
    const total = list.reduce((sum, item) => sum + item.weight, 0);
    let n = randomInt(total);
    for (let i = 0; i < list.length; i++) {
      n -= list[i].weight;
      if (n < 0) return i;
    }
    throw new Error("Wheel selection failed.");
  }

  function panel(title, text) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: `### MILAN • ${title}` },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  function awardRound(message, hasPic) {
    return tx(() => {
      const guild = message.guild.id;
      const user = message.author.id;
      const now = Date.now();

      const existing = db.prepare(
        "SELECT * FROM milan_daily_wheel_rounds WHERE message_id = ?"
      ).get(message.id);

      if (existing) return { duplicate: true };

      const pending = pendingQuery.get(guild, user);
      if (pending) return { pending };

      const cooldown = db.prepare(
        "SELECT last_spin FROM milan_daily_wheel WHERE guild = ? AND user = ?"
      ).get(guild, user);

      const wait = cooldown ? cooldown.last_spin + COOLDOWN - now : 0;
      if (wait > 0) return { wait };

      // Reject before the draw if any possible Coin prize would exceed the cap.
      db.prepare(
        "INSERT OR IGNORE INTO fizzy_wallets (guild, user) VALUES (?, ?)"
      ).run(guild, user);

      const wallet = db.prepare(
        "SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?"
      ).get(guild, user);

      if (wallet.balance + 100 > MAX_BALANCE) return { limit: true };

      const available = prizes.filter(p => !(hasPic && p.label === "PIC"));
      const index = choose(available);
      const prize = available[index];
      const segments = available.map(p => ({ label: p.label }));
      let status = "delivered";

      if (prize.label === "Coin") {
        db.prepare(`
          UPDATE fizzy_wallets SET balance = balance + ?
          WHERE guild = ? AND user = ?
        `).run(prize.amount, guild, user);

        db.prepare(`
          INSERT INTO fizzy_transactions
            (guild, actor, target, kind, amount, created_at)
          VALUES (?, ?, NULL, 'daily_wheel', ?, ?)
        `).run(guild, user, prize.amount, now);
      } else if (prize.label === "XP") {
        db.prepare(`
          INSERT OR IGNORE INTO level_members
            (guild, user, xp, level, messages, last_xp_at)
          VALUES (?, ?, 0, 0, 0, 0)
        `).run(guild, user);

        const current = db.prepare(
          "SELECT xp FROM level_members WHERE guild = ? AND user = ?"
        ).get(guild, user);

        const newXp = Number(current.xp) + prize.amount;
        if (!Number.isSafeInteger(newXp)) {
          throw new Error("XP exceeds the safe integer range.");
        }

        // Matches the existing levelSystem.js curve.
        const level = Math.floor(Math.sqrt(newXp / 10));

        db.prepare(`
          UPDATE level_members SET xp = ?, level = ?
          WHERE guild = ? AND user = ?
        `).run(newXp, level, guild, user);
      } else {
        status = "pending_role";
      }

      db.prepare(`
        INSERT INTO milan_daily_wheel_rounds
          (message_id, guild, user, prize, amount, rarity,
           winner_index, segments, status, created_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id, guild, user, prize.label, prize.amount, prize.rarity,
        index, JSON.stringify(segments), status, now,
        status === "delivered" ? now : null
      );

      db.prepare(`
        INSERT INTO milan_daily_wheel (guild, user, last_spin)
        VALUES (?, ?, ?)
        ON CONFLICT(guild, user) DO UPDATE SET last_spin = excluded.last_spin
      `).run(guild, user, now);

      return {
        row: db.prepare(
          "SELECT * FROM milan_daily_wheel_rounds WHERE message_id = ?"
        ).get(message.id)
      };
    });
  }

  async function deliverRole(guild, row) {
    const member = await guild.members.fetch({
      user: row.user,
      force: true
    });

    if (!member.roles.cache.has(PIC_ROLE)) {
      const role = await guild.roles.fetch(PIC_ROLE);
      const me = await guild.members.fetchMe();

      if (!role || role.managed ||
          !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
          me.roles.highest.comparePositionTo(role) <= 0) {
        throw new Error("PIC role is unavailable or cannot be managed.");
      }

      await member.roles.add(role, `Daily wheel prize ${row.message_id}`);
    }

    tx(() => {
      db.prepare(`
        UPDATE milan_daily_wheel_rounds
        SET status = 'delivered', delivered_at = ?
        WHERE message_id = ? AND status = 'pending_role'
      `).run(Date.now(), row.message_id);
    });
  }

  async function logPrize(guild, row) {
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;

      await channel.send(panel(
        "WHEEL LOG",
        `Member: <@${row.user}>\n` +
        `Round: \`${row.message_id}\`\n` +
        `Prize: **${row.prize} ${row.amount}**\n` +
        `Rarity: **${row.rarity}**`
      ));
    } catch (error) {
      console.error("WHEEL LOG ERROR:", error);
    }
  }

  async function display(message, row) {
    const segments = JSON.parse(row.segments);
    const prizeText = row.prize === "PIC"
      ? "PIC ROLE"
      : `${row.amount} ${row.prize}`;

    const image = await createWheelGif(
      segments,
      row.winner_index,
      `YOU WIN + ${prizeText}`
    );

    const avatar = message.author.displayAvatarURL({
      extension: "png",
      size: 128,
      forceStatic: true
    });

    const name = message.author.username
      .replace(/[`*_~|\\<>@\r\n]/g, "")
      .slice(0, 80) || "Member";

    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN • DAILY WHEEL" },
          {
            type: 12,
            items: [{
              media: { url: "attachment://milan-wheel.gif" },
              description: "Daily prize wheel"
            }]
          },
          {
            type: 9,
            components: [{
              type: 10,
              content:
                `**${name}**\n` +
                `You won: **${prizeText}**\n` +
                `Rarity: **${row.rarity}**`
            }],
            accessory: {
              type: 11,
              media: { url: avatar },
              description: "Winner avatar"
            }
          }
        ]
      }],
      files: [new AttachmentBuilder(image, { name: "milan-wheel.gif" })],
      allowedMentions: { parse: [], repliedUser: false },
      failIfNotExists: false
    });
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if ((message.content || "").trim() !== ".\u062d\u0638") return;

    const reply = text => message.reply({
      ...panel("DAILY WHEEL", text),
      failIfNotExists: false
    }).catch(console.error);

    if (message.channel.id !== CHANNEL) {
      await reply(`Use this command in <#${CHANNEL}>.`);
      return;
    }

    const key = `${message.guild.id}:${message.author.id}`;
    if (busy.has(key)) {
      await reply("Your wheel is already being processed.");
      return;
    }

    busy.add(key);
    try {
      let row = pendingQuery.get(message.guild.id, message.author.id);

      if (row) {
        try {
          await deliverRole(message.guild, row);
          await reply(
            "**PIC role delivered.** Your previous prize is complete.\n" +
            "Your daily cooldown still applies."
          );
          await logPrize(message.guild, row);
        } catch (error) {
          console.error("WHEEL PIC DELIVERY ERROR:", error);
          await reply(
            "Your PIC prize is still pending. Ask staff to check the role " +
            "and bot permissions, then use `.حظ` again."
          );
        }
        return;
      }

      const member = await message.guild.members.fetch({
        user: message.author.id,
        force: true
      }).catch(() => null);

      if (!member) {
        await reply("Could not verify your roles. Please try again.");
        return;
      }

      const result = awardRound(message, member.roles.cache.has(PIC_ROLE));

      if (result.duplicate) return;
      if (result.pending) {
        await reply("You have a pending PIC prize. Use `.حظ` again to retry.");
        return;
      }
      if (result.wait) {
        const minutes = Math.ceil(result.wait / 60_000);
        await reply(`Next spin in **${minutes} minutes**.`);
        return;
      }
      if (result.limit) {
        await reply(
          `Your saved balance is too close to the maximum for a possible ` +
          `${COIN} reward. No spin was used.`
        );
        return;
      }

      row = result.row;

      if (row.status === "pending_role") {
        try {
          await deliverRole(message.guild, row);
        } catch (error) {
          console.error("WHEEL PIC DELIVERY ERROR:", error);
          await reply(
            "**PIC prize selected**, but the role could not be delivered. " +
            "It is saved as pending. Ask staff to fix permissions, " +
            "then use `.حظ` again."
          );
          return;
        }
      }

      try {
        await display(message, row);
      } catch (error) {
        console.error("WHEEL DISPLAY ERROR:", error);
        const prize = row.prize === "PIC"
          ? "PIC role"
          : `${row.amount} ${row.prize}`;

        await reply(
          `Your prize was delivered: **${prize}**.\n` +
          `Rarity: **${row.rarity}**\n` +
          "The GIF could not be displayed; check the bot console."
        );
      }

      await logPrize(message.guild, row);
    } catch (error) {
      console.error("DAILY WHEEL ERROR:", error);
      await reply(
        "The wheel could not be completed. Check the console before trying again."
      );
    } finally {
      busy.delete(key);
    }
  });

  console.log("MILAN DAILY WHEEL LOADED");
};