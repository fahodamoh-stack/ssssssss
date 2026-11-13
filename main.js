require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
  Events,
} = require("discord.js");

const { DatabaseSync } = require("node:sqlite");

// ============================================================
// RAGEL SADY BOT
// ============================================================

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN is missing");
  process.exit(1);
}

const CONFIG = {
  prefix: ".",

  welcome: "1567429021707538562",

  logs: {
    members: "1560996893499334697",
    invites: "1560996901287891036",
    punishments: "1560996903926366318",
    messages: "1560996906686091284",
    voice: "1560996909366120510",
    channels: "1560996912256131132",
    nicknames: "1560996915645124738",
    mass: "1563201123605553162",
    jail: "1560996912256131132",
  },

  colors: {
    red: 0xff3344,
    green: 0x22c58b,
    orange: 0xff9944,
    blue: 0x2997ff,
    purple: 0x9b59ff,
    cyan: 0x3498db,
    yellow: 0xe67e22,
  },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],

  partials: [
    Partials.Message,
    Partials.Reaction,
    Partials.Channel,
    Partials.User,
    Partials.GuildMember,
  ],
});

// ============================================================
// DATABASE
// ============================================================

const db = new DatabaseSync("./ragel_sady.sqlite");

// ============================================================
// HELPERS
// ============================================================

const P = PermissionsBitField.Flags;

function mention(id) {
  return `<@${id}>`;
}

function fieldText(value, max = 1024) {
  const text = String(value ?? "غير معروف");

  return text.length > max
    ? text.slice(0, max - 3) + "..."
    : text;
}

function avatar(user) {
  return user?.displayAvatarURL?.({
    size: 256,
  }) || null;
}

function logEmbed(title, color, fields = [], user = null) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp()
    .setFooter({
      text: "RAGEL SADY • SERVER LOGS",
    });

  if (fields.length) {
    e.addFields(
      fields.slice(0, 25).map(f => ({
        name: fieldText(f.name, 256),
        value: fieldText(f.value),
        inline: Boolean(f.inline),
      }))
    );
  }

  const url = avatar(user);

  if (url) e.setThumbnail(url);

  return e;
}

async function sendLog(guild, category, e) {
  const id = CONFIG.logs[category];

  if (!id || !guild) return;

  try {
    const channel = await guild.channels.fetch(id);

    if (!channel?.isTextBased()) return;

    const me = guild.members.me
      || await guild.members.fetchMe();

    const permissions = channel.permissionsFor(me);

    if (!permissions?.has([
      P.ViewChannel,
      P.SendMessages,
      P.EmbedLinks,
    ])) {
      console.warn(`LOG PERMISSIONS MISSING: ${category}`);
      return;
    }

    await channel.send({
      embeds: [e],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`LOG ERROR [${category}]:`, error.message);
  }
}

async function auditEntry(guild, type, targetId) {
  await new Promise(resolve => setTimeout(resolve, 1200));

  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: 15,
    });

    const now = Date.now();

    const matches = [...logs.entries.values()].filter(entry =>
      entry.target?.id === targetId &&
      Math.abs(now - entry.createdTimestamp) < 12000
    );

    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

// ============================================================
// WELCOME
// ============================================================

require("./milanAutoRole")(client);
client.on(Events.GuildMemberAdd, async member => {
  // WELCOME DM IMAGE
  Promise.resolve()
    .then(() => require("./welcomeDm")(member))
    .catch(error => {
      console.error("WELCOME DM SETUP ERROR:", error);
    });
  try {
    const channel = await member.guild.channels
      .fetch(CONFIG.welcome)
      .catch(() => null);

    if (channel?.isTextBased()) {
      try {
        const welcomeGif = require("./welcomeGif");
        const payload = await welcomeGif.createPayload(
          member,
          `welcome-${member.id}.gif`
        );

        await channel.send(payload);
      } catch (error) {
        console.error("WELCOME GIF ERROR:", error);

        // Fallback if the GIF or embed could not be sent.
        await channel.send({
          content: [
            `Welcome <@${member.id}> to Milan!`,
            `Please read the rules <#1539365749418762311>`,
            `Talk with ppl here <#1560996836808855593>`,
          ].join("\n"),
          allowedMentions: {
            parse: [],
            users: [member.id],
          },
        }).catch(console.error);
      }
    }
    await sendLog(
      member.guild,
      "members",
      logEmbed(
        "✅ Member Joined",
        CONFIG.colors.green,
        [
          {
            name: "👤 Member",
            value: mention(member.id),
          },
          {
            name: "🆔 User ID",
            value: member.id,
          },
          {
            name: "📅 Account Created",
            value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
          },
        ],
        member.user
      )
    );
  } catch (error) {
    console.error("MEMBER JOIN:", error);
  }
});

