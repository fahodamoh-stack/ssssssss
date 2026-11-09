const {
  Events,
  MessageFlags,
  EmbedBuilder,
} = require("discord.js");

const CONFIG = {
  rankChannelId: "1560996851640045710",
  levelUpChannelId: "1560996854072615053",

  // XP earned per eligible message.
  minXp: 15,
  maxXp: 25,

  // Time between XP awards per member.
  cooldownMs: 60_000,

  // Set RANK_GIF_URL in .env to show a GIF above the rank card.
  rankGifUrl: process.env.RANK_GIF_URL || "",

  // Set LEVEL_GIF_URL in .env to show a GIF in level-up messages.
  levelGifUrl: process.env.LEVEL_GIF_URL || "",

  // Tier names and minimum levels.
  tiers: [
    { level: 0, name: "regular" },
    { level: 10, name: "active" },
    { level: 25, name: "elite" },
    { level: 50, name: "legend" },
  ],
};

// Total XP required to reach a level.
function xpForLevel(level) {
  return 150 * level * level;
}

function calculateLevel(xp) {
  return Math.floor(Math.sqrt(xp / 150));
}

function tierForLevel(level) {
  let selected = CONFIG.tiers[0].name;

  for (const tier of CONFIG.tiers) {
    if (level >= tier.level) selected = tier.name;
  }

  return selected;
}

