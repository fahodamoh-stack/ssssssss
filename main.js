require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require("discord.js");

const { DatabaseSync } = require("node:sqlite");

/* ==========================================
             RAGEL SADY BOT
========================================== */

const TOKEN = process.env.TOKEN;
const PREFIX = ".";
const EMOJI_ID = process.env.SUCCESS_EMOJI_ID;
const EMOJI_ANIMATED = false;

if (!TOKEN) {
  throw new Error("TOKEN is missing from .env");
}

const CONFIG = {
  name: "RAGEL SADY",
  color: 0xED1C24,

  jailRole: "1563059391127621702",
  welcomeChannel: "1560996836808855593",

  defaultTimeout: 5,
  defaultTempban: 5,
  maxTimeout: 40320,

  massThreshold: 3,
  massWindow: 60000,

  logs: {
    members: "1560996893499334697",
    invites: "1560996901287891036",
    punishments: "1560996903926366318",
    messages: "1560996906686091284",
    voice: "1560996909366120510",
    channels: "1560996912256131132",
    nicknames: "1560996915645124738",
    mass: "1563201123605553162"
  },

  messages: {
    timeout: "عملت تايم لـ {user} لمدة {duration}",
    ban: "عملت بان لـ {user}",
    unban: "انا فكيت الحظر بتاع {user}",
    tempban: "عملت تايم بان لـ {user} لمدة {duration}",
    kick: "انا طردت {user}",
    nickname: "انا غيرت اسم {user} لـ {nickname}",
    clear: "مسحت {count} رسايل",

    jail: "سجنت {user}",
    unjail: "انا خليت {user} حر",

    vk: "انا طردت {user} من الفويس",
    mute: "انا خليت {user} يخرص",
    unmute: "خلاص اكلم يا عم {user}",
    silence: "انا خليت {user} يخرص",
    unsilence: "خليت {user} يتكلم",
    move: "نقلتك",

    warn: "انا عملت وارن لـ {user}",
    unwarn: "انا شلت وارن بتاع {user}",

    invalid: "الرسايل غير صحيحه",
    permission: "معكش رول مناسبه",
    botPermission: "انا معيش رول مناسبه",
    hierarchy: "رتب الرولات الاول",
    error: "حصل خطاء",

    alreadyJailed: "الراجل دا {user} مسجون اصلا",
    notJailed: "لا مش مسجون",
    jailRoleMissing: "رول السجن مش موجوده",
    notInVoice: "الميمبر مش موجود ف الفويس",
    noWarnings: "مفيش ورنات"
  }
};

/* ==========================================
                 CLIENT
========================================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration
  ],

  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember
  ],

  allowedMentions: {
    parse: [],
    repliedUser: false
  }
});

/* ==========================================
                 DATABASE
========================================== */

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
  admin TEXT,
  reason TEXT,
  expires INTEGER NOT NULL,
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
  target TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL
);
`);

/* ==========================================
                 UTILITIES
========================================== */

const recentMessages = new Map();
const adminActions = new Map();
const inviteCache = new Map();

const P = PermissionsBitField.Flags;

function mention(id) {
  return `<@${id}>`;
}

function channelMention(id) {
  return `<#${id}>`;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function trim(value, max = 1000) {
  const text = String(value ?? "غير متاح");

  return text.length > max
    ? text.slice(0, max - 3) + "..."
    : text;
}

function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return String(values[key] ?? "");
  });
}

function isID(value) {
  return /^\d{17,20}$/.test(value || "");
}

function parseDuration(value, fallback = 5) {
  if (value === undefined) return fallback;

  if (!/^\d+$/.test(value)) return null;

  const duration = Number(value);

  return Number.isSafeInteger(duration) && duration > 0
    ? duration
    : null;
}

function successEmoji() {
  if (!isID(EMOJI_ID)) return "";

  const prefix = EMOJI_ANIMATED ? "a" : "";

  return `<${prefix}:barbiecheckmark:${EMOJI_ID}>`;
}

function makeEmbed(title, description, options = {}) {
  const embed = new EmbedBuilder()
    .setColor(options.color ?? CONFIG.color)
    .setTitle(trim(title, 256))
    .setDescription(trim(description, 4000))
    .setTimestamp();

  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  if (options.image) {
    embed.setImage(options.image);
  }

  return embed;
}

async function sendEmbed(message, title, description, options = {}) {
  const embed = makeEmbed(title, description, options);

  return message.reply({
    embeds: [embed],
    allowedMentions: {
      parse: [],
      repliedUser: false
    }
  });
}

async function done(message, text) {
  const emoji = successEmoji();

  return sendEmbed(
    message,
    emoji ? `${emoji} SUCCESS` : "✅ SUCCESS",
    text
  );
}

async function fail(message, text) {
  return sendEmbed(
    message,
    "❌ ERROR",
    text
  );
}

async function log(guild, category, title, description) {
  try {
    const id = CONFIG.logs[category];

    if (!id) return false;

    const channel = await guild.channels
      .fetch(id)
      .catch(() => null);

    if (!channel?.isTextBased()) return false;

    await channel.send({
      embeds: [
        makeEmbed(title, description)
      ],
      allowedMentions: {
        parse: []
      }
    });

    return true;

  } catch (error) {
    console.error("LOG ERROR:", error.message);
    return false;
  }
}