// ============================================================
// MEMBER LEAVE
// ============================================================

client.on(Events.GuildMemberRemove, async member => {
  const entry = await auditEntry(
    member.guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  await sendLog(
    member.guild,
    "members",
    logEmbed(
      entry ? "👢 Member Kicked" : "📤 Member Left",
      CONFIG.colors.orange,
      [
        {
          name: "👤 Member",
          value: mention(member.id),
        },
        {
          name: "🆔 User ID",
          value: member.id,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "📝 Reason",
          value: entry?.reason || "غير معروف",
        },
      ],
      member.user
    )
  );
});

// ============================================================
// MESSAGE DELETE
// ============================================================

client.on(Events.MessageDelete, async message => {
  if (!message.guild) return;

  const fields = [
    {
      name: "👤 Author",
      value: message.author
        ? mention(message.author.id)
        : "غير معروف",
    },
    {
      name: "📁 Channel",
      value: `${message.channel}`,
    },
    {
      name: "📝 Content",
      value: message.content
        ? fieldText(message.content)
        : "المحتوى غير متاح",
    },
    {
      name: "🆔 Message ID",
      value: message.id,
    },
  ];

  await sendLog(
    message.guild,
    "messages",
    logEmbed(
      "🗑️ Message Deleted",
      CONFIG.colors.red,
      fields,
      message.author
    )
  );
});

// ============================================================
// MESSAGE EDIT
// ============================================================

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  if (
    !oldMessage.content ||
    oldMessage.content === newMessage.content
  ) {
    return;
  }

  await sendLog(
    newMessage.guild,
    "messages",
    logEmbed(
      "✏️ Message Edited",
      CONFIG.colors.yellow,
      [
        {
          name: "👤 Member",
          value: newMessage.author
            ? mention(newMessage.author.id)
            : "غير معروف",
        },
        {
          name: "📁 Channel",
          value: `${newMessage.channel}`,
        },
        {
          name: "📝 Before",
          value: fieldText(oldMessage.content),
        },
        {
          name: "📝 After",
          value: fieldText(newMessage.content),
        },
        {
          name: "🔗 Message",
          value: `[Jump to Message](${newMessage.url})`,
        },
      ],
      newMessage.author
    )
  );
});

// ============================================================
// ROLE / NICKNAME CHANGES
// ============================================================

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const guild = newMember.guild;

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const added = newRoles.filter(
    role => !oldRoles.has(role.id)
  );

  const removed = oldRoles.filter(
    role => !newRoles.has(role.id)
  );

  if (added.size || removed.size) {
    const entry = await auditEntry(
      guild,
      AuditLogEvent.MemberRoleUpdate,
      newMember.id
    );

    const executor = entry?.executor;

    for (const role of added.values()) {
      await sendLog(
        guild,
        "messages",
        logEmbed(
          "🎭 Role Added",
          CONFIG.colors.blue,
          [
            {
              name: "👤 Member",
              value: mention(newMember.id),
            },
            {
              name: "🎭 Role",
              value: `<@&${role.id}>`,
            },
            {
              name: "🛡️ By",
              value: executor
                ? mention(executor.id)
                : "غير معروف",
            },
            {
              name: "🆔 Admin ID",
              value: executor?.id || "غير معروف",
            },
            {
              name: "🆔 User ID",
              value: newMember.id,
            },
          ],
          newMember.user
        )
      );
    }

    for (const role of removed.values()) {
      await sendLog(
        guild,
        "messages",
        logEmbed(
          "🎭 Role Removed",
          CONFIG.colors.blue,
          [
            {
              name: "👤 Member",
              value: mention(newMember.id),
            },
            {
              name: "🎭 Role",
              value: `<@&${role.id}>`,
            },
            {
              name: "🛡️ By",
              value: executor
                ? mention(executor.id)
                : "غير معروف",
            },
            {
              name: "🆔 Admin ID",
              value: executor?.id || "غير معروف",
            },
            {
              name: "🆔 User ID",
              value: newMember.id,
            },
          ],
          newMember.user
        )
      );
    }
  }

  if (oldMember.nickname !== newMember.nickname) {
    const entry = await auditEntry(
      guild,
      AuditLogEvent.MemberUpdate,
      newMember.id
    );

    await sendLog(
      guild,
      "nicknames",
      logEmbed(
        "📝 Nickname Updated",
        CONFIG.colors.yellow,
        [
          {
            name: "👤 Member",
            value: mention(newMember.id),
          },
          {
            name: "📝 Before",
            value: oldMember.nickname || oldMember.user.username,
          },
          {
            name: "📝 After",
            value: newMember.nickname || newMember.user.username,
          },
          {
            name: "🛡️ By",
            value: entry?.executor
              ? mention(entry.executor.id)
              : "غير معروف",
          },
        ],
        newMember.user
      )
    );
  }
});