function progressBar(percent) {
  const size = 20;
  const filled = Math.round((percent / 100) * size);

  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

function validHttpsUrl(value) {
  if (!value) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = function registerLevelSystem(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS level_members (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      last_xp_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild, user)
    );

    CREATE INDEX IF NOT EXISTS level_members_rank
    ON level_members(guild, xp DESC, user);
  `);

  // MILAN_XP_CURVE_1500K
  // Preserve XP and recalculate stored levels using the current curve.
  // This is idempotent and runs before commands are registered.
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(
      "SELECT guild, user, xp, level FROM level_members"
    ).all();

    const updateLevel = db.prepare(
      "UPDATE level_members SET level = ? WHERE guild = ? AND user = ?"
    );

    let changed = 0;
    for (const row of rows) {
      const xp = Number(row.xp);
      if (!Number.isSafeInteger(xp) || xp < 0) {
        throw new Error("Invalid XP in level_members; migration rolled back.");
      }

      const level = calculateLevel(xp);
      if (Number(row.level) !== level) {
        updateLevel.run(level, row.guild, row.user);
        changed++;
      }
    }

    db.exec("COMMIT");
    console.log(`MILAN XP CURVE READY: ${changed} stored level(s) updated.`);
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  const ensureMember = db.prepare(`
    INSERT OR IGNORE INTO level_members
      (guild, user, xp, level, messages, last_xp_at)
    VALUES (?, ?, 0, 0, 0, 0)
  `);

  const getMember = db.prepare(`
    SELECT xp, level, messages, last_xp_at
    FROM level_members
    WHERE guild = ? AND user = ?
  `);

  const awardXp = db.prepare(`
    UPDATE level_members
    SET xp = xp + ?,
        level = ?,
        last_xp_at = ?
    WHERE guild = ? AND user = ?
      AND last_xp_at <= ?
  `);

  const countMessage = db.prepare(`
    UPDATE level_members
    SET messages = messages + 1
    WHERE guild = ? AND user = ?
  `);

  function rankExtraStats(guildId, userId) {
    const hasTable = db.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?"
    );

    let coins = 0;
    let voiceMs = 0;

    if (hasTable.get("fizzy_wallets")) {
      const wallet = db.prepare(
        "SELECT balance FROM fizzy_wallets WHERE guild = ? AND user = ?"
      ).get(guildId, userId);

      coins = Number(wallet?.balance || 0);
    }

    if (hasTable.get("voice_activity")) {
      const voice = db.prepare(
        "SELECT total_ms FROM voice_activity WHERE guild = ? AND user = ?"
      ).get(guildId, userId);

      voiceMs = Number(voice?.total_ms || 0);
    }

    const minutes = Math.floor(Math.max(0, voiceMs) / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return {
      coins: coins.toLocaleString("en-US"),
      voice: `${hours}h ${remainingMinutes}m`,
    };
  }
  const getRank = db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM level_members
    WHERE guild = ?
      AND (xp > ? OR (xp = ? AND user < ?))
  `);

  const { AttachmentBuilder } = require("discord.js");
  const levelVisual = require("./levelVisual");

  async function announceLevelUp(message, newLevel) {
    const channel = await message.guild.channels
      .fetch(CONFIG.levelUpChannelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) {
      console.warn("LEVEL UP: announcement channel is unavailable.");
      return;
    }

    try {
      const image = await levelVisual.levelUpGif(message.author, newLevel, message.guild);

      await channel.send({
        content: `<@${message.author.id}>`,
        files: [
          new AttachmentBuilder(image, {
            name: `level-up-${message.author.id}.gif`,
          }),
        ],
        allowedMentions: {
          parse: [],
          users: [message.author.id],
        },
      });
    } catch (error) {
      console.error("LEVEL GIF ERROR:", error);

      // Keep the level announcement working if image generation fails.
      await channel.send({
        content: `LEVEL UP! <@${message.author.id}> — Level ${newLevel}`,
        allowedMentions: {
          parse: [],
          users: [message.author.id],
        },
      });
    }
  }

  async function sendRank(message) {
    if (message.channel.id !== CONFIG.rankChannelId) {
      await message.reply({
        content: `Use this command in <#${CONFIG.rankChannelId}>.`,
        allowedMentions: {
          parse: [],
          repliedUser: false,
        },
      });
      return;
    }

    const guildId = message.guild.id;
    const userId = message.author.id;

    ensureMember.run(guildId, userId);

    const row = getMember.get(guildId, userId);
    const rank = getRank.get(guildId, row.xp, row.xp, userId).rank;

    const levelStart = xpForLevel(row.level);
    const nextLevel = xpForLevel(row.level + 1);
    const currentXp = Math.max(0, row.xp - levelStart);
    const neededXp = nextLevel - levelStart;
    const percent = Math.max(
      0,
      Math.min(100, Math.floor((currentXp / neededXp) * 100))
    );

    const barSize = 16;
    const filled = Math.round((percent / 100) * barSize);
    const bar = "▬".repeat(filled) + "─".repeat(barSize - filled);

    const avatarUrl = message.author.displayAvatarURL({
      extension: "png",
      size: 256,
      forceStatic: true,
    });

    // Avoid Discord formatting or mentions in the displayed username.
    const username = message.author.username
      .replace(/[`*_~|\\<>@\r\n]/g, "")
      .slice(0, 80);

    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          {
            type: 9,
            components: [{
              type: 10,
              content: [
                `### ${username}'s Rank`,
                `Level ${row.level} · ${tierForLevel(row.level)} · Rank #${rank}`,
              ].join("\n"),
            }],
            accessory: {
              type: 11,
              media: { url: avatarUrl },
              description: "Member avatar",
            },
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 10,
            content: [
              bar,
              `**${currentXp.toLocaleString()} / ${neededXp.toLocaleString()} XP (${percent}%)**`,
              "",
              `<:xp:1568543922756522054> **Total XP:** ${row.xp.toLocaleString()}`,
              `<:coins:1568544045041586246> **Coins:** ${rankExtraStats(guildId, userId).coins}`,
              `<:messages:1568543919833350204> **Messages:** ${row.messages.toLocaleString()}`,
              `<:voice:1568543927089364992> **Voice:** ${rankExtraStats(guildId, userId).voice}`,
            ].join("\n"),
          },
          {
            type: 1,
            components: [{
              type: 2,
              style: 2,
              custom_id: "milan_rank:leaderboard:0",
              label: "Leaderboard",
              emoji: { id: "1568544453734703135" },
            }],
          },
        ],
      }],
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
    });
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const content = (message.content || "").trim();

    if (content.toLowerCase() === ".rank") {
      try {
        await sendRank(message);
      } catch (error) {
        console.error("RANK ERROR:", error);

        await message.reply({
          content: "Could not display rank. Check the bot console.",
          allowedMentions: {
            parse: [],
            repliedUser: false,
          },
        }).catch(console.error);
      }

      return;
    }

    // Ignore commands and messages without text or attachments.
    if (content.startsWith(".")) return;
    if (!content && message.attachments.size === 0) return;

    try {
      const guildId = message.guild.id;
      const userId = message.author.id;
      const now = Date.now();

      ensureMember.run(guildId, userId);

      // Message count includes eligible messages, even during XP cooldown.
      countMessage.run(guildId, userId);

      const row = getMember.get(guildId, userId);

      if (now - row.last_xp_at < CONFIG.cooldownMs) return;

      const amount =
        CONFIG.minXp +
        Math.floor(Math.random() * (CONFIG.maxXp - CONFIG.minXp + 1));

      const newLevel = calculateLevel(row.xp + amount);

      const result = awardXp.run(
        amount,
        newLevel,
        now,
        guildId,
        userId,
        now - CONFIG.cooldownMs
      );

      if (Number(result.changes) === 0) return;

      if (newLevel > row.level) {
        await announceLevelUp(message, newLevel);
      }
    } catch (error) {
      console.error("LEVEL XP ERROR:", error);
    }
  });
};