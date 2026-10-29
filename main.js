require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
  ChannelType,
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

  jailRole: "1563059391127621702",

  welcome: "1560996836808855593",

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],

  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.User,
    Partials.GuildMember,
  ],
});

// ============================================================
// DATABASE
// ============================================================

const db = new DatabaseSync("./ragel_sady.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild TEXT NOT NULL,
  user TEXT NOT NULL,
  admin TEXT NOT NULL,
  reason TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tempbans (
  guild TEXT NOT NULL,
  user TEXT NOT NULL,
  admin TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (guild, user)
);

CREATE TABLE IF NOT EXISTS jailed (
  guild TEXT NOT NULL,
  user TEXT NOT NULL,
  admin TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (guild, user)
);

CREATE TABLE IF NOT EXISTS silenced (
  guild TEXT NOT NULL,
  user TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (guild, user)
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild TEXT NOT NULL,
  admin TEXT NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild TEXT NOT NULL,
  setting TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild, setting)
);

CREATE TABLE IF NOT EXISTS channel_locks (
  guild TEXT NOT NULL,
  channel TEXT NOT NULL,
  previous TEXT NOT NULL,
  admin TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (guild, channel)
);
`);

// ============================================================
// HELPERS
// ============================================================

const P = PermissionsBitField.Flags;

function successEmoji() {
  const id = process.env.SUCCESS_EMOJI_ID;

  return id
    ? `<:barbiecheckmark:${id}>`
    : "✅";
}

function embed(text, color = CONFIG.colors.red) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(String(text).slice(0, 4000));
}

async function reply(message, text) {
  return message.reply({
    embeds: [embed(text)],
    allowedMentions: {
      repliedUser: false,
      parse: [],
    },
  }).catch(console.error);
}

function time() {
  return Math.floor(Date.now() / 1000);
}

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

function saveAction(guild, admin, target, action, status = "success") {
  db.prepare(`
    INSERT INTO actions
    (guild, admin, target, action, status, created)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    guild,
    admin,
    target,
    action,
    status,
    Date.now()
  );
}

async function actionLog({
  guild,
  category = "punishments",
  title,
  admin,
  target,
  reason = "بدون سبب",
  extra = [],
  user = null,
  color = CONFIG.colors.red,
}) {
  const fields = [
    {
      name: "👤 Member",
      value: mention(target),
      inline: true,
    },
    {
      name: "🛡️ By",
      value: mention(admin),
      inline: true,
    },
    {
      name: "📝 Reason",
      value: reason,
    },
    {
      name: "🆔 User ID",
      value: target,
      inline: true,
    },
    {
      name: "🆔 Admin ID",
      value: admin,
      inline: true,
    },
    ...extra,
  ];

  await sendLog(
    guild,
    category,
    logEmbed(title, color, fields, user)
  );
}

async function completed(message, {
  text,
  title,
  target,
  action,
  reason,
  category,
  extra,
  user,
  color,
}) {
  saveAction(
    message.guild.id,
    message.author.id,
    target,
    action
  );

  await reply(
    message,
    `${successEmoji()} ${text}`
  );

  await actionLog({
    guild: message.guild,
    category,
    title,
    admin: message.author.id,
    target,
    reason,
    extra,
    user,
    color,
  });
}

function hasPermission(message, permission) {
  if (!message.member.permissions.has(permission)) {
    reply(message, "معكش رول مناسبه");
    return false;
  }

  if (!message.guild.members.me.permissions.has(permission)) {
    reply(message, "انا معيش رول مناسبه");
    return false;
  }

  return true;
}

async function resolveMember(message, args) {
  const mentioned = message.mentions.members.first();

  if (mentioned) {
    return {
      member: mentioned,
      rest: args.slice(1),
    };
  }

  const first = args[0];

  if (first && /^\d{17,20}$/.test(first)) {
    const member = await message.guild.members
      .fetch(first)
      .catch(() => null);

    return {
      member,
      rest: args.slice(1),
    };
  }

  if (message.reference?.messageId) {
    const original = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (original) {
      const member = await message.guild.members
        .fetch(original.author.id)
        .catch(() => null);

      return {
        member,
        rest: args,
      };
    }
  }

  return {
    member: null,
    rest: args,
  };
}