/* ==========================================
              TARGET RESOLVER
========================================== */

async function getTarget(message, args) {
  const first = args[0];

  if (first) {
    const match = first.match(/^<@!?(\d{17,20})>$/);

    const id = match
      ? match[1]
      : isID(first)
        ? first
        : null;

    if (id) {
      const member = await message.guild.members
        .fetch(id)
        .catch(() => null);

      return {
        id,
        member,
        consumed: 1
      };
    }
  }

  if (message.reference?.messageId) {
    const replied = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (replied?.author) {
      const member = await message.guild.members
        .fetch(replied.author.id)
        .catch(() => null);

      return {
        id: replied.author.id,
        member,
        consumed: 0
      };
    }
  }

  return null;
}

/* ==========================================
              PERMISSION CHECK
========================================== */

async function checkPermissions(message, permission, target = null) {
  const guild = message.guild;

  const admin = await guild.members
    .fetch(message.author.id)
    .catch(() => null);

  const bot = await guild.members
    .fetchMe()
    .catch(() => null);

  if (!admin || !bot) {
    await fail(message, CONFIG.messages.error);
    return false;
  }

  if (!admin.permissions.has(permission)) {
    await fail(message, CONFIG.messages.permission);
    return false;
  }

  if (!bot.permissions.has(permission)) {
    await fail(message, CONFIG.messages.botPermission);
    return false;
  }

  if (target) {
    if (
      target.id === guild.ownerId ||
      target.id === bot.id
    ) {
      await fail(message, CONFIG.messages.hierarchy);
      return false;
    }

    if (
      admin.id !== guild.ownerId &&
      admin.roles.highest.comparePositionTo(
        target.roles.highest
      ) <= 0
    ) {
      await fail(message, CONFIG.messages.hierarchy);
      return false;
    }

    if (
      bot.roles.highest.comparePositionTo(
        target.roles.highest
      ) <= 0
    ) {
      await fail(message, CONFIG.messages.hierarchy);
      return false;
    }
  }

  return true;
}

/* ==========================================
                 ACTION LOG
========================================== */

async function actionLog(
  message,
  category,
  action,
  target,
  details = {}
) {
  const lines = [
    `**الإجراء:** ${action}`,
    `**النتيجة:** نجحت العملية`,
    "",
    `**العضو:** ${target?.id ? mention(target.id) : "غير متاح"}`,
    `**User ID:** ${target?.id || "غير متاح"}`,
    "",
    `**الإداري:** ${mention(message.author.id)}`,
    `**Admin ID:** ${message.author.id}`,
    "",
    `**السيرفر:** ${trim(message.guild.name, 100)}`,
    `**Guild ID:** ${message.guild.id}`,
    "",
    `**القناة:** ${channelMention(message.channelId)}`,
    `**Channel ID:** ${message.channelId}`,
    "",
    `**التاريخ:** <t:${now()}:F>`
  ];

  for (const [key, value] of Object.entries(details)) {
    lines.push(`**${key}:** ${trim(value, 500)}`);
  }

  await log(
    message.guild,
    category,
    `📋 ${action} LOG`,
    lines.join("\n")
  );
}

/* ==========================================
               MASS MONITOR
========================================== */