// ============================================================
// BAN LOGS
// ============================================================

client.on(Events.GuildBanAdd, async ban => {
  const entry = await auditEntry(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  await sendLog(
    ban.guild,
    "punishments",
    logEmbed(
      "🔨 Member Banned",
      CONFIG.colors.red,
      [
        {
          name: "👤 Member",
          value: mention(ban.user.id),
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "📝 Reason",
          value: entry?.reason || "بدون سبب",
        },
        {
          name: "🆔 User ID",
          value: ban.user.id,
        },
        {
          name: "🆔 Admin ID",
          value: entry?.executor?.id || "غير معروف",
        },
      ],
      ban.user
    )
  );
});

client.on(Events.GuildBanRemove, async ban => {
  const entry = await auditEntry(
    ban.guild,
    AuditLogEvent.MemberBanRemove,
    ban.user.id
  );

  await sendLog(
    ban.guild,
    "punishments",
    logEmbed(
      "🔓 Member Unbanned",
      CONFIG.colors.green,
      [
        {
          name: "👤 Member",
          value: mention(ban.user.id),
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 User ID",
          value: ban.user.id,
        },
        {
          name: "🆔 Admin ID",
          value: entry?.executor?.id || "غير معروف",
        },
      ],
      ban.user
    )
  );
});

// ============================================================
// ROLE EVENTS
// ============================================================

client.on(Events.GuildRoleCreate, async role => {
  const entry = await auditEntry(
    role.guild,
    AuditLogEvent.RoleCreate,
    role.id
  );

  await sendLog(
    role.guild,
    "messages",
    logEmbed(
      "🎭 Role Created",
      CONFIG.colors.blue,
      [
        {
          name: "🎭 Role",
          value: `<@&${role.id}>`,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Role ID",
          value: role.id,
        },
      ]
    )
  );
});

client.on(Events.GuildRoleDelete, async role => {
  const entry = await auditEntry(
    role.guild,
    AuditLogEvent.RoleDelete,
    role.id
  );

  await sendLog(
    role.guild,
    "messages",
    logEmbed(
      "🗑️ Role Deleted",
      CONFIG.colors.red,
      [
        {
          name: "🎭 Role",
          value: role.name,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Role ID",
          value: role.id,
        },
      ]
    )
  );
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (
    oldRole.name === newRole.name &&
    oldRole.permissions.bitfield === newRole.permissions.bitfield &&
    oldRole.color === newRole.color
  ) {
    return;
  }

  const entry = await auditEntry(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    newRole.id
  );

  await sendLog(
    newRole.guild,
    "messages",
    logEmbed(
      "⚙️ Role Updated",
      CONFIG.colors.blue,
      [
        {
          name: "🎭 Role",
          value: `<@&${newRole.id}>`,
        },
        {
          name: "📝 Old Name",
          value: oldRole.name,
        },
        {
          name: "📝 New Name",
          value: newRole.name,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Role ID",
          value: newRole.id,
        },
      ]
    )
  );
});

// ============================================================
// CHANNEL EVENTS
// ============================================================

client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  const entry = await auditEntry(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channels",
    logEmbed(
      "📁 Channel Created",
      CONFIG.colors.cyan,
      [
        {
          name: "📁 Channel",
          value: channel.name,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Channel ID",
          value: channel.id,
        },
      ]
    )
  );
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  const entry = await auditEntry(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  await sendLog(
    channel.guild,
    "channels",
    logEmbed(
      "🗑️ Channel Deleted",
      CONFIG.colors.red,
      [
        {
          name: "📁 Channel",
          value: channel.name,
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Channel ID",
          value: channel.id,
        },
      ]
    )
  );
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  const oldOverwrites = [...oldChannel.permissionOverwrites.cache.values()]
    .map(o => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`)
    .sort()
    .join("|");

  const newOverwrites = [...newChannel.permissionOverwrites.cache.values()]
    .map(o => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`)
    .sort()
    .join("|");

  if (
    oldChannel.name === newChannel.name &&
    oldChannel.topic === newChannel.topic &&
    oldOverwrites === newOverwrites
  ) {
    return;
  }

  const entry = await auditEntry(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id
  );

  await sendLog(
    newChannel.guild,
    "channels",
    logEmbed(
      "⚙️ Channel Updated",
      CONFIG.colors.cyan,
      [
        {
          name: "📁 Channel",
          value: `${newChannel}`,
        },
        {
          name: "📝 Before",
          value: oldChannel.name,
        },
        {
          name: "📝 After",
          value: newChannel.name,
        },
        {
          name: "🔐 Permissions Changed",
          value: oldOverwrites !== newOverwrites
            ? "Yes"
            : "No",
        },
        {
          name: "🛡️ By",
          value: entry?.executor
            ? mention(entry.executor.id)
            : "غير معروف",
        },
        {
          name: "🆔 Channel ID",
          value: newChannel.id,
        },
      ]
    )
  );
});

