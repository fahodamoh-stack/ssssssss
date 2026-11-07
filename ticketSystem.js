const path = require("node:path");

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require("discord.js");

const P = PermissionsBitField.Flags;

const CONFIG = {
  categoryId: "1560996792202690680",
  staffRoleId: "1565446860359868508",
  logChannelId: "1560996917754859633",
  imagePath: path.join(__dirname, "t.png"),

  // Maximum messages included in one transcript.
  transcriptLimit: 1000,
};

const TYPES = {
  partner: {
    label: "Partner",
    emoji: "1568544375326380092",
    color: 0x9b59ff,
  },
  report: {
    label: "Report",
    emoji: "1568544096266752051",
    color: 0xe74c3c,
  },
  support: {
    label: "Support",
    emoji: "1568544172124807239",
    color: 0x3498db,
  },
  verify: {
    label: "Verify Girl",
    emoji: "1568544100142030929",
    color: 0xe77ab4,
  },
};

function safeLine(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .slice(0, 4000);
}

function isStaff(interaction) {
  const member = interaction.member;

  if (member?.permissions?.has(P.Administrator)) return true;

  const roles = member?.roles;
  if (Array.isArray(roles)) {
    return roles.includes(CONFIG.staffRoleId);
  }

  return Boolean(roles?.cache?.has(CONFIG.staffRoleId));
}