async function trackAction(message, action, target) {
  const guild = message.guild;
  const admin = message.author;

  const time = Date.now();

  db.prepare(`
    INSERT INTO actions
    (guild, admin, target, action, status, created)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    guild.id,
    admin.id,
    target?.id || null,
    action,
    "SUCCESS",
    time
  );

  const key = `${guild.id}:${admin.id}:${action}`;

  const previous = adminActions.get(key) || [];

  const current = previous.filter(
    item => time - item.time < CONFIG.massWindow
  );

  current.push({
    id: target?.id || null,
    time
  });

  adminActions.set(key, current);

  const unique = new Set(
    current.map(x => x.id).filter(Boolean)
  );

  if (unique.size <= CONFIG.massThreshold) return;

  if (
    unique.size !== CONFIG.massThreshold + 1 &&
    unique.size % 20 !== 0
  ) return;

  await log(
    guild,
    "mass",
    "🚨 MASS ACTION ALERT",
    `**الإداري:** ${mention(admin.id)}
**Admin ID:** ${admin.id}

**الإجراء:** ${action}
**عدد الأعضاء:** ${unique.size}
**عدد العمليات:** ${current.length}

**الأعضاء:**
${trim([...unique].map(id => `${mention(id)} (${id})`).join("\n"), 1800)}

**الوقت:** <t:${now()}:F>
**النتيجة:** تم رصد عمليات ناجحة.

لا توجد عقوبة تلقائية.`
  );
}

async function completed(
  message,
  {
    text,
    category,
    action,
    target,
    details = {}
  }
) {
  // اللوج منفصل عن إرسال رسالة النجاح
  // حتى لا يؤدي فشل الرد إلى فقدان تسجيل العملية.
  await actionLog(
    message,
    category,
    action,
    target,
    details
  );

  try {
    await trackAction(message, action, target);
  } catch (error) {
    console.error("TRACK ACTION:", error.message);
  }

  await done(message, text).catch(error => {
    console.error("SUCCESS MESSAGE:", error.message);
  });
}

/* ==========================================
                   COMMANDS
========================================== */

const commands = {};

/* ==========================================
                  TIMEOUT
========================================== */

commands["تايم"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  const duration = parseDuration(
    args[target.consumed],
    CONFIG.defaultTimeout
  );

  if (!duration || duration > CONFIG.maxTimeout) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ModerateMembers,
    target.member
  ))) return;

  if (!target.member.moderatable) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const durationProvided = args[target.consumed] !== undefined;

  const reason = args
    .slice(target.consumed + (durationProvided ? 1 : 0))
    .join(" ") || "بدون سبب";

  await target.member.timeout(
    duration * 60000,
    reason
  );

  await completed(message, {
    text: format(CONFIG.messages.timeout, {
      user: mention(target.id),
      duration: `${duration} دقيقة`
    }),
    category: "punishments",
    action: "TIMEOUT",
    target,
    details: {
      "المدة": `${duration} دقيقة`,
      "السبب": reason,
      "ينتهي": `<t:${Math.floor(Date.now() / 1000 + duration * 60)}:F>`
    }
  });
};

/* ==========================================
                    BAN
========================================== */

commands["بان"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.BanMembers,
    target.member
  ))) return;

  if (target.member && !target.member.bannable) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const reason = args
    .slice(target.consumed)
    .join(" ") || "بدون سبب";

  await message.guild.members.ban(target.id, {
    reason
  });

  db.prepare(`
    DELETE FROM tempbans
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, target.id);

  await completed(message, {
    text: format(CONFIG.messages.ban, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "BAN",
    target,
    details: {
      "السبب": reason
    }
  });
};

/* ==========================================
                   UNBAN
========================================== */

commands["انبان"] = async (message, args) => {
  const id = args[0];

  if (!isID(id)) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.BanMembers
  ))) return;

  await message.guild.members.unban(id);

  db.prepare(`
    DELETE FROM tempbans
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, id);

  await completed(message, {
    text: format(CONFIG.messages.unban, {
      user: mention(id)
    }),
    category: "punishments",
    action: "UNBAN",
    target: { id }
  });
};

/* ==========================================
                  TEMP BAN
========================================== */

commands["تايم بان"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target) {
    return fail(message, CONFIG.messages.invalid);
  }

  const duration = parseDuration(
    args[target.consumed],
    CONFIG.defaultTempban
  );

  if (!duration || duration > 5256000) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.BanMembers,
    target.member
  ))) return;

  if (target.member && !target.member.bannable) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const reason = args
    .slice(target.consumed + 1)
    .join(" ") || "بدون سبب";

  const expires = Date.now() + duration * 60000;

  await message.guild.members.ban(target.id, {
    reason
  });

  db.prepare(`
    INSERT OR REPLACE INTO tempbans
    (guild, user, admin, reason, expires)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    message.guild.id,
    target.id,
    message.author.id,
    reason,
    expires
  );

  await completed(message, {
    text: format(CONFIG.messages.tempban, {
      user: mention(target.id),
      duration: `${duration} دقيقة`
    }),
    category: "punishments",
    action: "TEMP BAN",
    target,
    details: {
      "السبب": reason,
      "المدة": `${duration} دقيقة`,
      "ينتهي": `<t:${Math.floor(expires / 1000)}:F>`
    }
  });
};

/* ==========================================
                    KICK
========================================== */

commands["كيك"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.KickMembers,
    target.member
  ))) return;

  if (!target.member.kickable) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const reason = args
    .slice(target.consumed)
    .join(" ") || "بدون سبب";

  await target.member.kick(reason);

  await completed(message, {
    text: format(CONFIG.messages.kick, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "KICK",
    target,
    details: {
      "السبب": reason
    }
  });
};

/* ==========================================
                   NICKNAME
========================================== */

commands["نك"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  const nickname = args
    .slice(target.consumed)
    .join(" ");

  if (!nickname || nickname.length > 32) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ManageNicknames,
    target.member
  ))) return;

  if (!target.member.manageable) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const oldName =
    target.member.nickname ||
    target.member.user.username;

  await target.member.setNickname(nickname);

  await completed(message, {
    text: format(CONFIG.messages.nickname, {
      user: mention(target.id),
      nickname
    }),
    category: "nicknames",
    action: "NICKNAME",
    target,
    details: {
      "الاسم القديم": oldName,
      "الاسم الجديد": nickname
    }
  });
};

/* ==========================================
                    CLEAR
========================================== */

commands["مسح"] = async (message, args) => {
  if (!(await checkPermissions(
    message,
    P.ManageMessages
  ))) return;

  const count = Number(args[0]);

  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100
  ) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (typeof message.channel.bulkDelete !== "function") {
    return fail(message, CONFIG.messages.invalid);
  }

  const bot = await message.guild.members.fetchMe();

  const permissions = message.channel.permissionsFor(bot);

  if (!permissions?.has([
    P.ManageMessages,
    P.ReadMessageHistory
  ])) {
    return fail(message, CONFIG.messages.botPermission);
  }

  const deleted = await message.channel.bulkDelete(
    count,
    true
  );

  await completed(message, {
    text: format(CONFIG.messages.clear, {
      count: deleted.size
    }),
    category: "messages",
    action: "CLEAR",
    target: null,
    details: {
      "العدد المطلوب": count,
      "العدد المحذوف": deleted.size
    }
  });
};