// ============================================================
// VOICE LOGS
// ============================================================

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member) return;

  const fields = [
    {
      name: "👤 Member",
      value: mention(member.id),
    },
    {
      name: "🆔 User ID",
      value: member.id,
    },
  ];

  let title = null;

  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId) {
      title = "🎙️ Voice Joined";
    } else if (!newState.channelId) {
      title = "🎙️ Voice Left";
    } else {
      title = "🎙️ Voice Moved";
    }

    fields.push(
      {
        name: "📤 From",
        value: oldState.channel
          ? `${oldState.channel}`
          : "None",
      },
      {
        name: "📥 To",
        value: newState.channel
          ? `${newState.channel}`
          : "None",
      }
    );
  } else if (oldState.serverMute !== newState.serverMute) {
    title = newState.serverMute
      ? "🔇 Voice Muted"
      : "🔊 Voice Unmuted";
  } else if (oldState.serverDeaf !== newState.serverDeaf) {
    title = newState.serverDeaf
      ? "🔇 Voice Deafened"
      : "🔊 Voice Undeafened";
  }

  if (!title) return;

  await sendLog(
    newState.guild,
    "voice",
    logEmbed(
      title,
      CONFIG.colors.purple,
      fields,
      member.user
    )
  );
});

// ============================================================
// INVITE TRACKING
// ============================================================

const inviteCache = new Map();

async function cacheInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    inviteCache.set(
      guild.id,
      new Map(
        invites.map(invite => [
          invite.code,
          invite.uses || 0,
        ])
      )
    );
  } catch (error) {
    console.warn(
      `INVITE CACHE [${guild.id}]: ${error.message}`
    );
  }
}

client.on(Events.InviteCreate, async invite => {
  await cacheInvites(invite.guild);

  await sendLog(
    invite.guild,
    "invites",
    logEmbed(
      "🔗 Invite Created",
      CONFIG.colors.green,
      [
        {
          name: "🔗 Code",
          value: invite.code,
        },
        {
          name: "🛡️ By",
          value: invite.inviter
            ? mention(invite.inviter.id)
            : "غير معروف",
        },
      ]
    )
  );
});

client.on(Events.InviteDelete, async invite => {
  await cacheInvites(invite.guild);

  await sendLog(
    invite.guild,
    "invites",
    logEmbed(
      "🗑️ Invite Deleted",
      CONFIG.colors.red,
      [
        {
          name: "🔗 Code",
          value: invite.code,
        },
      ]
    )
  );
});

client.on(Events.GuildMemberAdd, async member => {
  try {
    const before = inviteCache.get(member.guild.id);

    if (!before) {
      await cacheInvites(member.guild);
      return;
    }

    const invites = await member.guild.invites.fetch();

    const used = invites.find(
      invite =>
        (invite.uses || 0) >
        (before.get(invite.code) || 0)
    );

    await cacheInvites(member.guild);

    if (!used) return;

    await sendLog(
      member.guild,
      "invites",
      logEmbed(
        "🔗 Invite Used",
        CONFIG.colors.green,
        [
          {
            name: "👤 Member",
            value: mention(member.id),
          },
          {
            name: "🔗 Invite",
            value: used.code,
          },
          {
            name: "🛡️ Inviter",
            value: used.inviter
              ? mention(used.inviter.id)
              : "غير معروف",
          },
        ],
        member.user
      )
    );
  } catch (error) {
    console.warn(
      "INVITE DETECTION:",
      error.message
    );
  }
});