function canModerate(message, target, permission = null) {
  const guild = message.guild;
  const executor = message.member;
  const bot = guild.members.me;

  if (permission && !hasPermission(message, permission)) {
    return false;
  }

  if (
    target.id === guild.ownerId ||
    target.id === bot.id
  ) {
    reply(message, "رتب الرولات الاول");
    return false;
  }

  if (
    executor.id !== guild.ownerId &&
    executor.roles.highest.position <= target.roles.highest.position
  ) {
    reply(message, "رتب الرولات الاول");
    return false;
  }

  if (
    bot.roles.highest.position <= target.roles.highest.position
  ) {
    reply(message, "رتب الرولات الاول");
    return false;
  }

  return true;
}

function parseDuration(args, defaultMinutes = 5) {
  const first = args[0];

  if (!first || !/^\d+$/.test(first)) {
    return {
      minutes: defaultMinutes,
      rest: args,
    };
  }

  return {
    minutes: Number(first),
    rest: args.slice(1),
  };
}

function reasonFrom(args) {
  return args.join(" ").trim() || "بدون سبب";
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
// COMMANDS
// ============================================================

const commands = {};

// ============================================================
// HELP
// ============================================================

commands["help!"] = async message => {
  const e = new EmbedBuilder()
    .setColor(CONFIG.colors.red)
    .setTitle("RAGEL SADY _HELP")
    .setDescription([
      "`.تايم @عضو [دقائق] [سبب]`",
      "`.بان @عضو [سبب]`",
      "`.انبان ID [سبب]`",
      "`.تايم بان @عضو [دقائق] [سبب]`",
      "`.كيك @عضو [سبب]`",
      "`.نك @عضو الاسم`",
      "`.مسح العدد`",
      "`.رول @عضو اسم الرول`",
      "`.سجن @عضو`",
      "`.حريه @عضو`",
      "`.vk @عضو`",
      "`.اسكت @عضو`",
      "`.اكلمم @عضو`",
      "`.اخرص @عضو`",
      "`.ارغي @عضو`",
      "`.انقلني`",
      "`.وارن @عضو [سبب]`",
      "`.انوارن رقم التحذير`",
      "`.ورنات @عضو`",
      "`.ق — قفل الروم`",
      "`.ف — فتح الروم`",
      "`.help!`",
    ].join("\n"));

  await message.reply({
    embeds: [e],
    allowedMentions: {
      repliedUser: false,
    },
  });
};

// ============================================================
// TIMEOUT
// ============================================================

commands["تايم"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ModerateMembers)) return;

  const { minutes, rest: reasonArgs } = parseDuration(rest);

  if (
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > 40320
  ) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const reason = reasonFrom(reasonArgs);

  await member.timeout(minutes * 60000, reason);

  await completed(message, {
    text: `عملت تايم لـ ${mention(member.id)} لمدة ${minutes} دقيقة`,
    title: "⏱️ Member Timed Out",
    target: member.id,
    action: "timeout",
    reason,
    user: member.user,
    extra: [{
      name: "⏱️ Duration",
      value: `${minutes} minutes`,
    }],
  });
};

// ============================================================
// BAN
// ============================================================

commands["بان"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.BanMembers)) return;

  const reason = reasonFrom(rest);
  const user = member.user;

  await member.ban({ reason });

  await completed(message, {
    text: `عملت بان لـ ${mention(member.id)}`,
    title: "🔨 Member Banned",
    target: member.id,
    action: "ban",
    reason,
    user,
  });
};

// ============================================================
// UNBAN
// ============================================================

commands["انبان"] = async (message, args) => {
  if (!hasPermission(message, P.BanMembers)) return;

  const id = args[0]?.replace(/[<@!>]/g, "");

  if (!/^\d{17,20}$/.test(id || "")) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const reason = reasonFrom(args.slice(1));

  const ban = await message.guild.bans.fetch(id).catch(() => null);

  if (!ban) return reply(message, "الرسايل غير صحيحه");

  await message.guild.members.unban(id, reason);

  db.prepare(`
    DELETE FROM tempbans
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, id);

  await completed(message, {
    text: `انا فكيت الحظر بتاع ${mention(id)}`,
    title: "🔓 Member Unbanned",
    target: id,
    action: "unban",
    reason,
    user: ban.user,
    color: CONFIG.colors.green,
  });
};

// ============================================================
// TEMP BAN
// ============================================================

commands["تايم بان"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.BanMembers)) return;

  const { minutes, rest: reasonArgs } = parseDuration(rest);

  if (
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > 40320
  ) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const reason = reasonFrom(reasonArgs);
  const user = member.user;

  await member.ban({ reason });

  const expires = Date.now() + minutes * 60000;

  db.prepare(`
    INSERT OR REPLACE INTO tempbans
    (guild, user, admin, reason, expires)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    message.guild.id,
    member.id,
    message.author.id,
    reason,
    expires
  );

  await completed(message, {
    text: `عملت تايم بان لـ ${mention(member.id)} لمدة ${minutes} دقيقة`,
    title: "⏳ Temporary Ban",
    target: member.id,
    action: "tempban",
    reason,
    user,
    extra: [
      {
        name: "⏱️ Duration",
        value: `${minutes} minutes`,
      },
      {
        name: "📅 Expires",
        value: `<t:${Math.floor(expires / 1000)}:F>`,
      },
    ],
  });
};