/* ==========================================
                     JAIL
========================================== */

commands["سجن"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ManageRoles,
    target.member
  ))) return;

  const role = await message.guild.roles
    .fetch(CONFIG.jailRole)
    .catch(() => null);

  if (!role) {
    return fail(message, CONFIG.messages.jailRoleMissing);
  }

  const bot = await message.guild.members.fetchMe();

  if (
    bot.roles.highest.comparePositionTo(role) <= 0 ||
    !target.member.manageable
  ) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  if (target.member.roles.cache.has(role.id)) {
    return fail(message, format(
      CONFIG.messages.alreadyJailed,
      { user: mention(target.id) }
    ));
  }

  await target.member.roles.add(
    role,
    `Jailed by ${message.author.id}`
  );

  await completed(message, {
    text: format(CONFIG.messages.jail, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "JAIL",
    target,
    details: {
      "الرول": `${role.name} (${role.id})`
    }
  });
};

/* ==========================================
                    UNJAIL
========================================== */

commands["حريه"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ManageRoles,
    target.member
  ))) return;

  const role = await message.guild.roles
    .fetch(CONFIG.jailRole)
    .catch(() => null);

  if (!role) {
    return fail(message, CONFIG.messages.jailRoleMissing);
  }

  const bot = await message.guild.members.fetchMe();

  if (
    bot.roles.highest.comparePositionTo(role) <= 0 ||
    !target.member.manageable
  ) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  if (!target.member.roles.cache.has(role.id)) {
    return fail(message, CONFIG.messages.notJailed);
  }

  await target.member.roles.remove(
    role,
    `Released by ${message.author.id}`
  );

  await completed(message, {
    text: format(CONFIG.messages.unjail, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "UNJAIL",
    target,
    details: {
      "الرول المسحوب": `${role.name} (${role.id})`
    }
  });
};

/* ==========================================
                  VOICE KICK
========================================== */

commands["vk"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member?.voice.channel) {
    return fail(message, CONFIG.messages.notInVoice);
  }

  if (!(await checkPermissions(
    message,
    P.MoveMembers,
    target.member
  ))) return;

  const oldChannel = target.member.voice.channel;

  await target.member.voice.disconnect();

  await completed(message, {
    text: format(CONFIG.messages.vk, {
      user: mention(target.id)
    }),
    category: "voice",
    action: "VOICE KICK",
    target,
    details: {
      "الروم": `${oldChannel.name} (${oldChannel.id})`
    }
  });
};

/* ==========================================
                  VOICE MUTE
========================================== */

commands["اسكت"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member?.voice.channel) {
    return fail(message, CONFIG.messages.notInVoice);
  }

  if (!(await checkPermissions(
    message,
    P.MuteMembers,
    target.member
  ))) return;

  const channel = target.member.voice.channel;

  await target.member.voice.setMute(true);

  await completed(message, {
    text: format(CONFIG.messages.mute, {
      user: mention(target.id)
    }),
    category: "voice",
    action: "VOICE MUTE",
    target,
    details: {
      "الروم": `${channel.name} (${channel.id})`
    }
  });
};

/* ==========================================
                 VOICE UNMUTE
========================================== */

commands["اكلمم"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member?.voice.channel) {
    return fail(message, CONFIG.messages.notInVoice);
  }

  if (!(await checkPermissions(
    message,
    P.MuteMembers,
    target.member
  ))) return;

  const channel = target.member.voice.channel;

  await target.member.voice.setMute(false);

  await completed(message, {
    text: format(CONFIG.messages.unmute, {
      user: mention(target.id)
    }),
    category: "voice",
    action: "VOICE UNMUTE",
    target,
    details: {
      "الروم": `${channel.name} (${channel.id})`
    }
  });
};

/* ==========================================
                  TEXT MUTE
========================================== */

async function getMuteRole(guild) {
  let role = guild.roles.cache.find(
    r => r.name === "RAGEL SADY MUTED"
  );

  if (!role) {
    role = await guild.roles.create({
      name: "RAGEL SADY MUTED",
      reason: "Text mute system"
    });
  }

  return role;
}

commands["اخرص"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ManageRoles,
    target.member
  ))) return;

  const role = await getMuteRole(message.guild);
  const bot = await message.guild.members.fetchMe();

  if (
    bot.roles.highest.comparePositionTo(role) <= 0 ||
    !target.member.manageable
  ) {
    return fail(message, CONFIG.messages.hierarchy);
  }

  const channels = await message.guild.channels.fetch();

  let failed = 0;

  for (const channel of channels.values()) {
    if (
      channel &&
      [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice
      ].includes(channel.type)
    ) {
      try {
        await channel.permissionOverwrites.edit(role, {
          SendMessages: false,
          SendMessagesInThreads: false
        });
      } catch (error) {
        failed++;
        console.error("MUTE OVERWRITE:", error.message);
      }
    }
  }

  if (failed > 0) {
    return fail(message, CONFIG.messages.error);
  }

  await target.member.roles.add(role);

  db.prepare(`
    INSERT OR REPLACE INTO silenced
    (guild, user, role)
    VALUES (?, ?, ?)
  `).run(message.guild.id, target.id, role.id);

  await completed(message, {
    text: format(CONFIG.messages.silence, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "TEXT MUTE",
    target,
    details: {
      "الرول": `${role.name} (${role.id})`
    }
  });
};

