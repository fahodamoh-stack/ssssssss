const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
} = require("discord.js");

const visual = require("./levelVisual");

const RANK_CHANNEL = "1560996851640045710";
const LOG_CHANNEL = "1560996906686091284";
const LEADERBOARD_EMOJI = "1568544453734703135";
const PAGE_SIZE = 10;

function tierForLevel(level) {
  if (level >= 50) return "legend";
  if (level >= 25) return "elite";
  if (level >= 10) return "active";
  return "regular";
}

module.exports = function registerRankSlash(client, db) {
  // levelSystem must register first and create level_members.
  const exists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'level_members'
  `).get();

  if (!exists) {
    throw new Error(
      "RANK: level_members missing. Register levelSystem before rankSlash."
    );
  }

  const ensureMember = db.prepare(`
    INSERT OR IGNORE INTO level_members
      (guild, user, xp, level, messages, last_xp_at)
    VALUES (?, ?, 0, 0, 0, 0)
  `);

  const getMember = db.prepare(`
    SELECT xp, level, messages
    FROM level_members
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

  const countMembers = db.prepare(`
    SELECT COUNT(*) AS total
    FROM level_members
    WHERE guild = ?
  `);

  const getPage = db.prepare(`
    SELECT user, xp, level
    FROM level_members
    WHERE guild = ?
    ORDER BY xp DESC, user ASC
    LIMIT ? OFFSET ?
  `);

  async function logError(guild, context, error) {
    console.error(`RANK ${context}:`, error);

    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);
      if (!channel?.isTextBased() || !channel.send) return;

      await channel.send({
        content:
          `**MILAN RANK ERROR**\n` +
          `Context: ${context}\n` +
          `Error: ${String(error?.message || error).slice(0, 500)}`,
        allowedMentions: { parse: [] },
      });
    } catch (logError) {
      console.error("RANK LOG ERROR:", logError);
    }
  }

  async function registerCommand(guild) {
    try {
      await guild.commands.create({
        name: "rank",
        description: "Show your MILAN rank card",
        dm_permission: false,
      });

      console.log(`RANK SLASH READY [${guild.id}]`);
    } catch (error) {
      await logError(guild, "COMMAND REGISTRATION", error);
    }
  }

  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) {
      await registerCommand(guild);
    }
  });

  client.on(Events.GuildCreate, guild => {
    registerCommand(guild).catch(console.error);
  });

  function leaderboardButton() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("milan_rank:leaderboard:0")
        .setLabel("Leaderboard")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: LEADERBOARD_EMOJI })
    );
  }

  function leaderboardPayload(guildId, userId, requestedPage) {
    ensureMember.run(guildId, userId);

    const member = getMember.get(guildId, userId);
    const rank = getRank.get(
      guildId,
      member.xp,
      member.xp,
      userId
    ).rank;

    const total = countMembers.get(guildId).total;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.max(
      0,
      Math.min(requestedPage, totalPages - 1)
    );

    const rows = getPage.all(guildId, PAGE_SIZE, page * PAGE_SIZE);

    const lines = rows.map((row, index) => {
      const position = page * PAGE_SIZE + index + 1;
      return `**#${position}** <@${row.user}> — **${row.xp.toLocaleString()} XP**`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x203234)
      .setTitle("MILAN • XP LEADERBOARD")
      .setDescription([
        lines.join("\n") || "No members yet.",
        "",
        `**Your Rank: #${rank}**`,
      ].join("\n"))
      .setFooter({ text: `Page ${page + 1} / ${totalPages}` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`milan_rank:leaderboard:${Math.max(0, page - 1)}:previous`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),

      new ButtonBuilder()
        .setCustomId(`milan_rank:leaderboard:${Math.min(totalPages - 1, page + 1)}:next`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    return {
      embeds: [embed],
      components: [buttons],
      allowedMentions: { parse: [] },
    };
  }

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.inGuild()) return;

    const isRank =
      interaction.isChatInputCommand() &&
      interaction.commandName === "rank";

    const isLeaderboard =
      interaction.isButton() &&
      interaction.customId.startsWith("milan_rank:leaderboard:");

    if (!isRank && !isLeaderboard) return;

    try {
      if (isRank) {
        if (interaction.channelId !== RANK_CHANNEL) {
          await interaction.reply({
            content: `Use this command in <#${RANK_CHANNEL}>.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        await interaction.deferReply();

        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        ensureMember.run(guildId, userId);

        const row = getMember.get(guildId, userId);
        const rank = getRank.get(
          guildId,
          row.xp,
          row.xp,
          userId
        ).rank;

        const startXp = 100 * row.level * row.level;
        const nextXp = 100 * (row.level + 1) * (row.level + 1);
        const currentXp = row.xp - startXp;
        const neededXp = nextXp - startXp;
        const percent = Math.max(
          0,
          Math.min(100, Math.floor(currentXp / neededXp * 100))
        );


        const barSize = 20;
        const filled = Math.round(percent / 100 * barSize);
        const bar = "▬".repeat(filled) + "─".repeat(barSize - filled);

        const avatarUrl = interaction.user.displayAvatarURL({
          extension: "png",
          size: 256,
          forceStatic: true,
        });

        await interaction.editReply({
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
                    `### ${interaction.user.username}'s Rank`,
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
                  `${bar}`,
                  `**${currentXp.toLocaleString()} / ${neededXp.toLocaleString()} XP (${percent}%)**`,
                  "",
                  `<:stats:1568543925579415622> **Rank:** #${rank}`,
                  `<:xp:1568543922756522054> **Total XP:** ${row.xp.toLocaleString()}`,
                  `<:coins:1568543923964616705> **Coins:** ${rankExtraStats(guildId, userId).coins}`,
                  `<:messages:1568543919833350204> **Messages:** ${row.messages.toLocaleString()}`,
                  `<:voice:1568543927089364992> **Voice:** ${rankExtraStats(guildId, userId).voice}`,
                ].join("\n"),
              },
              leaderboardButton().toJSON(),
            ],
          }],
          allowedMentions: { parse: [] },
        });

        return;
      }

      const rawPage = interaction.customId.split(":")[2];
      const page = Number(rawPage);

      if (!Number.isSafeInteger(page) || page < 0) {
        await interaction.reply({
          content: "Invalid leaderboard page.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Each viewer gets a private leaderboard with their own rank.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await interaction.editReply(
        leaderboardPayload(interaction.guildId, interaction.user.id, page)
      );
    } catch (error) {
      await logError(interaction.guild, "INTERACTION", error);

      const text = "Could not open rank. Check the bot log.";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: text,
          embeds: [],
          components: [],
        }).catch(console.error);
      } else {
        await interaction.reply({
          content: text,
          flags: MessageFlags.Ephemeral,
        }).catch(console.error);
      }
    }
  });
};