// ============================================================
// KICK
// ============================================================

commands["كيك"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.KickMembers)) return;

  const reason = reasonFrom(rest);
  const user = member.user;

  await member.kick(reason);

  await completed(message, {
    text: `انا طردت ${mention(member.id)}`,
    title: "👢 Member Kicked",
    target: member.id,
    action: "kick",
    reason,
    user,
  });
};

// ============================================================
// NICKNAME
// ============================================================

commands["نك"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member || !rest.length) {
    return reply(message, "الرسايل غير صحيحه");
  }

  if (!canModerate(message, member, P.ManageNicknames)) return;

  const nickname = rest.join(" ").slice(0, 32);

  await member.setNickname(nickname);

  await completed(message, {
    text: `انا غيرت اسم ${mention(member.id)} لـ ${nickname}`,
    title: "📝 Nickname Updated",
    target: member.id,
    action: "nickname",
    reason: "تغيير الاسم",
    user: member.user,
    category: "nicknames",
    color: CONFIG.colors.yellow,
    extra: [{
      name: "📝 New Nickname",
      value: nickname,
    }],
  });
};

// ============================================================
// CLEAR
// ============================================================

commands["مسح"] = async (message, args) => {
  if (!hasPermission(message, P.ManageMessages)) return;

  const count = Number(args[0]);

  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100
  ) {
    return reply(message, "الرسايل غير صحيحه");
  }

  if (!message.channel.bulkDelete) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const deleted = await message.channel.bulkDelete(
    count,
    true
  );

  await completed(message, {
    text: `مسحت ${deleted.size} رسايل`,
    title: "🗑️ Messages Cleared",
    target: message.channel.id,
    action: "clear",
    reason: "حذف رسائل",
    category: "messages",
    extra: [{
      name: "🗑️ Deleted",
      value: String(deleted.size),
    }],
  });
};

// ============================================================
// ROLE TOGGLE
// ============================================================

function findRole(guild, text) {
  const clean = text.trim();
  const id = clean.match(/^<@&(\d{17,20})>$/)?.[1]
    || (/^\d{17,20}$/.test(clean) ? clean : null);

  if (id) {
    return guild.roles.cache.get(id) || null;
  }

  const matches = guild.roles.cache.filter(
    role => role.name.toLowerCase() === clean.toLowerCase()
  );

  if (matches.size !== 1) return null;

  return matches.first();
}

commands["رول"] = async (message, args) => {
  if (!hasPermission(message, P.ManageRoles)) return;

  const { member, rest } = await resolveMember(message, args);

  if (!member || !rest.length) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const role = findRole(message.guild, rest.join(" "));

  if (!role || role.managed || role.id === message.guild.id) {
    return reply(message, "الرسايل غير صحيحه");
  }

  if (!canModerate(message, member)) return;

  const bot = message.guild.members.me;

  if (
    bot.roles.highest.position <= role.position ||
    (
      message.author.id !== message.guild.ownerId &&
      message.member.roles.highest.position <= role.position
    )
  ) {
    return reply(message, "رتب الرولات الاول");
  }

  const hasRole = member.roles.cache.has(role.id);

  if (hasRole) {
    await member.roles.remove(
      role,
      `Removed by ${message.author.id}`
    );
  } else {
    await member.roles.add(
      role,
      `Added by ${message.author.id}`
    );
  }

  await completed(message, {
    text: hasRole
      ? `انا سحبت رول ${role.name} من ${mention(member.id)}`
      : `انا اديت رول ${role.name} لـ ${mention(member.id)}`,

    title: hasRole
      ? "🎭 Role Removed"
      : "🎭 Role Added",

    target: member.id,

    action: hasRole
      ? "role_remove"
      : "role_add",

    reason: hasRole
      ? "سحب رول"
      : "إضافة رول",

    category: "messages",
    color: CONFIG.colors.blue,
    user: member.user,

    extra: [
      {
        name: "🎭 Role",
        value: `<@&${role.id}>`,
      },
      {
        name: "🆔 Role ID",
        value: role.id,
      },
    ],
  });
};