/* ==========================================
                 TEXT UNMUTE
========================================== */

commands["ارغي"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ManageRoles,
    target.member
  ))) return;

  const record = db.prepare(`
    SELECT role FROM silenced
    WHERE guild = ? AND user = ?
  `).get(message.guild.id, target.id);

  if (!record) {
    return fail(message, CONFIG.messages.invalid);
  }

  await target.member.roles.remove(record.role);

  db.prepare(`
    DELETE FROM silenced
    WHERE guild = ? AND user = ?
  `).run(message.guild.id, target.id);

  await completed(message, {
    text: format(CONFIG.messages.unsilence, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "TEXT UNMUTE",
    target
  });
};

/* ==========================================
                    MOVE ME
========================================== */

commands["انقلني"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member?.voice.channel) {
    return fail(message, CONFIG.messages.notInVoice);
  }

  const self = await message.guild.members
    .fetch(message.author.id);

  if (!self.voice.channel) {
    return fail(message, CONFIG.messages.notInVoice);
  }

  if (!(await checkPermissions(
    message,
    P.MoveMembers
  ))) return;

  const oldChannel = self.voice.channel;
  const newChannel = target.member.voice.channel;

  await self.voice.setChannel(newChannel);

  await completed(message, {
    text: CONFIG.messages.move,
    category: "voice",
    action: "MOVE ME",
    target: { id: self.id },
    details: {
      "من": `${oldChannel.name} (${oldChannel.id})`,
      "إلى": `${newChannel.name} (${newChannel.id})`
    }
  });
};

/* ==========================================
                    WARN
========================================== */