// ============================================================
// MASS ACTION MONITORING
// ============================================================

const recentActions = new Map();

function trackMassAction(guild, executorId, action, targetId) {
  if (!executorId) return;

  const key = `${guild.id}:${executorId}:${action}`;
  const now = Date.now();

  const previous = recentActions.get(key) || [];

  const current = previous.filter(
    item => now - item.created < 60000
  );

  if (!current.some(item => item.target === targetId)) {
    current.push({
      target: targetId,
      created: now,
    });
  }

  recentActions.set(key, current);

  if (current.length === 5) {
    sendLog(
      guild,
      "mass",
      logEmbed(
        "🚨 Mass Action Alert",
        CONFIG.colors.red,
        [
          {
            name: "🛡️ Admin",
            value: mention(executorId),
          },
          {
            name: "⚙️ Action",
            value: action,
          },
          {
            name: "🔢 Count",
            value: String(current.length),
          },
          {
            name: "⏱️ Period",
            value: "60 seconds",
          },
        ]
      )
    );
  }
}

client.on(Events.GuildBanAdd, async ban => {
  const entry = await auditEntry(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  if (entry?.executor) {
    trackMassAction(
      ban.guild,
      entry.executor.id,
      "ban",
      ban.user.id
    );
  }
});

client.on(Events.GuildMemberRemove, async member => {
  const entry = await auditEntry(
    member.guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  if (entry?.executor) {
    trackMassAction(
      member.guild,
      entry.executor.id,
      "kick",
      member.id
    );
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const changed =
    oldMember.roles.cache.size !== newMember.roles.cache.size ||
    [...oldMember.roles.cache.keys()].some(
      id => !newMember.roles.cache.has(id)
    );

  if (!changed) return;

  const entry = await auditEntry(
    newMember.guild,
    AuditLogEvent.MemberRoleUpdate,
    newMember.id
  );

  if (entry?.executor) {
    trackMassAction(
      newMember.guild,
      entry.executor.id,
      "member_role_update",
      newMember.id
    );
  }
});

// ============================================================
// STARTUP
// ============================================================

client.once(Events.ClientReady, async () => {
  console.log("================================");
  console.log("RAGEL SADY BOT ONLINE");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`Guilds: ${client.guilds.cache.size}`);
  console.log("Database: ragel_sady.sqlite");
  console.log("================================");

  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetchMe().catch(console.error);

    await cacheInvites(guild);

    try {
      const channel = await guild.channels.fetch(
        CONFIG.welcome
      );

      if (channel?.isTextBased()) {
        await channel.send("انا جيت");
        console.log("STARTUP MESSAGE SENT");
      }
    } catch (error) {
      console.warn(
        "STARTUP MESSAGE:",
        error.message
      );
    }
  }

  setInterval(() => {
    const now = Date.now();

    for (const [key, entries] of recentActions) {
      const fresh = entries.filter(
        entry => now - entry.created < 60000
      );

      if (fresh.length) {
        recentActions.set(key, fresh);
      } else {
        recentActions.delete(key);
      }
    }
  }, 60000);
});

// ============================================================
// ERRORS
// ============================================================

process.on("unhandledRejection", error => {
  console.error("UNHANDLED REJECTION:", error);
});

client.on(Events.Error, error => {
  console.error("DISCORD CLIENT ERROR:", error);
});

// ============================================================
// LOGIN
// ============================================================

// WELCOME GIF
try {
  require("./welcomeGif")(client);
} catch (error) {
  console.error("WELCOME GIF SETUP ERROR:", error);
}
require("./emoSystem")(client, db);
// Help disabled temporarily: helpSystem.js is empty
require('./levelSystem')(client, db);
require('./helpSystem')(client);
// Previous inventoryReactions worker disabled; file and data preserved.
require('./rankSlash')(client, db);
require('./voiceActivity')(client, db);
require('./reactionRoles')(client, db);
require('./ticketSystem')(client, db);
require('./fizzyEconomy')(client, db);
require('./milanVoting')(client);
require('./milanPartnership')(client, db);
client.login(TOKEN);