// ============================================================
// JAIL
// ============================================================

commands["سجن"] = async (message, args) => {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ManageRoles)) return;

  const role = message.guild.roles.cache.get(CONFIG.jailRole);

  if (!role) return reply(message, "رول السجن مش موجوده");

  if (
    role.position >= message.guild.members.me.roles.highest.position ||
    (
      message.author.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    )
  ) {
    return reply(message, "رتب الرولات الاول");
  }

  if (member.roles.cache.has(role.id)) {
    return reply(
      message,
      `الراجل دا ${mention(member.id)} مسجون اصلا`
    );
  }

  await member.roles.add(role);

  db.prepare(`
    INSERT OR REPLACE INTO jailed
    (guild, user, admin, created)
    VALUES (?, ?, ?, ?)
  `).run(
    message.guild.id,
    member.id,
    message.author.id,
    Date.now()
  );

  await completed(message, {
    text: `سجنت ${mention(member.id)}`,
    title: "🔒 Member Jailed",
    target: member.id,
    action: "jail",
    reason: "سجن",
    category: "jail",
    user: member.user,
  });
};

// ============================================================
// UNJAIL
// ============================================================

commands["حريه"] = async (message, args) => {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ManageRoles)) return;

  const role = message.guild.roles.cache.get(CONFIG.jailRole);

  if (!role) return reply(message, "رول السجن مش موجوده");

  if (
    role.position >= message.guild.members.me.roles.highest.position ||
    (
      message.author.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    )
  ) {
    return reply(message, "رتب الرولات الاول");
  }

  if (!member.roles.cache.has(role.id)) {
    return reply(message, "لا مش مسجون");
  }

  await member.roles.remove(role);

  db.prepare(`
    DELETE FROM jailed
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, member.id);

  await completed(message, {
    text: `انا خليت ${mention(member.id)} حر`,
    title: "🔓 Member Released",
    target: member.id,
    action: "unjail",
    reason: "فك السجن",
    category: "jail",
    color: CONFIG.colors.green,
    user: member.user,
  });
};

// ============================================================
// VOICE KICK
// ============================================================

commands["vk"] = async (message, args) => {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.MoveMembers)) return;

  if (!member.voice.channel) {
    return reply(message, "الميمبر مش موجود ف الفويس");
  }

  await member.voice.disconnect();

  await completed(message, {
    text: `انا طردت ${mention(member.id)} من الفويس`,
    title: "🎙️ Voice Disconnected",
    target: member.id,
    action: "voice_kick",
    reason: "طرد من الفويس",
    category: "voice",
    color: CONFIG.colors.purple,
    user: member.user,
  });
};

// ============================================================
// SERVER VOICE MUTE
// ============================================================

async function voiceMuteCommand(message, args, mute) {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.MuteMembers)) return;

  if (!member.voice.channel) {
    return reply(message, "الميمبر مش موجود ف الفويس");
  }

  await member.voice.setMute(mute);

  await completed(message, {
    text: mute
      ? `انا خليت ${mention(member.id)} يخرص`
      : `خلاص اكلم يا عم ${mention(member.id)}`,

    title: mute
      ? "🔇 Voice Muted"
      : "🔊 Voice Unmuted",

    target: member.id,
    action: mute ? "voice_mute" : "voice_unmute",
    reason: mute ? "كتم فويس" : "فك كتم فويس",
    category: "voice",
    color: CONFIG.colors.purple,
    user: member.user,
  });
}

commands["اسكت"] = (m, a) => voiceMuteCommand(m, a, true);

commands["اكلمم"] = (m, a) => voiceMuteCommand(m, a, false);

// ============================================================
// TEXT MUTE
// ============================================================

async function getMuteRole(guild) {
  let role = guild.roles.cache.find(
    r => r.name === "RAGEL SADY MUTED"
  );

  if (role) return role;

  role = await guild.roles.create({
    name: "RAGEL SADY MUTED",
    color: 0x333333,
    permissions: [],
    reason: "RAGEL SADY text mute system",
  });

  return role;
}

async function applyMuteOverwrites(guild, role) {
  for (const channel of guild.channels.cache.values()) {
    if (
      !channel.permissionOverwrites ||
      ![
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
      ].includes(channel.type)
    ) {
      continue;
    }

    await channel.permissionOverwrites.edit(
      role,
      {
        SendMessages: false,
        AddReactions: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      },
      {
        reason: "RAGEL SADY text mute",
      }
    ).catch(error => {
      console.error("MUTE CHANNEL:", error.message);
    });
  }
}

commands["اخرص"] = async (message, args) => {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ManageRoles)) return;

  if (!hasPermission(message, P.ManageChannels)) return;

  const role = await getMuteRole(message.guild);

  if (
    role.position >= message.guild.members.me.roles.highest.position ||
    (
      message.author.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    )
  ) {
    return reply(message, "رتب الرولات الاول");
  }

  await applyMuteOverwrites(message.guild, role);

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }

  db.prepare(`
    INSERT OR REPLACE INTO silenced
    (guild, user, role)
    VALUES (?, ?, ?)
  `).run(message.guild.id, member.id, role.id);

  await completed(message, {
    text: `انا خليت ${mention(member.id)} يخرص`,
    title: "🔇 Text Muted",
    target: member.id,
    action: "text_mute",
    reason: "كتم كتابي",
    user: member.user,
  });
};

commands["ارغي"] = async (message, args) => {
  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ManageRoles)) return;

  const role = message.guild.roles.cache.find(
    r => r.name === "RAGEL SADY MUTED"
  );

  if (!role) return reply(message, "الرسايل غير صحيحه");

  if (
    role.position >= message.guild.members.me.roles.highest.position ||
    (
      message.author.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    )
  ) {
    return reply(message, "رتب الرولات الاول");
  }

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role);
  }

  db.prepare(`
    DELETE FROM silenced
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, member.id);

  await completed(message, {
    text: `خليت ${mention(member.id)} يتكلم`,
    title: "🔊 Text Unmuted",
    target: member.id,
    action: "text_unmute",
    reason: "فك الكتم الكتابي",
    user: member.user,
    color: CONFIG.colors.green,
  });
};