commands["وارن"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target?.member) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ModerateMembers,
    target.member
  ))) return;

  const reason = args
    .slice(target.consumed)
    .join(" ") || "بدون سبب";

  const result = db.prepare(`
    INSERT INTO warnings
    (guild, user, admin, reason, created)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    message.guild.id,
    target.id,
    message.author.id,
    reason,
    Date.now()
  );

  await completed(message, {
    text: format(CONFIG.messages.warn, {
      user: mention(target.id)
    }),
    category: "punishments",
    action: "WARN",
    target,
    details: {
      "رقم التحذير": result.lastInsertRowid,
      "السبب": reason
    }
  });
};

/* ==========================================
               WARNINGS EMBED
========================================== */

commands["ورنات"] = async (message, args) => {
  const target = await getTarget(message, args);

  if (!target) {
    return fail(message, CONFIG.messages.invalid);
  }

  if (!(await checkPermissions(
    message,
    P.ModerateMembers
  ))) return;

  const warnings = db.prepare(`
    SELECT * FROM warnings
    WHERE guild = ? AND user = ?
    ORDER BY id ASC
  `).all(message.guild.id, target.id);

  if (!warnings.length) {
    return sendEmbed(
      message,
      "⚠️ WARNINGS",
      CONFIG.messages.noWarnings
    );
  }

  const member = target.member;

  const avatar = member?.user.displayAvatarURL({
    size: 256
  });

  const totalPages = Math.ceil(warnings.length / 5);

  for (let page = 0; page < totalPages; page++) {
    const pageWarnings = warnings.slice(
      page * 5,
      page * 5 + 5
    );

    const embed = new EmbedBuilder()
      .setColor(CONFIG.color)
      .setTitle(`⚠️ ورنات ${member?.user.username || target.id}`)
      .setDescription(
        `**العضو:** ${mention(target.id)}\n` +
        `**عدد التحذيرات:** ${warnings.length}`
      )
      .setFooter({
        text: `RAGEL SADY • ${page + 1}/${totalPages}`
      })
      .setTimestamp();

    if (avatar) {
      embed.setThumbnail(avatar);
    }

    pageWarnings.forEach((warn, index) => {
      const number = page * 5 + index + 1;

      embed.addFields({
        name: `⚠️ ورن ${number}`,
        value:
          `**العضو:** ${mention(warn.user)}\n` +
          `**سبب:** ${trim(warn.reason, 300)}\n` +
          `**العملو وارن:** ${mention(warn.admin)}\n` +
          `**التاريخ:** <t:${Math.floor(warn.created / 1000)}:F>\n` +
          `**رقم الوارن:** ${warn.id}`,
        inline: false
      });
    });

    if (page === 0) {
      await message.reply({
        embeds: [embed],
        allowedMentions: {
          parse: [],
          repliedUser: false
        }
      });
    } else {
      await message.channel.send({
        embeds: [embed],
        allowedMentions: {
          parse: []
        }
      });
    }
  }
};

/* ==========================================
                    UNWARN
========================================== */

commands["انوارن"] = async (message, args) => {
  if (!(await checkPermissions(
    message,
    P.ModerateMembers
  ))) return;

  const id = Number(args[0]);

  if (!Number.isSafeInteger(id) || id < 1) {
    return fail(message, CONFIG.messages.invalid);
  }

  const warning = db.prepare(`
    SELECT * FROM warnings
    WHERE guild = ? AND id = ?
  `).get(message.guild.id, id);

  if (!warning) {
    return fail(message, CONFIG.messages.invalid);
  }

  db.prepare(`
    DELETE FROM warnings
    WHERE guild = ? AND id = ?
  `).run(message.guild.id, id);

  await completed(message, {
    text: format(CONFIG.messages.unwarn, {
      user: mention(warning.user)
    }),
    category: "punishments",
    action: "UNWARN",
    target: { id: warning.user },
    details: {
      "رقم التحذير": id,
      "السبب": warning.reason,
      "الإداري الأصلي": warning.admin
    }
  });
};

/* ==========================================
                  HELP!
========================================== */

commands["help!"] = async message => {
  const embed = new EmbedBuilder()
    .setColor(CONFIG.color)
    .setTitle("RAGEL SADY _HELP")
    .addFields(
      {
        name: "🛡️ ADMIN COMMANDS",
        value:
          "`.تايم @عضو [دقائق]`\n" +
          "`.بان @عضو [سبب]`\n" +
          "`.انبان ID`\n" +
          "`.تايم بان @عضو [دقائق]`\n" +
          "`.كيك @عضو [سبب]`\n" +
          "`.نك @عضو الاسم`\n" +
          "`.مسح عدد`",
        inline: false
      },
      {
        name: "🔒 JAIL COMMANDS",
        value:
          "`.سجن @عضو`\n" +
          "`.حريه @عضو`",
        inline: false
      },
      {
        name: "🎙️ VOICE COMMANDS",
        value:
          "`.vk @عضو`\n" +
          "`.اسكت @عضو`\n" +
          "`.اكلمم @عضو`\n" +
          "`.انقلني @عضو`",
        inline: false
      },
      {
        name: "💬 TEXT COMMANDS",
        value:
          "`.اخرص @عضو`\n" +
          "`.ارغي @عضو`",
        inline: false
      },
      {
        name: "⚠️ WARNING COMMANDS",
        value:
          "`.وارن @عضو السبب`\n" +
          "`.انوارن رقم`\n" +
          "`.ورنات @عضو`",
        inline: false
      }
    );

  await message.reply({
    embeds: [embed],
    allowedMentions: {
      parse: [],
      repliedUser: false
    }
  });
};

/* ==========================================
               COMMAND HANDLER
========================================== */

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();

  if (!content.startsWith(PREFIX)) return;

  const input = content.slice(PREFIX.length).trim();

  if (!input) return;

  const parts = input.split(/\s+/);

  let commandName = parts.shift();

  if (
    commandName === "تايم" &&
    parts[0] === "بان"
  ) {
    commandName = "تايم بان";
    parts.shift();
  }

  const command = commands[commandName];

  if (!command) return;

  if (recentMessages.has(message.id)) return;

  recentMessages.set(message.id, Date.now());

  try {
    await command(message, parts);

  } catch (error) {
    console.error(
      `COMMAND ERROR [${commandName}]:`,
      error
    );

    await fail(
      message,
      CONFIG.messages.error
    ).catch(() => {});
  }
});

/* ==========================================
                INVITE SYSTEM
========================================== */

async function cacheInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    inviteCache.set(
      guild.id,
      new Map(
        invites.map(invite => [
          invite.code,
          {
            uses: invite.uses || 0,
            inviterId: invite.inviterId || null
          }
        ])
      )
    );

  } catch (error) {
    console.error("INVITE CACHE:", error.message);
  }
}

async function detectInvite(guild) {
  const previous = inviteCache.get(guild.id);

  try {
    const invites = await guild.invites.fetch();

    const current = new Map(
      invites.map(invite => [
        invite.code,
        {
          uses: invite.uses || 0,
          inviterId: invite.inviterId || null
        }
      ])
    );

    inviteCache.set(guild.id, current);

    if (!previous) return null;

    const changed = invites.filter(invite => {
      const old = previous.get(invite.code);

      return old && invite.uses > old.uses;
    });

    if (changed.size !== 1) return null;

    const invite = changed.first();
    const old = previous.get(invite.code);

    if (invite.uses - old.uses !== 1) return null;

    return {
      code: invite.code,
      uses: invite.uses,
      inviterId: invite.inviterId || old.inviterId
    };

  } catch (error) {
    console.error("INVITE DETECTION:", error.message);
    return null;
  }
}

client.on("inviteCreate", async invite => {
  if (invite.guild) {
    await cacheInvites(invite.guild);
  }
});

client.on("inviteDelete", async invite => {
  if (invite.guild) {
    await cacheInvites(invite.guild);
  }
});

/* ==========================================
                   WELCOME
========================================== */

client.on("guildMemberAdd", async member => {
  try {
    const channel = await member.guild.channels
      .fetch(CONFIG.welcomeChannel)
      .catch(() => null);

    if (channel?.isTextBased()) {
      const avatar = member.user.displayAvatarURL({
        extension: "png",
        size: 1024
      });

      const embed = new EmbedBuilder()
        .setColor(CONFIG.color)
        .setImage(avatar);

      await channel.send({
        content:
          `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 ⋆. 𐙚˚࿔ ${mention(member.id)} 𝜗𝜚˚⋆`,
        embeds: [embed],
        allowedMentions: {
          users: [member.id]
        }
      });
    }
  } catch (error) {
    console.error("WELCOME ERROR:", error.message);
  }

  const invite = await detectInvite(member.guild);

  const inviteInfo = invite
    ? `**الكود:** ${invite.code}
**منشئ الدعوة:** ${
  invite.inviterId
    ? mention(invite.inviterId)
    : "غير معروف"
}
**Inviter ID:** ${invite.inviterId || "غير متاح"}
**الاستخدامات:** ${invite.uses}`
    : "تعذر تحديد الدعوة بشكل موثوق.";

  await log(
    member.guild,
    "members",
    "📥 MEMBER JOIN",
    `**العضو:** ${mention(member.id)}
**User ID:** ${member.id}
**Username:** ${member.user.username}

**إنشاء الحساب:**
<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>

**وقت الدخول:**
<t:${now()}:F>

${inviteInfo}`
  );

  await log(
    member.guild,
    "invites",
    "📨 INVITE INFO",
    `**العضو:** ${mention(member.id)}
**User ID:** ${member.id}

${inviteInfo}`
  );
});

/* ==========================================
                 MEMBER LEAVE
========================================== */

client.on("guildMemberRemove", async member => {
  await log(
    member.guild,
    "members",
    "📤 MEMBER LEAVE",
    `**العضو:** ${mention(member.id)}
**User ID:** ${member.id}
**Username:** ${member.user.username}

**الوقت:** <t:${now()}:F>

**سبب الخروج:** غير مؤكد`
  );
});

/* ==========================================
                MESSAGE DELETE
========================================== */

client.on("messageDelete", async message => {
  if (!message.guild) return;

  const attachments = message.attachments?.map(a => {
    return `${a.name || "Attachment"}: ${a.url}`;
  }).join("\n") || "لا يوجد";

  await log(
    message.guild,
    "messages",
    "🗑️ MESSAGE DELETE",
    `**صاحب الرسالة:** ${message.author?.username || "غير معروف"}
**User ID:** ${message.author?.id || "غير متاح"}

**القناة:** ${channelMention(message.channelId)}
**Channel ID:** ${message.channelId}
**Message ID:** ${message.id}

**المحتوى:**
${trim(message.content, 1200)}

**المرفقات:**
${trim(attachments, 700)}

**الوقت:** <t:${now()}:F>
**الإداري المسؤول:** غير مؤكد`
  );
});

/* ==========================================
                MESSAGE UPDATE
========================================== */

client.on("messageUpdate", async (
  oldMessage,
  newMessage
) => {
  if (!newMessage.guild) return;

  if (oldMessage.content === newMessage.content) return;

  await log(
    newMessage.guild,
    "messages",
    "✏️ MESSAGE EDIT",
    `**العضو:** ${newMessage.author?.username || "غير معروف"}
**User ID:** ${newMessage.author?.id || "غير متاح"}

**القناة:** ${channelMention(newMessage.channelId)}
**Channel ID:** ${newMessage.channelId}
**Message ID:** ${newMessage.id}

**قبل:**
${trim(oldMessage.content, 1000)}

**بعد:**
${trim(newMessage.content, 1000)}

**الوقت:** <t:${now()}:F>`
  );
});

/* ==========================================
             ROLES AND NICKNAMES
========================================== */

client.on("guildMemberUpdate", async (
  oldMember,
  newMember
) => {
  if (oldMember.nickname !== newMember.nickname) {
    await log(
      newMember.guild,
      "nicknames",
      "📝 NICKNAME UPDATE",
      `**العضو:** ${mention(newMember.id)}
**User ID:** ${newMember.id}

**الاسم القديم:** ${oldMember.nickname || "بدون لقب"}
**الاسم الجديد:** ${newMember.nickname || "بدون لقب"}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
    );
  }

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const added = newRoles.filter(
    role => !oldRoles.has(role.id)
  );

  const removed = oldRoles.filter(
    role => !newRoles.has(role.id)
  );

  for (const role of added.values()) {
    await log(
      newMember.guild,
      "messages",
      "➕ ROLE ADDED",
      `**العضو:** ${mention(newMember.id)}
**User ID:** ${newMember.id}

**الرتبة:** ${role.name}
**Role ID:** ${role.id}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
    );
  }

  for (const role of removed.values()) {
    await log(
      newMember.guild,
      "messages",
      "➖ ROLE REMOVED",
      `**العضو:** ${mention(newMember.id)}
**User ID:** ${newMember.id}

**الرتبة:** ${role.name}
**Role ID:** ${role.id}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
    );
  }
});