function buttons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("milan_ticket:claim")
      .setLabel("Claim")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("milan_ticket:close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

module.exports = function registerTicketSystem(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild TEXT NOT NULL,
      owner TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT,
      control_message TEXT,
      status TEXT NOT NULL,
      claimed_by TEXT,
      created_at INTEGER NOT NULL,
      closed_at INTEGER,
      closed_by TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS milan_one_active_ticket
    ON milan_tickets(guild, owner)
    WHERE status IN ('creating', 'open', 'closing');

    CREATE UNIQUE INDEX IF NOT EXISTS milan_ticket_channel
    ON milan_tickets(guild, channel)
    WHERE channel IS NOT NULL;
  `);

  const getByChannel = db.prepare(`
    SELECT * FROM milan_tickets
    WHERE guild = ? AND channel = ?
  `);

  const getActive = db.prepare(`
    SELECT * FROM milan_tickets
    WHERE guild = ? AND owner = ?
      AND status IN ('creating', 'open', 'closing')
    LIMIT 1
  `);

  async function getLogChannel(guild) {
    const channel = await guild.channels
      .fetch(CONFIG.logChannelId)
      .catch(() => null);

    if (!channel?.isTextBased() || !channel.send) {
      throw new Error("Ticket log channel unavailable.");
    }

    return channel;
  }

  async function log(guild, title, lines, files = []) {
    try {
      const channel = await getLogChannel(guild);

      const embed = new EmbedBuilder()
        .setColor(0x203234)
        .setTitle(`MILAN • TICKETS | ${title}`)
        .setDescription(lines.join("\n").slice(0, 4000))
        .setTimestamp();

      await channel.send({
        embeds: [embed],
        files,
        allowedMentions: { parse: [] },
      });

      return true;
    } catch (error) {
      console.error(`TICKET LOG [${title}]:`, error);
      return false;
    }
  }

  async function resolveEmoji(guild, id) {
    let emoji = client.emojis.cache.get(id);

    if (!emoji) {
      emoji = await guild.emojis.fetch(id).catch(() => null);
    }

    if (!emoji && client.application?.emojis) {
      emoji = await client.application.emojis.fetch(id).catch(() => null);
    }

    return emoji?.name && emoji.available !== false ? emoji : null;
  }

  async function makePanel(message) {
    if (!message.member?.permissions.has(P.Administrator)) {
      await message.reply({
        content: "This command is for administrators only.",
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    const guild = message.guild;
    const category = await guild.channels.fetch(CONFIG.categoryId).catch(() => null);
    const staffRole = await guild.roles.fetch(CONFIG.staffRoleId).catch(() => null);
    const me = guild.members.me || await guild.members.fetchMe();

    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error("Ticket category not found.");
    }

    if (!staffRole) {
      throw new Error("Ticket staff role not found.");
    }

    if (!me.permissions.has(P.ManageChannels)) {
      throw new Error("Bot needs Manage Channels.");
    }

    const options = [];

    for (const [value, type] of Object.entries(TYPES)) {
      const emoji = await resolveEmoji(guild, type.emoji);

      if (!emoji) {
        throw new Error(`Ticket emoji unavailable: ${type.emoji}`);
      }

      options.push({
        label: type.label,
        value,
        description: `Open a ${type.label} ticket`,
        emoji: {
          id: emoji.id,
          name: emoji.name,
          animated: Boolean(emoji.animated),
        },
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("milan_ticket:open")
      .setPlaceholder("Choose a ticket type")
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setColor(0x203234)
      .setTitle("MILAN • TICKET CENTER")
      .setDescription(
        "Choose a category below to open a private ticket.\n" +
        "You can have one active ticket at a time."
      )
      .setImage("attachment://t.png")
      .setFooter({ text: "MILAN • SUPPORT" });

    await message.channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      files: [
        new AttachmentBuilder(CONFIG.imagePath, { name: "t.png" }),
      ],
      allowedMentions: { parse: [] },
    });

    await log(guild, "PANEL CREATED", [
      `By: <@${message.author.id}>`,
      `Channel: <#${message.channelId}>`,
    ]);
  }

  async function openTicket(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const ownerId = interaction.user.id;
    const typeKey = interaction.values[0];
    const type = TYPES[typeKey];

    if (!type) {
      await interaction.editReply("Invalid ticket type.");
      return;
    }

    const active = getActive.get(guild.id, ownerId);

    if (active) {
      const location = active.channel
        ? `<#${active.channel}>`
        : "Your ticket is being prepared.";

      await interaction.editReply(`You already have an active ticket: ${location}`);
      return;
    }

    const category = await guild.channels.fetch(CONFIG.categoryId).catch(() => null);
    const staffRole = await guild.roles.fetch(CONFIG.staffRoleId).catch(() => null);
    const me = guild.members.me || await guild.members.fetchMe();

    if (!category || category.type !== ChannelType.GuildCategory || !staffRole) {
      throw new Error("Ticket category or staff role is unavailable.");
    }

    if (!me.permissions.has(P.ManageChannels)) {
      throw new Error("Bot needs Manage Channels.");
    }

    let ticketId;

    try {
      const result = db.prepare(`
        INSERT INTO milan_tickets
          (guild, owner, type, status, created_at)
        VALUES (?, ?, ?, 'creating', ?)
      `).run(guild.id, ownerId, typeKey, Date.now());

      ticketId = Number(result.lastInsertRowid);
    } catch (error) {
      // The unique index protects against two simultaneous clicks.
      if (getActive.get(guild.id, ownerId)) {
        await interaction.editReply("You already have an active ticket.");
        return;
      }
      throw error;
    }

    let channel;

    try {
      channel = await guild.channels.create({
        name: `${typeKey}-${ticketId}`,
        type: ChannelType.GuildText,
        parent: CONFIG.categoryId,
        topic: `MILAN ticket #${ticketId} | Owner: ${ownerId} | Type: ${type.label}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [P.ViewChannel],
          },
          {
            id: ownerId,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
              P.AttachFiles,
            ],
          },
          {
            id: CONFIG.staffRoleId,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
              P.AttachFiles,
            ],
          },
          {
            id: me.id,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
              P.ManageChannels,
              P.AttachFiles,
              P.EmbedLinks,
            ],
          },
        ],
        reason: `MILAN ticket #${ticketId} opened by ${ownerId}`,
      });

      // Save the channel as soon as Discord creates it.
      db.prepare(`
        UPDATE milan_tickets SET channel = ? WHERE id = ?
      `).run(channel.id, ticketId);

      const embed = new EmbedBuilder()
        .setColor(type.color)
        .setTitle(`MILAN • ${type.label.toUpperCase()} TICKET`)
        .setDescription([
          `Welcome <@${ownerId}>.`,
          "Please describe your request and the team will assist you.",
        ].join("\n"))
        .addFields(
          { name: "Ticket", value: `#${ticketId}`, inline: true },
          { name: "Type", value: type.label, inline: true },
          { name: "Claimed by", value: "Not claimed", inline: true }
        )
        .setFooter({ text: "MILAN • TICKET SYSTEM" })
        .setTimestamp();

      const control = await channel.send({
        content: `<@${ownerId}>`,
        embeds: [embed],
        components: [buttons()],
        allowedMentions: { parse: [], users: [ownerId] },
      });

      db.prepare(`
        UPDATE milan_tickets
        SET status = 'open', control_message = ?
        WHERE id = ? AND status = 'creating'
      `).run(control.id, ticketId);

      await interaction.editReply(`Ticket opened: <#${channel.id}>`);

      await log(guild, "OPENED", [
        `Ticket: #${ticketId}`,
        `Owner: <@${ownerId}>`,
        `Type: ${type.label}`,
        `Channel: <#${channel.id}>`,
      ]);
    } catch (error) {
      let deleted = !channel;

      if (channel) {
        deleted = await channel.delete("Ticket setup failed")
          .then(() => true)
          .catch(() => false);
      }

      // If cleanup failed, keep the ticket active so it is not duplicated.
      db.prepare(`
        UPDATE milan_tickets
        SET status = ?
        WHERE id = ?
      `).run(deleted ? "failed" : "open", ticketId);

      await log(guild, "OPEN FAILED", [
        `Ticket: #${ticketId}`,
        `Owner ID: ${ownerId}`,
        `Error: ${safeLine(error.message)}`,
        deleted ? "Partial channel cleaned up." : `Check channel: ${channel?.id}`,
      ]);

      throw error;
    }
  }

  async function claimTicket(interaction, ticket) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = db.prepare(`
      UPDATE milan_tickets
      SET claimed_by = ?
      WHERE id = ? AND status = 'open' AND claimed_by IS NULL
    `).run(interaction.user.id, ticket.id);

    if (Number(result.changes) === 0) {
      const current = getByChannel.get(interaction.guildId, interaction.channelId);

      await interaction.editReply(
        current?.claimed_by
          ? `Already claimed by <@${current.claimed_by}>.`
          : "This ticket is not open."
      );
      return;
    }

    const type = TYPES[ticket.type];

    const embed = new EmbedBuilder()
      .setColor(type?.color || 0x203234)
      .setTitle(`MILAN • ${(type?.label || "TICKET").toUpperCase()} TICKET`)
      .setDescription([
        `Welcome <@${ticket.owner}>.`,
        "Please describe your request and the team will assist you.",
      ].join("\n"))
      .addFields(
        { name: "Ticket", value: `#${ticket.id}`, inline: true },
        { name: "Type", value: type?.label || ticket.type, inline: true },
        { name: "Claimed by", value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: "MILAN • TICKET SYSTEM" })
      .setTimestamp();

    try {
      const control = await interaction.channel.messages.fetch(ticket.control_message);

      await control.edit({
        embeds: [embed],
        components: [buttons()],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await log(interaction.guild, "CLAIM DISPLAY ERROR", [
        `Ticket: #${ticket.id}`,
        `Error: ${safeLine(error.message)}`,
      ]);
    }

    await interaction.editReply("Ticket claimed successfully.");

    await log(interaction.guild, "CLAIMED", [
      `Ticket: #${ticket.id}`,
      `Staff: <@${interaction.user.id}>`,
      `Channel: <#${interaction.channelId}>`,
    ]);
  }

  async function createTranscript(channel, ticket) {
    let before;
    const collected = [];

    while (collected.length < CONFIG.transcriptLimit) {
      const remaining = CONFIG.transcriptLimit - collected.length;

      const batch = await channel.messages.fetch({
        limit: Math.min(100, remaining),
        ...(before ? { before } : {}),
      });

      if (!batch.size) break;

      collected.push(...batch.values());
      before = batch.last().id;

      if (batch.size < 100) break;
    }

    collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = [
      `MILAN TICKET #${ticket.id}`,
      `Guild: ${ticket.guild}`,
      `Channel: ${ticket.channel}`,
      `Owner: ${ticket.owner}`,
      `Type: ${ticket.type}`,
      `Messages collected: ${collected.length}`,
      `Limit: ${CONFIG.transcriptLimit}`,
      "",
    ];

    for (const message of collected) {
      lines.push(
        `[${new Date(message.createdTimestamp).toISOString()}] ` +
        `${safeLine(message.author?.tag || "Unknown")} (${message.author?.id || "unknown"})`
      );

      lines.push(`Content: ${safeLine(message.content || "[no text]")}`);

      for (const attachment of message.attachments.values()) {
        lines.push(`Attachment: ${safeLine(attachment.url)}`);
      }

      lines.push("");
    }

    return Buffer.from(lines.join("\n"), "utf8");
  }

  async function closeTicket(interaction, ticket) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const locked = db.prepare(`
      UPDATE milan_tickets
      SET status = 'closing'
      WHERE id = ? AND status = 'open'
    `).run(ticket.id);

    if (Number(locked.changes) === 0) {
      await interaction.editReply("This ticket is already closing or closed.");
      return;
    }

    try {
      const transcript = await createTranscript(interaction.channel, ticket);

      const sent = await log(
        interaction.guild,
        "TRANSCRIPT & CLOSE REQUEST",
        [
          `Ticket: #${ticket.id}`,
          `Owner: <@${ticket.owner}>`,
          `Closed by: <@${interaction.user.id}>`,
          `Claimed by: ${ticket.claimed_by ? `<@${ticket.claimed_by}>` : "Nobody"}`,
          `Transcript contains up to ${CONFIG.transcriptLimit} latest messages.`,
          "Transcript may contain private ticket content.",
        ],
        [
          new AttachmentBuilder(transcript, {
            name: `ticket-${ticket.id}.txt`,
          }),
        ]
      );

      if (!sent) {
        throw new Error("Could not send transcript to ticket log channel.");
      }

      await interaction.editReply("Transcript saved. Closing ticket...");

      await interaction.channel.delete(
        `MILAN ticket #${ticket.id} closed by ${interaction.user.id}`
      );

      db.prepare(`
        UPDATE milan_tickets
        SET status = 'closed', closed_at = ?, closed_by = ?
        WHERE id = ?
      `).run(Date.now(), interaction.user.id, ticket.id);

      await log(interaction.guild, "CLOSED", [
        `Ticket: #${ticket.id}`,
        `Owner ID: ${ticket.owner}`,
        `Closed by: <@${interaction.user.id}>`,
      ]);
    } catch (error) {
      db.prepare(`
        UPDATE milan_tickets
        SET status = 'open'
        WHERE id = ? AND status = 'closing'
      `).run(ticket.id);

      await log(interaction.guild, "CLOSE FAILED", [
        `Ticket: #${ticket.id}`,
        `Error: ${safeLine(error.message)}`,
      ]);

      await interaction.editReply(
        "Could not close the ticket safely. Check the ticket log."
      ).catch(console.error);
    }
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (message.content.trim().toLowerCase() !== ".tc") return;

    try {
      await makePanel(message);
    } catch (error) {
      console.error("TICKET PANEL ERROR:", error);

      await log(message.guild, "PANEL ERROR", [
        `By: <@${message.author.id}>`,
        `Error: ${safeLine(error.message)}`,
      ]);

      await message.reply({
        content: "Could not create the ticket panel. Check the log and console.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.inGuild()) return;

    const isOpen =
      interaction.isStringSelectMenu() &&
      interaction.customId === "milan_ticket:open";

    const isControl =
      interaction.isButton() &&
      ["milan_ticket:claim", "milan_ticket:close"].includes(interaction.customId);

    if (!isOpen && !isControl) return;

    try {
      if (isOpen) {
        await openTicket(interaction);
        return;
      }

      if (!isStaff(interaction)) {
        await interaction.reply({
          content: "Only authorized staff can use this button.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const ticket = getByChannel.get(interaction.guildId, interaction.channelId);

      if (!ticket || ticket.status !== "open") {
        await interaction.reply({
          content: "This ticket is not open.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === "milan_ticket:claim") {
        await claimTicket(interaction, ticket);
      } else {
        await closeTicket(interaction, ticket);
      }
    } catch (error) {
      console.error("TICKET INTERACTION ERROR:", error);

      await log(interaction.guild, "INTERACTION ERROR", [
        `User ID: ${interaction.user.id}`,
        `Channel ID: ${interaction.channelId}`,
        `Error: ${safeLine(error.message)}`,
      ]);

      const text = "Ticket operation failed. Check the ticket log.";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(text).catch(console.error);
      } else {
        await interaction.reply({
          content: text,
          flags: MessageFlags.Ephemeral,
        }).catch(console.error);
      }
    }
  });

  // If a ticket channel is deleted manually, release the active-ticket slot.
  client.on(Events.ChannelDelete, async channel => {
    if (!channel.guild) return;

    const ticket = getByChannel.get(channel.guild.id, channel.id);
    if (!ticket || !["open", "creating"].includes(ticket.status)) return;

    db.prepare(`
      UPDATE milan_tickets
      SET status = 'deleted', closed_at = ?
      WHERE id = ?
    `).run(Date.now(), ticket.id);

    await log(channel.guild, "CHANNEL DELETED", [
      `Ticket: #${ticket.id}`,
      `Owner ID: ${ticket.owner}`,
      "Channel was deleted outside the ticket close flow.",
    ]);
  });
};