// ============================================================
// MOVE ME
// ============================================================

commands["انقلني"] = async message => {
  if (!hasPermission(message, P.MoveMembers)) return;

  const executor = message.member;

  if (!executor.voice.channel) {
    return reply(message, "الميمبر مش موجود ف الفويس");
  }

  const target = message.guild.members.me.voice.channel;

  if (!target) {
    return reply(message, "الرسايل غير صحيحه");
  }

  await executor.voice.setChannel(target);

  await completed(message, {
    text: "نقلتك",
    title: "🎙️ Member Moved",
    target: executor.id,
    action: "move_me",
    reason: "نقل إلى فويس البوت",
    category: "voice",
    color: CONFIG.colors.purple,
    user: executor.user,
  });
};

// ============================================================
// WARN
// ============================================================

commands["وارن"] = async (message, args) => {
  const { member, rest } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  if (!canModerate(message, member, P.ModerateMembers)) return;

  const reason = reasonFrom(rest);

  const result = db.prepare(`
    INSERT INTO warnings
    (guild, user, admin, reason, created)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    message.guild.id,
    member.id,
    message.author.id,
    reason,
    Date.now()
  );

  await completed(message, {
    text: `انا عملت وارن لـ ${mention(member.id)}`,
    title: "⚠️ Member Warned",
    target: member.id,
    action: "warn",
    reason,
    user: member.user,
    extra: [{
      name: "🔢 Warning ID",
      value: String(result.lastInsertRowid),
    }],
  });
};

// ============================================================
// UNWARN
// ============================================================

commands["انوارن"] = async (message, args) => {
  if (!hasPermission(message, P.ModerateMembers)) return;

  const id = Number(args[0]);

  if (!Number.isSafeInteger(id) || id < 1) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const warning = db.prepare(`
    SELECT * FROM warnings
    WHERE guild = ? AND id = ?
  `).get(message.guild.id, id);

  if (!warning) return reply(message, "مفيش ورنات");

  db.prepare(`
    DELETE FROM warnings
    WHERE guild = ? AND id = ?
  `).run(message.guild.id, id);

  await completed(message, {
    text: `انا شلت وارن بتاع ${mention(warning.user)}`,
    title: "✅ Warning Removed",
    target: warning.user,
    action: "unwarn",
    reason: warning.reason,
    color: CONFIG.colors.green,
    extra: [{
      name: "🔢 Warning ID",
      value: String(warning.id),
    }],
  });
};

// ============================================================
// WARNINGS
// ============================================================

commands["ورنات"] = async (message, args) => {
  if (!hasPermission(message, P.ModerateMembers)) return;

  const { member } = await resolveMember(message, args);

  if (!member) return reply(message, "الرسايل غير صحيحه");

  const warnings = db.prepare(`
    SELECT * FROM warnings
    WHERE guild = ? AND user = ?
    ORDER BY id DESC
  `).all(message.guild.id, member.id);

  if (!warnings.length) {
    return reply(message, "مفيش ورنات");
  }

  const pages = [];

  for (let i = 0; i < warnings.length; i += 5) {
    pages.push(warnings.slice(i, i + 5));
  }

  for (let i = 0; i < pages.length; i++) {
    const e = new EmbedBuilder()
      .setColor(CONFIG.colors.red)
      .setTitle(`⚠️ ورنات ${member.user.username}`)
      .setDescription(`العضو: ${mention(member.id)}`)
      .setThumbnail(avatar(member.user))
      .setFooter({
        text: `Page ${i + 1}/${pages.length}`,
      });

    for (const warning of pages[i]) {
      e.addFields({
        name: `Warning #${warning.id}`,
        value: [
          `**السبب:** ${fieldText(warning.reason, 500)}`,
          `**الإداري:** ${mention(warning.admin)}`,
          `**التاريخ:** <t:${Math.floor(warning.created / 1000)}:F>`,
        ].join("\n"),
      });
    }

    await message.reply({
      embeds: [e],
      allowedMentions: {
        repliedUser: false,
        parse: [],
      },
    });
  }
};