/* ==========================================
                  VOICE LOG
========================================== */

client.on("voiceStateUpdate", async (
  oldState,
  newState
) => {
  const member = newState.member || oldState.member;

  if (!member) return;

  const changes = [];

  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId) {
      changes.push(
        `**دخول:** ${newState.channel?.name} (${newState.channelId})`
      );

    } else if (!newState.channelId) {
      changes.push(
        `**خروج:** ${oldState.channel?.name} (${oldState.channelId})`
      );

    } else {
      changes.push(
        `**من:** ${oldState.channel?.name} (${oldState.channelId})`
      );

      changes.push(
        `**إلى:** ${newState.channel?.name} (${newState.channelId})`
      );
    }
  }

  if (oldState.serverMute !== newState.serverMute) {
    changes.push(
      newState.serverMute
        ? "**الحالة:** كتم صوت"
        : "**الحالة:** فك كتم صوت"
    );
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    changes.push(
      newState.serverDeaf
        ? "**الحالة:** Server Deafen"
        : "**الحالة:** Server Undeafen"
    );
  }

  if (!changes.length) return;

  await log(
    member.guild,
    "voice",
    "🎙️ VOICE LOG",
    `**العضو:** ${mention(member.id)}
**User ID:** ${member.id}

${changes.join("\n")}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
  );
});

/* ==========================================
                 CHANNEL LOGS
========================================== */

client.on("channelCreate", async channel => {
  if (!channel.guild) return;

  await log(
    channel.guild,
    "channels",
    "📁 CHANNEL CREATE",
    `**القناة:** ${channel.name}
**Channel ID:** ${channel.id}
**النوع:** ${channel.type}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
  );
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  await log(
    channel.guild,
    "channels",
    "🗑️ CHANNEL DELETE",
    `**القناة:** ${channel.name}
**Channel ID:** ${channel.id}
**النوع:** ${channel.type}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
  );
});

client.on("channelUpdate", async (
  oldChannel,
  newChannel
) => {
  if (!newChannel.guild) return;

  const changes = [];

  if (oldChannel.name !== newChannel.name) {
    changes.push(
      `**الاسم:** ${oldChannel.name} → ${newChannel.name}`
    );
  }

  if (oldChannel.topic !== newChannel.topic) {
    changes.push(
      `**الوصف القديم:** ${trim(oldChannel.topic, 300)}`
    );

    changes.push(
      `**الوصف الجديد:** ${trim(newChannel.topic, 300)}`
    );
  }

  const serialize = channel => {
    return [...channel.permissionOverwrites.cache.values()]
      .map(x => `${x.id}:${x.allow.bitfield}:${x.deny.bitfield}`)
      .sort()
      .join("|");
  };

  if (serialize(oldChannel) !== serialize(newChannel)) {
    changes.push("**الصلاحيات:** تم تعديلها");
  }

  if (!changes.length) return;

  await log(
    newChannel.guild,
    "channels",
    "⚙️ CHANNEL UPDATE",
    `**القناة:** ${newChannel.name}
**Channel ID:** ${newChannel.id}

${changes.join("\n")}

**الوقت:** <t:${now()}:F>
**الإداري:** غير مؤكد`
  );
});

/* ==========================================
               TEMPBAN SCHEDULER
========================================== */

let checkingTempbans = false;

async function checkTempbans() {
  if (checkingTempbans) return;

  checkingTempbans = true;

  try {
    const expired = db.prepare(`
      SELECT * FROM tempbans
      WHERE expires <= ?
      LIMIT 50
    `).all(Date.now());

    for (const record of expired) {
      try {
        const guild = await client.guilds.fetch(
          record.guild
        );

        const ban = await guild.bans
          .fetch(record.user)
          .catch(error => {
            if (error.code === 10026) return null;
            throw error;
          });

        if (ban) {
          await guild.members.unban(
            record.user,
            "Temporary ban expired"
          );
        }

        db.prepare(`
          DELETE FROM tempbans
          WHERE guild = ? AND user = ?
        `).run(record.guild, record.user);

        await log(
          guild,
          "punishments",
          "✅ TEMP BAN EXPIRED",
          `**العضو:** ${mention(record.user)}
**User ID:** ${record.user}

**الإداري الأصلي:** ${
  record.admin ? mention(record.admin) : "غير متاح"
}

**السبب:** ${record.reason || "غير متاح"}

**الوقت:** <t:${now()}:F>
**النتيجة:** انتهى الحظر المؤقت`
        );

      } catch (error) {
        console.error("TEMPBAN ERROR:", error.message);
      }
    }

  } finally {
    checkingTempbans = false;
  }
}

/* ==========================================
                   CLEANUP
========================================== */

setInterval(() => {
  const time = Date.now();

  for (const [id, created] of recentMessages) {
    if (time - created > 60000) {
      recentMessages.delete(id);
    }
  }

  for (const [key, actions] of adminActions) {
    const valid = actions.filter(
      action => time - action.time < CONFIG.massWindow
    );

    if (valid.length) {
      adminActions.set(key, valid);
    } else {
      adminActions.delete(key);
    }
  }

  db.prepare(`
    DELETE FROM actions
    WHERE created < ?
  `).run(time - 30 * 24 * 60 * 60 * 1000);

}, 30000);

/* ==========================================
                    READY
========================================== */

client.once("ready", async () => {
  console.log(`
╔════════════════════════════════════╗
║                                    ║
║             RAGEL SADY             ║
║                                    ║
║          BOT IS ONLINE             ║
║                                    ║
╚════════════════════════════════════╝

Bot: ${client.user.tag}
Servers: ${client.guilds.cache.size}
Commands: ${Object.keys(commands).length}
Prefix: .
Help: .help!
  `);

  client.user.setActivity(".help! | RAGEL SADY");

  for (const guild of client.guilds.cache.values()) {
    await cacheInvites(guild);
  }

  await checkTempbans();

  setInterval(checkTempbans, 30000);
});

client.on("guildCreate", async guild => {
  await cacheInvites(guild);
});

/* ==========================================
                ERROR HANDLING
========================================== */

client.on("error", error => {
  console.error("CLIENT ERROR:", error);
});

process.on("unhandledRejection", error => {
  console.error("UNHANDLED REJECTION:", error);
});

/* ==========================================
                    LOGIN
========================================== */

client.login(TOKEN);