// ============================================================
// CHANNEL LOCK / UNLOCK
// ============================================================

function channelLockSupported(channel) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ].includes(channel.type);
}

commands["ق"] = async message => {
  if (!hasPermission(message, P.ManageChannels)) return;

  const channel = message.channel;

  if (!channelLockSupported(channel)) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const existing = db.prepare(`
    SELECT * FROM channel_locks
    WHERE guild = ? AND channel = ?
  `).get(message.guild.id, channel.id);

  if (existing) {
    return reply(message, "الروم مقفول اصلا");
  }

  const everyone = message.guild.roles.everyone;

  const overwrite = channel.permissionOverwrites.cache.get(
    everyone.id
  );

  let previous = null;

  if (overwrite) {
    if (overwrite.allow.has(P.SendMessages)) {
      previous = "allow";
    } else if (overwrite.deny.has(P.SendMessages)) {
      previous = "deny";
    }
  }

  // نحفظ الحالة السابقة قبل تعديل الصلاحية.
  db.prepare(`
    INSERT INTO channel_locks
    (guild, channel, previous, admin, created)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    message.guild.id,
    channel.id,
    previous || "neutral",
    message.author.id,
    Date.now()
  );

  try {
    await channel.permissionOverwrites.edit(
      everyone,
      {
        SendMessages: false,
      },
      {
        reason: `Channel locked by ${message.author.id}`,
      }
    );
  } catch (error) {
    db.prepare(`
      DELETE FROM channel_locks
      WHERE guild = ? AND channel = ?
    `).run(message.guild.id, channel.id);

    throw error;
  }

  await completed(message, {
    text: `قفلت الروم ${channel}`,
    title: "🔒 Channel Locked",
    target: channel.id,
    action: "channel_lock",
    reason: "قفل الروم",
    category: "channels",
    color: CONFIG.colors.red,
    extra: [
      {
        name: "📁 Channel",
        value: `${channel}`,
      },
      {
        name: "🆔 Channel ID",
        value: channel.id,
      },
    ],
  });
};

commands["ف"] = async message => {
  if (!hasPermission(message, P.ManageChannels)) return;

  const channel = message.channel;

  if (!channelLockSupported(channel)) {
    return reply(message, "الرسايل غير صحيحه");
  }

  const previous = db.prepare(`
    SELECT * FROM channel_locks
    WHERE guild = ? AND channel = ?
  `).get(message.guild.id, channel.id);

  if (!previous) {
    return reply(message, "الروم مش مقفول بأمر البوت");
  }

  const everyone = message.guild.roles.everyone;

  let originalValue = null;

  if (previous.previous === "allow") {
    originalValue = true;
  } else if (previous.previous === "deny") {
    originalValue = false;
  }

  await channel.permissionOverwrites.edit(
    everyone,
    {
      SendMessages: originalValue,
    },
    {
      reason: `Channel unlocked by ${message.author.id}`,
    }
  );

  db.prepare(`
    DELETE FROM channel_locks
    WHERE guild = ? AND channel = ?
  `).run(message.guild.id, channel.id);

  await completed(message, {
    text: `فتحت الروم ${channel}`,
    title: "🔓 Channel Unlocked",
    target: channel.id,
    action: "channel_unlock",
    reason: "فتح الروم",
    category: "channels",
    color: CONFIG.colors.green,
    extra: [
      {
        name: "📁 Channel",
        value: `${channel}`,
      },
      {
        name: "🆔 Channel ID",
        value: channel.id,
      },
    ],
  });
};

// ============================================================
// MESSAGE COMMAND HANDLER
// ============================================================

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  if (!message.content.startsWith(CONFIG.prefix)) return;

  const content = message.content
    .slice(CONFIG.prefix.length)
    .trim();

  if (!content) return;

  const parts = content.split(/\s+/);

  let command = parts.shift().toLowerCase();

  if (
    command === "تايم" &&
    parts[0]?.toLowerCase() === "بان"
  ) {
    command = "تايم بان";
    parts.shift();
  }

  const handler = commands[command];

  if (!handler) return;

  try {
    await handler(message, parts);
  } catch (error) {
    console.error(`COMMAND ERROR [${command}]:`, error);

    await reply(message, "حصل خطاء");
  }
});

// ============================================================
// WELCOME
// ============================================================

client.on(Events.GuildMemberAdd, async member => {
  try {
    const channel = await member.guild.channels
      .fetch(CONFIG.welcome)
      .catch(() => null);

    if (channel?.isTextBased()) {
      const e = new EmbedBuilder()
        .setColor(CONFIG.colors.red)
        .setDescription(
          `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 ⋆. 𐙚˚࿔ ${mention(member.id)} 𝜗𝜚˚⋆`
        );

      const url = avatar(member.user);

      if (url) e.setThumbnail(url);

      await channel.send({
        embeds: [e],
      }).catch(console.error);
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
// ROLE / NICKNAME / TIMEOUT CHANGES
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
  db.prepare(`
    DELETE FROM tempbans
    WHERE guild = ? AND user = ?
  `).run(ban.guild.id, ban.user.id);

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

  db.prepare(`
    DELETE FROM channel_locks
    WHERE guild = ? AND channel = ?
  `).run(channel.guild.id, channel.id);

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
// TEMP BAN SCHEDULER
// ============================================================

let checkingTempbans = false;

async function checkTempbans() {
  if (checkingTempbans) return;

  checkingTempbans = true;

  try {
    const expired = db.prepare(`
      SELECT * FROM tempbans
      WHERE expires <= ?
    `).all(Date.now());

    for (const row of expired) {
      const guild = client.guilds.cache.get(row.guild);

      if (!guild) continue;

      try {
        const ban = await guild.bans.fetch(row.user)
          .catch(() => null);

        if (ban) {
          await guild.members.unban(
            row.user,
            "Temporary ban expired"
          );
        }

        db.prepare(`
          DELETE FROM tempbans
          WHERE guild = ? AND user = ?
        `).run(row.guild, row.user);

        await actionLog({
          guild,
          title: "✅ Temp Ban Expired",
          admin: row.admin,
          target: row.user,
          reason: row.reason,
          user: ban?.user,
          color: CONFIG.colors.green,
          extra: [{
            name: "⏱️ Expired",
            value: `<t:${Math.floor(row.expires / 1000)}:F>`,
          }],
        });
      } catch (error) {
        console.error(
          `TEMPBAN ERROR [${row.user}]:`,
          error.message
        );
      }
    }
  } finally {
    checkingTempbans = false;
  }
}

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
  console.log(`Commands: ${Object.keys(commands).length}`);
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

  await checkTempbans();

  setInterval(checkTempbans, 30000);

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

client.login(TOKEN);
