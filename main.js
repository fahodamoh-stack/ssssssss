require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
  AuditLogEvent
} = require("discord.js");

const { DatabaseSync } = require("node:sqlite");

/* =========================================
              RAGEL SADY
========================================= */

const TOKEN = process.env.TOKEN;
const PREFIX = ".";
const EMOJI_ID = process.env.SUCCESS_EMOJI_ID;

if (!TOKEN) {
  throw new Error("TOKEN is missing");
}

const CONFIG = {
  name: "RAGEL SADY",
  color: 0xED1C24,

  botRole: "1565378696620023940",
  jailRole: "1563059391127621702",

  welcomeChannel: "1560996836808855593",
  startupChannel: "1560996836808855593",

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
    mass: "1563201123605553162",
    jail: "1560996912256131132"
  },

  messages: {
    timeout: "عملت تايم لـ {user} لمدة {duration}",
    ban: "عملت بان لـ {user}",
    unban: "انا فكيت الحظر بتاع {user}",
    tempban: "عملت تايم بان لـ {user} لمدة {duration}",
    kick: "انا طردت {user}",
    nickname: "انا غيرت اسم {user} لـ {nickname}",
    clear: "مسحت {count} رسايل",
    role: "انا اديت رول {role} لـ {user}",
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

/* =========================================
                 CLIENT
========================================= */

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
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  allowedMentions: { parse: [], repliedUser: false }
});

const P = PermissionsBitField.Flags;

/* =========================================
                 DATABASE
========================================= */

const db = new DatabaseSync("./ragel_sady.sqlite");

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild TEXT NOT NULL, user TEXT NOT NULL, admin TEXT NOT NULL,
    reason TEXT NOT NULL, created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tempbans (
    guild TEXT NOT NULL, user TEXT NOT NULL, admin TEXT,
    reason TEXT, expires INTEGER NOT NULL,
    PRIMARY KEY (guild, user)
  );
  CREATE TABLE IF NOT EXISTS jailed (
    guild TEXT NOT NULL, user TEXT NOT NULL, admin TEXT NOT NULL,
    created INTEGER NOT NULL, PRIMARY KEY (guild, user)
  );
  CREATE TABLE IF NOT EXISTS silenced (
    guild TEXT NOT NULL, user TEXT NOT NULL, role TEXT NOT NULL,
    PRIMARY KEY (guild, user)
  );
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL,
    admin TEXT NOT NULL, target TEXT, action TEXT NOT NULL,
    status TEXT NOT NULL, created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild TEXT NOT NULL, setting TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (guild, setting)
  );
  CREATE INDEX IF NOT EXISTS idx_warnings ON warnings(guild, user);
  CREATE INDEX IF NOT EXISTS idx_tempbans ON tempbans(expires);
  CREATE INDEX IF NOT EXISTS idx_actions ON actions(guild, admin, created);
`);

console.log("DATABASE READY");

/* =========================================
                UTILITIES
========================================= */

const recentMessages = new Map();
const adminActions = new Map();
const inviteCache = new Map();
const auditProcessed = new Map();
const commandAudit = new Map();

function mention(id) { return `<@${id}>`; }
function channelMention(id) { return `<#${id}>`; }
function now() { return Math.floor(Date.now() / 1000); }

function trim(value, max = 1000) {
  const text = String(value ?? "غير متاح");
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}
function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
}
function isID(v) { return /^\d{17,20}$/.test(v || ""); }

function parseDuration(value, fallback = 5) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const d = Number(value);
  return Number.isSafeInteger(d) && d > 0 ? d : null;
}
function parseDurationArgs(args, index, fallback) {
  const value = args[index];
  if (value === undefined) return { duration: fallback, reasonIndex: index };
  const d = parseDuration(value, fallback);
  if (d !== null) return { duration: d, reasonIndex: index + 1 };
  if (/^[+-]?\d/.test(value)) return null;
  return { duration: fallback, reasonIndex: index };
}
function successEmoji() {
  if (!isID(EMOJI_ID)) return "✅";
  const e = client.emojis.cache.get(EMOJI_ID);
  if (e) return e.toString();
  return `<:barbiecheckmark:${EMOJI_ID}>`;
}
function userTag(u) {
  if (!u) return "غير معروف";
  return u.discriminator && u.discriminator !== "0" ? `${u.username}#${u.discriminator}` : `${u.username}`;
}
function userAvatar(u) {
  try { return u.displayAvatarURL({ size: 256 }); } catch { return null; }
}

/* =========================================
            COMMAND EMBEDS (RED)
========================================= */

function makeEmbed(title, description, options = {}) {
  const embed = new EmbedBuilder()
    .setColor(options.color ?? CONFIG.color)
    .setTitle(trim(title, 256))
    .setDescription(trim(description, 4000))
    .setTimestamp();
  if (options.image) embed.setImage(options.image);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  return embed;
}
async function sendEmbed(message, title, description) {
  return message.reply({
    embeds: [makeEmbed(title, description)],
    allowedMentions: { parse: [], repliedUser: false }
  });
}
async function done(message, text) {
  return sendEmbed(message, `${successEmoji()} SUCCESS`, text);
}
async function fail(message, text) {
  return sendEmbed(message, "❌ ERROR", text);
}

/* =========================================
           SMART LOG UI (LIKE IMAGE)
========================================= */

const LOG_COLORS = {
  red: 0xFF3344, green: 0x22C58B, orange: 0xFF9944,
  blue: 0x2997FF, purple: 0x9B59FF, cyan: 0x3498DB,
  yellow: 0xE67E22, def: 0xED1C24
};

async function sendLog(guild, category, embed) {
  const id = CONFIG.logs[category];
  if (!id) return false;
  try {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.error(`LOG CHANNEL NOT FOUND [${category}]: ${id}`);
      return false;
    }
    const bot = await guild.members.fetchMe();
    const perms = channel.permissionsFor(bot);
    if (!perms?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
      console.error(`LOG PERMISSIONS MISSING [${category}]: ${id}`);
      return false;
    }
    embed.setFooter({ text: "RAGEL SADY • SERVER LOGS" }).setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (e) {
    console.error(`LOG ERROR [${category}]:`, e.message);
    return false;
  }
}

// للتوافق مع اللوجات النصية القديمة
async function log(guild, category, title, description) {
  const colors = {
    members: LOG_COLORS.green, invites: LOG_COLORS.green,
    punishments: LOG_COLORS.red, messages: LOG_COLORS.red,
    voice: LOG_COLORS.purple, channels: LOG_COLORS.cyan,
    nicknames: LOG_COLORS.yellow, mass: LOG_COLORS.red, jail: LOG_COLORS.red
  };
  const embed = new EmbedBuilder()
    .setColor(colors[category] ?? LOG_COLORS.def)
    .setTitle(trim(title, 256))
    .setDescription(trim(description, 3900));
  return sendLog(guild, category, embed);
}

/* =========================================
              TARGET + PERMS
========================================= */

async function getTarget(message, args) {
  const first = args[0];
  if (first) {
    const m = first.match(/^<@!?(\d{17,20})>$/);
    const id = m ? m[1] : isID(first) ? first : null;
    if (id) {
      const member = await message.guild.members.fetch(id).catch(() => null);
      return { id, member, consumed: 1 };
    }
  }
  if (message.reference?.messageId) {
    const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (replied?.author) {
      const member = await message.guild.members.fetch(replied.author.id).catch(() => null);
      return { id: replied.author.id, member, consumed: 0 };
    }
  }
  return null;
}

async function checkPermissions(message, permission, target = null) {
  const guild = message.guild;
  const admin = await guild.members.fetch(message.author.id).catch(() => null);
  const bot = await guild.members.fetchMe().catch(() => null);
  if (!admin || !bot) { await fail(message, CONFIG.messages.error); return false; }
  if (!admin.permissions.has(permission)) { await fail(message, CONFIG.messages.permission); return false; }
  if (!bot.permissions.has(permission)) { await fail(message, CONFIG.messages.botPermission); return false; }
  if (target) {
    if (target.id === guild.ownerId || target.id === bot.id) { await fail(message, CONFIG.messages.hierarchy); return false; }
    if (admin.id !== guild.ownerId && admin.roles.highest.comparePositionTo(target.roles.highest) <= 0) { await fail(message, CONFIG.messages.hierarchy); return false; }
    if (bot.roles.highest.comparePositionTo(target.roles.highest) <= 0) { await fail(message, CONFIG.messages.hierarchy); return false; }
  }
  return true;
}

/* =========================================
           ACTIONS + AUDIT TRACKING
========================================= */

function saveAction(guildId, adminId, targetId, action, status = "SUCCESS") {
  db.prepare(`INSERT INTO actions (guild, admin, target, action, status, created) VALUES (?, ?, ?, ?, ?, ?)`).run(guildId, adminId, targetId || null, action, status, Date.now());
}
function markCommandAction(guildId, targetId, action, adminId) {
  commandAudit.set(`${guildId}:${targetId}:${action}`, { adminId, time: Date.now() });
}
function getCommandAdmin(guildId, targetId, action) {
  const r = commandAudit.get(`${guildId}:${targetId}:${action}`);
  if (!r) return null;
  if (Date.now() - r.time > 15000) return null;
  return r.adminId;
}
async function findAuditEntry(guild, type, targetId, validator = null) {
  try {
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has(P.ViewAuditLog)) return null;
    await new Promise(r => setTimeout(r, 1200));
    const logs = await guild.fetchAuditLogs({ type, limit: 15 });
    const list = logs.entries.filter(e => {
      if (e.target?.id !== targetId) return false;
      if (Math.abs(Date.now() - e.createdTimestamp) > 12000) return false;
      if (validator && !validator(e)) return false;
      return true;
    });
    if (list.size !== 1) return null;
    return list.first();
  } catch (e) { return null; }
}
function adminText(id) {
  return id ? `${mention(id)} (${id})` : "تعذر تحديده بشكل موثوق";
}
async function recordAudit(guild, entry, action, targetId) {
  if (!entry?.executorId) return;
  if (auditProcessed.has(entry.id)) return;
  auditProcessed.set(entry.id, Date.now());
  try {
    saveAction(guild.id, entry.executorId, targetId, action);
    await trackMassById(guild, entry.executorId, action, targetId);
  } catch (e) { console.error("AUDIT RECORD:", e.message); }
}

async function trackMassById(guild, adminId, action, targetId = null) {
  const time = Date.now();
  const key = `${guild.id}:${adminId}:${action}`;
  const prev = adminActions.get(key) || [];
  const cur = prev.filter(x => time - x.time < CONFIG.massWindow);
  cur.push({ id: targetId, time });
  adminActions.set(key, cur);
  const uniq = new Set(cur.map(x => x.id).filter(Boolean));
  const count = targetId ? uniq.size : cur.length;
  if (count <= CONFIG.massThreshold) return;
  if (count !== CONFIG.massThreshold + 1 && count % 20 !== 0) return;
  const embed = new EmbedBuilder().setColor(LOG_COLORS.red)
    .setTitle("🚨 Mass Action Alert")
    .addFields(
      { name: "Admin", value: adminText(adminId), inline: true },
      { name: "Action", value: String(action), inline: true },
      { name: "Count", value: `${cur.length} ops / ${uniq.size} targets`, inline: true }
    );
  await sendLog(guild, "mass", embed);
}

async function trackAction(message, action, target) {
  saveAction(message.guild.id, message.author.id, target?.id, action);
  await trackMassById(message.guild, message.author.id, action, target?.id);
}

async function actionLog(message, category, action, target, details = {}) {
  const guild = message.guild;
  let thumb = null;
  try {
    const m = target?.id ? await guild.members.fetch(target.id).catch(() => null) : null;
    if (m) thumb = userAvatar(m.user);
  } catch {}
  const adminUser = message.author;
  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.red)
    .setTitle(`🛡️ ${action} LOG`)
    .setDescription(`**العضو:** ${target?.id ? mention(target.id) : "غير متاح"}\n**User ID:** ${target?.id || "غير متاح"}\n\n**الإداري:** ${mention(adminUser.id)}\n**Admin ID:** ${adminUser.id}`)
    .addFields(
      { name: "Server", value: `${trim(guild.name, 80)} (${guild.id})`, inline: false },
      { name: "Channel", value: `${channelMention(message.channelId)} (${message.channelId})`, inline: false }
    );
  if (thumb) embed.setThumbnail(thumb);
  for (const [k, v] of Object.entries(details)) {
    embed.addFields({ name: String(k), value: trim(String(v), 1000), inline: true });
  }
  await sendLog(guild, category, embed);
}

async function completed(message, options) {
  try { await actionLog(message, options.category, options.action, options.target, options.details || {}); }
  catch (e) { console.error("ACTION LOG ERROR:", e.message); }
  try { await trackAction(message, options.action, options.target); }
  catch (e) { console.error("TRACK ERROR:", e.message); }
  await done(message, options.text).catch(e => console.error("SUCCESS MSG:", e.message));
}

/* =========================================
                 COMMANDS
========================================= */

const commands = {};

commands["تايم"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  const parsed = parseDurationArgs(args, target.consumed, CONFIG.defaultTimeout);
  if (!parsed || parsed.duration > CONFIG.maxTimeout) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ModerateMembers, target.member))) return;
  if (!target.member.moderatable) return fail(message, CONFIG.messages.hierarchy);
  const reason = args.slice(parsed.reasonIndex).join(" ") || "بدون سبب";
  markCommandAction(message.guild.id, target.id, "TIMEOUT", message.author.id);
  await target.member.timeout(parsed.duration * 60000, reason);
  await completed(message, {
    text: format(CONFIG.messages.timeout, { user: mention(target.id), duration: `${parsed.duration} دقيقة` }),
    category: "punishments", action: "TIMEOUT", target,
    details: { "المدة": `${parsed.duration} دقيقة`, "السبب": reason, "ينتهي": `<t:${now() + parsed.duration * 60}:F>` }
  });
};

commands["بان"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.BanMembers, target.member))) return;
  if (target.member && !target.member.bannable) return fail(message, CONFIG.messages.hierarchy);
  const reason = args.slice(target.consumed).join(" ") || "بدون سبب";
  markCommandAction(message.guild.id, target.id, "BAN", message.author.id);
  await message.guild.members.ban(target.id, { reason });
  db.prepare(`DELETE FROM tempbans WHERE guild = ? AND user = ?`).run(message.guild.id, target.id);
  await completed(message, { text: format(CONFIG.messages.ban, { user: mention(target.id) }), category: "punishments", action: "BAN", target, details: { "السبب": reason } });
};

commands["انبان"] = async (message, args) => {
  const id = args[0]?.match(/^(?:<@!?)?(\d{17,20})>?$/)?.[1];
  if (!id) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.BanMembers))) return;
  markCommandAction(message.guild.id, id, "UNBAN", message.author.id);
  await message.guild.members.unban(id);
  db.prepare(`DELETE FROM tempbans WHERE guild = ? AND user = ?`).run(message.guild.id, id);
  await completed(message, { text: format(CONFIG.messages.unban, { user: mention(id) }), category: "punishments", action: "UNBAN", target: { id } });
};

commands["تايم بان"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target) return fail(message, CONFIG.messages.invalid);
  const parsed = parseDurationArgs(args, target.consumed, CONFIG.defaultTempban);
  if (!parsed || parsed.duration > 5256000) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.BanMembers, target.member))) return;
  if (target.member && !target.member.bannable) return fail(message, CONFIG.messages.hierarchy);
  const reason = args.slice(parsed.reasonIndex).join(" ") || "بدون سبب";
  const expires = Date.now() + parsed.duration * 60000;
  const existingBan = await message.guild.bans.fetch(target.id).catch(e => e.code === 10026 ? null : Promise.reject(e));
  if (existingBan) return fail(message, "العضو محظور بالفعل");
  await message.guild.members.ban(target.id, { reason });
  try {
    db.prepare(`INSERT OR REPLACE INTO tempbans (guild, user, admin, reason, expires) VALUES (?, ?, ?, ?, ?)`).run(message.guild.id, target.id, message.author.id, reason, expires);
  } catch (e) {
    console.error("TEMPBAN SAVE:", e);
    try { await message.guild.members.unban(target.id, "Rollback tempban DB fail"); } catch {}
    return fail(message, CONFIG.messages.error);
  }
  markCommandAction(message.guild.id, target.id, "BAN", message.author.id);
  await completed(message, {
    text: format(CONFIG.messages.tempban, { user: mention(target.id), duration: `${parsed.duration} دقيقة` }),
    category: "punishments", action: "TEMP BAN", target,
    details: { "السبب": reason, "المدة": `${parsed.duration} دقيقة`, "ينتهي": `<t:${Math.floor(expires/1000)}:F>` }
  });
};

commands["كيك"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.KickMembers, target.member))) return;
  if (!target.member.kickable) return fail(message, CONFIG.messages.hierarchy);
  const reason = args.slice(target.consumed).join(" ") || "بدون سبب";
  markCommandAction(message.guild.id, target.id, "KICK", message.author.id);
  await target.member.kick(reason);
  await completed(message, { text: format(CONFIG.messages.kick, { user: mention(target.id) }), category: "punishments", action: "KICK", target, details: { "السبب": reason } });
};

commands["نك"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  const nickname = args.slice(target.consumed).join(" ");
  if (!nickname || nickname.length > 32) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ManageNicknames, target.member))) return;
  if (!target.member.manageable) return fail(message, CONFIG.messages.hierarchy);
  const oldName = target.member.nickname || target.member.user.username;
  markCommandAction(message.guild.id, target.id, "NICKNAME", message.author.id);
  await target.member.setNickname(nickname);
  await completed(message, { text: format(CONFIG.messages.nickname, { user: mention(target.id), nickname }), category: "nicknames", action: "NICKNAME", target, details: { "الاسم القديم": oldName, "الاسم الجديد": nickname } });
};

commands["مسح"] = async (message, args) => {
  if (!(await checkPermissions(message, P.ManageMessages))) return;
  const count = Number(args[0]);
  if (!Number.isInteger(count) || count < 1 || count > 100) return fail(message, CONFIG.messages.invalid);
  if (typeof message.channel.bulkDelete !== "function") return fail(message, CONFIG.messages.invalid);
  const bot = await message.guild.members.fetchMe();
  if (!message.channel.permissionsFor(bot)?.has([P.ManageMessages, P.ReadMessageHistory])) return fail(message, CONFIG.messages.botPermission);
  const deleted = await message.channel.bulkDelete(count, true);
  await completed(message, { text: format(CONFIG.messages.clear, { count: deleted.size }), category: "messages", action: "CLEAR", target: null, details: { "العدد المطلوب": count, "العدد المحذوف": deleted.size } });
};

/* ===== .رول @عضو اسم الرول (منشن / ID / ريبلاي) ===== */
commands["رول"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  const roleInput = args.slice(target.consumed).join(" ").trim();
  if (!roleInput) return fail(message, CONFIG.messages.invalid);
  const guild = message.guild;
  const admin = await guild.members.fetch(message.author.id);
  const bot = await guild.members.fetchMe();
  if (!admin.permissions.has(P.ManageRoles)) return fail(message, CONFIG.messages.permission);
  if (!bot.permissions.has(P.ManageRoles)) return fail(message, CONFIG.messages.botPermission);
  await guild.roles.fetch();
  const mID = roleInput.match(/^<@&(\d{17,20})>$/)?.[1] || (isID(roleInput) ? roleInput : null);
  let role = null;
  if (mID) role = guild.roles.cache.get(mID);
  else {
    const found = guild.roles.cache.filter(r => r.name.toLowerCase() === roleInput.toLowerCase());
    if (found.size !== 1) return fail(message, CONFIG.messages.invalid);
    role = found.first();
  }
  if (!role) return fail(message, CONFIG.messages.invalid);
  if (role.id === guild.id || role.managed) return fail(message, CONFIG.messages.hierarchy);
  if (target.member.id === guild.ownerId || target.member.id === bot.id) return fail(message, CONFIG.messages.hierarchy);
  if (admin.id !== guild.ownerId && admin.roles.highest.comparePositionTo(target.member.roles.highest) <= 0) return fail(message, CONFIG.messages.hierarchy);
  if (bot.roles.highest.comparePositionTo(target.member.roles.highest) <= 0) return fail(message, CONFIG.messages.hierarchy);
  if (admin.id !== guild.ownerId && admin.roles.highest.comparePositionTo(role) <= 0) return fail(message, CONFIG.messages.hierarchy);
  if (bot.roles.highest.comparePositionTo(role) <= 0) return fail(message, CONFIG.messages.hierarchy);
  if (target.member.roles.cache.has(role.id)) return fail(message, "العضو معاه الرول دي بالفعل");
  markCommandAction(guild.id, target.id, `ROLE_ADD:${role.id}`, message.author.id);
  await target.member.roles.add(role, `Role by ${message.author.id}`);
  await completed(message, {
    text: format(CONFIG.messages.role, { user: mention(target.id), role: role.name }),
    category: "messages", action: "ROLE ADD", target,
    details: { "الرول": `${role.name} (${role.id})` }
  });
};

commands["سجن"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ManageRoles, target.member))) return;
  const role = await message.guild.roles.fetch(CONFIG.jailRole).catch(() => null);
  if (!role) return fail(message, CONFIG.messages.jailRoleMissing);
  const bot = await message.guild.members.fetchMe();
  if (bot.roles.highest.comparePositionTo(role) <= 0 || !target.member.manageable) return fail(message, CONFIG.messages.hierarchy);
  if (target.member.roles.cache.has(role.id)) return fail(message, format(CONFIG.messages.alreadyJailed, { user: mention(target.id) }));
  markCommandAction(message.guild.id, target.id, `ROLE_ADD:${role.id}`, message.author.id);
  await target.member.roles.add(role, `Jailed by ${message.author.id}`);
  try { db.prepare(`INSERT OR REPLACE INTO jailed (guild, user, admin, created) VALUES (?, ?, ?, ?)`).run(message.guild.id, target.id, message.author.id, Date.now()); } catch {}
  await completed(message, { text: format(CONFIG.messages.jail, { user: mention(target.id) }), category: "jail", action: "JAIL", target, details: { "الرول": `${role.name} (${role.id})` } });
};

commands["حريه"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ManageRoles, target.member))) return;
  const role = await message.guild.roles.fetch(CONFIG.jailRole).catch(() => null);
  if (!role) return fail(message, CONFIG.messages.jailRoleMissing);
  const bot = await message.guild.members.fetchMe();
  if (bot.roles.highest.comparePositionTo(role) <= 0 || !target.member.manageable) return fail(message, CONFIG.messages.hierarchy);
  if (!target.member.roles.cache.has(role.id)) return fail(message, CONFIG.messages.notJailed);
  markCommandAction(message.guild.id, target.id, `ROLE_REMOVE:${role.id}`, message.author.id);
  await target.member.roles.remove(role, `Released by ${message.author.id}`);
  db.prepare(`DELETE FROM jailed WHERE guild = ? AND user = ?`).run(message.guild.id, target.id);
  await completed(message, { text: format(CONFIG.messages.unjail, { user: mention(target.id) }), category: "jail", action: "UNJAIL", target, details: { "الرول المسحوب": `${role.name} (${role.id})` } });
};

commands["vk"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member?.voice.channel) return fail(message, CONFIG.messages.notInVoice);
  if (!(await checkPermissions(message, P.MoveMembers, target.member))) return;
  const ch = target.member.voice.channel;
  await target.member.voice.disconnect();
  await completed(message, { text: format(CONFIG.messages.vk, { user: mention(target.id) }), category: "voice", action: "VOICE KICK", target, details: { "الروم": `${ch.name} (${ch.id})` } });
};

commands["اسكت"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member?.voice.channel) return fail(message, CONFIG.messages.notInVoice);
  if (!(await checkPermissions(message, P.MuteMembers, target.member))) return;
  await target.member.voice.setMute(true);
  await completed(message, { text: format(CONFIG.messages.mute, { user: mention(target.id) }), category: "voice", action: "VOICE MUTE", target, details: { "الروم": `${target.member.voice.channel.name} (${target.member.voice.channel.id})` } });
};

commands["اكلمم"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member?.voice.channel) return fail(message, CONFIG.messages.notInVoice);
  if (!(await checkPermissions(message, P.MuteMembers, target.member))) return;
  await target.member.voice.setMute(false);
  await completed(message, { text: format(CONFIG.messages.unmute, { user: mention(target.id) }), category: "voice", action: "VOICE UNMUTE", target, details: { "الروم": `${target.member.voice.channel.name} (${target.member.voice.channel.id})` } });
};

async function getMuteRole(guild) {
  const roles = await guild.roles.fetch();
  let role = roles.find(r => r.name === "RAGEL SADY MUTED");
  if (!role) role = await guild.roles.create({ name: "RAGEL SADY MUTED", reason: "Text mute" });
  return role;
}
async function applyMuteToChannel(channel, role) {
  if (!channel?.permissionOverwrites) return;
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) return;
  await channel.permissionOverwrites.edit(role, { SendMessages: false, SendMessagesInThreads: false, AddReactions: false }, { reason: "RAGEL SADY Mute" });
}

commands["اخرص"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ManageRoles, target.member))) return;
  const role = await getMuteRole(message.guild);
  const bot = await message.guild.members.fetchMe();
  if (bot.roles.highest.comparePositionTo(role) <= 0 || !target.member.manageable) return fail(message, CONFIG.messages.hierarchy);
  if (target.member.roles.cache.has(role.id)) return fail(message, CONFIG.messages.invalid);
  const channels = await message.guild.channels.fetch();
  let failed = 0;
  for (const ch of channels.values()) {
    if (!ch) continue;
    try { await applyMuteToChannel(ch, role); } catch { failed++; }
  }
  if (failed > 0) return fail(message, CONFIG.messages.error);
  markCommandAction(message.guild.id, target.id, `ROLE_ADD:${role.id}`, message.author.id);
  await target.member.roles.add(role);
  db.prepare(`INSERT OR REPLACE INTO silenced (guild, user, role) VALUES (?, ?, ?)`).run(message.guild.id, target.id, role.id);
  await completed(message, { text: format(CONFIG.messages.silence, { user: mention(target.id) }), category: "punishments", action: "TEXT MUTE", target, details: { "الرول": `${role.name} (${role.id})` } });
};

commands["ارغي"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ManageRoles, target.member))) return;
  const rec = db.prepare(`SELECT role FROM silenced WHERE guild = ? AND user = ?`).get(message.guild.id, target.id);
  if (!rec) return fail(message, CONFIG.messages.invalid);
  const role = await message.guild.roles.fetch(rec.role).catch(() => null);
  if (!role) return fail(message, CONFIG.messages.error);
  markCommandAction(message.guild.id, target.id, `ROLE_REMOVE:${role.id}`, message.author.id);
  if (target.member.roles.cache.has(role.id)) await target.member.roles.remove(role);
  db.prepare(`DELETE FROM silenced WHERE guild = ? AND user = ?`).run(message.guild.id, target.id);
  await completed(message, { text: format(CONFIG.messages.unsilence, { user: mention(target.id) }), category: "punishments", action: "TEXT UNMUTE", target });
};

commands["انقلني"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member?.voice.channel) return fail(message, CONFIG.messages.notInVoice);
  const self = await message.guild.members.fetch(message.author.id);
  if (!self.voice.channel) return fail(message, CONFIG.messages.notInVoice);
  if (!(await checkPermissions(message, P.MoveMembers))) return;
  const oldC = self.voice.channel; const newC = target.member.voice.channel;
  await self.voice.setChannel(newC);
  await completed(message, { text: CONFIG.messages.move, category: "voice", action: "MOVE ME", target: { id: self.id }, details: { "من": `${oldC.name} (${oldC.id})`, "إلى": `${newC.name} (${newC.id})` } });
};

commands["وارن"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target?.member) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ModerateMembers, target.member))) return;
  const reason = args.slice(target.consumed).join(" ") || "بدون سبب";
  const r = db.prepare(`INSERT INTO warnings (guild, user, admin, reason, created) VALUES (?, ?, ?, ?, ?)`).run(message.guild.id, target.id, message.author.id, reason, Date.now());
  await completed(message, { text: format(CONFIG.messages.warn, { user: mention(target.id) }), category: "punishments", action: "WARN", target, details: { "رقم التحذير": r.lastInsertRowid, "السبب": reason } });
};

commands["ورنات"] = async (message, args) => {
  const target = await getTarget(message, args);
  if (!target) return fail(message, CONFIG.messages.invalid);
  if (!(await checkPermissions(message, P.ModerateMembers))) return;
  const warnings = db.prepare(`SELECT * FROM warnings WHERE guild = ? AND user = ? ORDER BY id ASC`).all(message.guild.id, target.id);
  if (!warnings.length) return sendEmbed(message, "⚠️ WARNINGS", CONFIG.messages.noWarnings);
  const pages = Math.ceil(warnings.length / 5);
  for (let p = 0; p < pages; p++) {
    const sel = warnings.slice(p*5, p*5+5);
    const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle("⚠️ RAGEL SADY WARNINGS")
      .setDescription(`**ورنات:** ${mention(target.id)}\n**عدد التحذيرات:** ${warnings.length}`)
      .setFooter({ text: `Page ${p+1}/${pages}` }).setTimestamp();
    if (target.member?.user) embed.setThumbnail(userAvatar(target.member.user));
    sel.forEach((w,i) => {
      embed.addFields({ name: `⚠️ ورن ${p*5+i+1}`, value: `**العضو:** ${mention(w.user)}\n**سبب:** ${trim(w.reason,300)}\n**العملو وارن:** ${mention(w.admin)}\n**التاريخ:** <t:${Math.floor(w.created/1000)}:F>\n**رقم الوارن:** ${w.id}`, inline: false });
    });
    if (p===0) await message.reply({ embeds:[embed], allowedMentions:{parse:[],repliedUser:false} });
    else await message.channel.send({ embeds:[embed], allowedMentions:{parse:[]} });
  }
};

commands["انوارن"] = async (message, args) => {
  if (!(await checkPermissions(message, P.ModerateMembers))) return;
  const id = Number(args[0]);
  if (!Number.isSafeInteger(id) || id < 1) return fail(message, CONFIG.messages.invalid);
  const w = db.prepare(`SELECT * FROM warnings WHERE guild = ? AND id = ?`).get(message.guild.id, id);
  if (!w) return fail(message, CONFIG.messages.invalid);
  db.prepare(`DELETE FROM warnings WHERE guild = ? AND id = ?`).run(message.guild.id, id);
  await completed(message, { text: format(CONFIG.messages.unwarn, { user: mention(w.user) }), category: "punishments", action: "UNWARN", target: { id: w.user }, details: { "رقم التحذير": id, "السبب": w.reason, "الإداري الأصلي": w.admin } });
};

commands["help!"] = async message => {
  const embed = new EmbedBuilder().setColor(CONFIG.color).setTitle("RAGEL SADY _HELP").addFields(
    { name: "🛡️ ADMIN", value: "`.تايم @عضو [دقائق]`\n`.بان @عضو [سبب]`\n`.انبان ID`\n`.تايم بان @عضو [دقائق]`\n`.كيك @عضو [سبب]`\n`.نك @عضو الاسم`\n`.مسح عدد`\n`.رول @عضو اسم الرول`" },
    { name: "🔒 JAIL", value: "`.سجن @عضو`\n`.حريه @عضو`" },
    { name: "🎙️ VOICE", value: "`.vk @عضو`\n`.اسكت @عضو`\n`.اكلمم @عضو`\n`.انقلني @عضو`" },
    { name: "💬 TEXT", value: "`.اخرص @عضو`\n`.ارغي @عضو`" },
    { name: "⚠️ WARNINGS", value: "`.وارن @عضو السبب`\n`.انوارن رقم`\n`.ورنات @عضو`" }
  );
  await message.reply({ embeds:[embed], allowedMentions:{parse:[],repliedUser:false} });
};

/* =========================================
              HANDLER + INVITES
========================================= */

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;
  const c = message.content.trim();
  if (!c.startsWith(PREFIX)) return;
  const input = c.slice(PREFIX.length).trim();
  if (!input) return;
  const parts = input.split(/\s+/);
  let name = parts.shift();
  if (name === "تايم" && parts[0] === "بان") { name = "تايم بان"; parts.shift(); }
  const cmd = commands[name];
  if (!cmd) return;
  if (recentMessages.has(message.id)) return;
  recentMessages.set(message.id, Date.now());
  try { await cmd(message, parts); }
  catch (e) { console.error(`COMMAND ERROR [${name}]:`, e); await fail(message, CONFIG.messages.error).catch(()=>{}); }
});

async function cacheInvites(guild) {
  try {
    const inv = await guild.invites.fetch();
    inviteCache.set(guild.id, new Map(inv.map(i=>[i.code,{uses:i.uses||0,inviterId:i.inviterId||null}])));
  } catch(e){ console.error("INVITE CACHE:", e.message); }
}
async function detectInvite(guild) {
  const prev = inviteCache.get(guild.id);
  try {
    const inv = await guild.invites.fetch();
    const cur = new Map(inv.map(i=>[i.code,{uses:i.uses||0,inviterId:i.inviterId||null}]));
    inviteCache.set(guild.id, cur);
    if (!prev) return null;
    const ch = inv.filter(i=>{ const o=prev.get(i.code); return o && i.uses>o.uses; });
    if (ch.size!==1) return null;
    const one = ch.first(); const old = prev.get(one.code);
    if (one.uses-old.uses!==1) return null;
    return { code: one.code, uses: one.uses, inviterId: one.inviterId||old.inviterId };
  } catch(e){ console.error("INVITE DETECTION:", e.message); return null; }
}
client.on("inviteCreate", i=>{ if(i.guild) cacheInvites(i.guild); });
client.on("inviteDelete", i=>{ if(i.guild) cacheInvites(i.guild); });

/* =========================================
          SMART EVENTS (IMAGE STYLE)
========================================= */

client.on("guildMemberAdd", async member => {
  try {
    const ch = await member.guild.channels.fetch(CONFIG.welcomeChannel).catch(()=>null);
    if (ch?.isTextBased()) {
      const av = member.user.displayAvatarURL({ extension:"png", size:1024 });
      await ch.send({ content:`𝐖𝐄𝐋𝐂𝐎𝐌𝐄 ⋆. 𐙚˚࿔ ${mention(member.id)} 𝜗𝜚˚⋆`, embeds:[new EmbedBuilder().setColor(CONFIG.color).setImage(av)], allowedMentions:{users:[member.id]} });
    }
  } catch(e){ console.error("WELCOME:", e.message); }
  const invite = await detectInvite(member.guild);
  const joinEmbed = new EmbedBuilder().setColor(LOG_COLORS.green).setTitle("✅ Member Joined")
    .setThumbnail(userAvatar(member.user))
    .setDescription(`**${userTag(member.user)}**\n(@${member.user.username})\nJoined the server`)
    .addFields(
      { name:"Account created", value:`<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline:true },
      { name:"Joined via", value: invite?`Invite (${invite.code})`:"غير مؤكد", inline:true },
      { name:"User ID", value:`${member.id}`, inline:false }
    );
  await sendLog(member.guild, "members", joinEmbed);
  const invEmbed = new EmbedBuilder().setColor(LOG_COLORS.green).setTitle("🔗 Invite Info")
    .setThumbnail(userAvatar(member.user))
    .addFields(
      { name:"Member", value:`${mention(member.id)} (${member.id})`, inline:false },
      { name:"Code", value: invite?.code||"غير مؤكد", inline:true },
      { name:"Inviter", value: invite?.inviterId?adminText(invite.inviterId):"غير معروف", inline:true }
    );
  await sendLog(member.guild, "invites", invEmbed);
});

client.on("guildMemberRemove", async member => {
  const cmdAdmin = getCommandAdmin(member.guild.id, member.id, "KICK");
  const audit = cmdAdmin?null:await findAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  const adminId = cmdAdmin||audit?.executorId;
  const embed = new EmbedBuilder().setColor(LOG_COLORS.orange).setTitle("📤 Member Left / Kicked")
    .setThumbnail(member.user?userAvatar(member.user):null)
    .setDescription(`**${userTag(member.user)}**`)
    .addFields(
      { name:"User ID", value:`${member.id}`, inline:true },
      { name:"By", value:adminText(adminId), inline:true },
      { name:"Reason", value: adminId?"تم رصد طرد":"خروج او طرد غير مؤكد", inline:false }
    );
  await sendLog(member.guild, "members", embed);
  if (audit) await recordAudit(member.guild, audit, "KICK", member.id);
});

client.on("messageDelete", async message => {
  if (!message.guild) return;
  if (message.author?.id===client.user.id) return;
  let deleter = null;
  if (message.author) {
    const a = await findAuditEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id, e=>e.extra?.channel?.id===message.channelId);
    if (a) { deleter=a.executorId; await recordAudit(message.guild,a,"MESSAGE DELETE",message.author.id); }
  }
  const embed = new EmbedBuilder().setColor(LOG_COLORS.red).setTitle("🗑️ Message Deleted")
    .setDescription(`**${userTag(message.author)}**\n${message.author?`(@${message.author.username})`:""}`)
    .addFields(
      { name:"Channel", value:`${channelMention(message.channelId)}`, inline:true },
      { name:"Message", value:trim(message.content||"(مرفقات / ايمبد)",900), inline:true },
      { name:"Deleted by", value: deleter?adminText(deleter):"صاحب الرسالة او تعذر التحديد", inline:true },
      { name:"Message ID", value:`${message.id}`, inline:false }
    );
  if (message.author) embed.setThumbnail(userAvatar(message.author));
  await sendLog(message.guild, "messages", embed);
});

client.on("messageUpdate", async (o,n) => {
  if (!n.guild) return;
  if (o.content===n.content) return;
  const embed = new EmbedBuilder().setColor(LOG_COLORS.yellow).setTitle("✏️ Message Edited")
    .addFields(
      { name:"Member", value:n.author?`${userTag(n.author)} (${n.author.id})`:"غير معروف", inline:false },
      { name:"Channel", value:`${channelMention(n.channelId)}`, inline:true },
      { name:"Before", value:trim(o.content||"غير متاح",900), inline:false },
      { name:"After", value:trim(n.content||"غير متاح",900), inline:false }
    );
  if (n.author) embed.setThumbnail(userAvatar(n.author));
  await sendLog(n.guild, "messages", embed);
});

client.on("guildMemberUpdate", async (oldM,newM) => {
  const guild=newM.guild;
  if (oldM.nickname!==newM.nickname) {
    const cmdA=getCommandAdmin(guild.id,newM.id,"NICKNAME");
    const audit=cmdA?null:await findAuditEntry(guild,AuditLogEvent.MemberUpdate,newM.id,e=>e.changes?.some(c=>c.key==="nick"));
    const adminId=cmdA||audit?.executorId;
    const embed=new EmbedBuilder().setColor(LOG_COLORS.yellow).setTitle("📝 Nickname Updated")
      .setThumbnail(userAvatar(newM.user))
      .addFields(
        { name:"Member", value:`${mention(newM.id)} (${newM.id})`, inline:false },
        { name:"Old", value:oldM.nickname||"بدون لقب", inline:true },
        { name:"New", value:newM.nickname||"بدون لقب", inline:true },
        { name:"By", value:adminText(adminId), inline:false }
      );
    await sendLog(guild,"nicknames",embed);
    if(audit) await recordAudit(guild,audit,"NICKNAME UPDATE",newM.id);
  }
  const added=newM.roles.cache.filter(r=>!oldM.roles.cache.has(r.id));
  const removed=oldM.roles.cache.filter(r=>!newM.roles.cache.has(r.id));
  if(!added.size&&!removed.size) return;
  const expA=[...added.keys()], expR=[...removed.keys()];
  const audit=await findAuditEntry(guild,AuditLogEvent.MemberRoleUpdate,newM.id,e=>{
    const ch=e.changes||[];
    const aIDs=ch.filter(c=>c.key==="$add").flatMap(c=>(c.new||[]).map(r=>r.id));
    const rIDs=ch.filter(c=>c.key==="$remove").flatMap(c=>(c.new||[]).map(r=>r.id));
    return expA.every(id=>aIDs.includes(id))&&expR.every(id=>rIDs.includes(id));
  });
  for(const role of added.values()){
    const cmdA=getCommandAdmin(guild.id,newM.id,`ROLE_ADD:${role.id}`);
    const adminId=cmdA||audit?.executorId;
    const embed=new EmbedBuilder().setColor(LOG_COLORS.blue).setTitle("🎭 Role Updated")
      .setThumbnail(userAvatar(newM.user))
      .setDescription(`**${userTag(newM.user)}**`)
      .addFields(
        { name:"Role given", value:`<@&${role.id}> (${role.id})`, inline:true },
        { name:"By", value:adminText(adminId), inline:true },
        { name:"User ID", value:`${newM.id}`, inline:false }
      );
    await sendLog(guild, role.id===CONFIG.jailRole?"jail":"messages", embed);
  }
  for(const role of removed.values()){
    const cmdA=getCommandAdmin(guild.id,newM.id,`ROLE_REMOVE:${role.id}`);
    const adminId=cmdA||audit?.executorId;
    const embed=new EmbedBuilder().setColor(LOG_COLORS.blue).setTitle("🎭 Role Removed")
      .setThumbnail(userAvatar(newM.user))
      .addFields(
        { name:"Role", value:`${role.name} (${role.id})`, inline:true },
        { name:"By", value:adminText(adminId), inline:true },
        { name:"User ID", value:`${newM.id}`, inline:false }
      );
    await sendLog(guild, role.id===CONFIG.jailRole?"jail":"messages", embed);
  }
  if(audit) await recordAudit(guild,audit,"MEMBER ROLE UPDATE",newM.id);
});

client.on("roleCreate", async role=>{
  const a=await findAuditEntry(role.guild,AuditLogEvent.RoleCreate,role.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.blue).setTitle("🎭 Role Created")
    .addFields({name:"Role",value:`${role.name} (${role.id})`,inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(role.guild,"messages",e);
  if(a) await recordAudit(role.guild,a,"ROLE CREATE",role.id);
});
client.on("roleDelete", async role=>{
  const a=await findAuditEntry(role.guild,AuditLogEvent.RoleDelete,role.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.red).setTitle("🗑️ Role Deleted")
    .addFields({name:"Role",value:`${role.name} (${role.id})`,inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(role.guild,"messages",e);
  if(a) await recordAudit(role.guild,a,"ROLE DELETE",role.id);
});
client.on("roleUpdate", async (o,n)=>{
  const ch=[];
  if(o.name!==n.name) ch.push(`**الاسم:** ${o.name} → ${n.name}`);
  if(o.permissions.bitfield!==n.permissions.bitfield){
    const b=new Set(o.permissions.toArray()), a2=new Set(n.permissions.toArray());
    ch.push(`**المضافة:** ${[...a2].filter(x=>!b.has(x)).join(", ")||"لا يوجد"}`);
    ch.push(`**المسحوبة:** ${[...b].filter(x=>!a2.has(x)).join(", ")||"لا يوجد"}`);
  }
  if(!ch.length) return;
  const a=await findAuditEntry(n.guild,AuditLogEvent.RoleUpdate,n.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.blue).setTitle("⚙️ Role Updated")
    .addFields({name:"Role",value:`${n.name} (${n.id})`,inline:false},{name:"Changes",value:trim(ch.join("\n"),1000),inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(n.guild,"messages",e);
  if(a) await recordAudit(n.guild,a,"ROLE UPDATE",n.id);
});

client.on("voiceStateUpdate", async (o,n)=>{
  const m=n.member||o.member; if(!m) return;
  const ch=[];
  if(o.channelId!==n.channelId){
    if(!o.channelId) ch.push(`دخول: ${n.channel?.name}`);
    else if(!n.channelId) ch.push(`خروج: ${o.channel?.name}`);
    else ch.push(`من ${o.channel?.name} → ${n.channel?.name}`);
  }
  if(o.serverMute!==n.serverMute) ch.push(n.serverMute?"كتم صوت":"فك كتم");
  if(o.serverDeaf!==n.serverDeaf) ch.push(n.serverDeaf?"Deafen":"Undeafen");
  if(!ch.length) return;
  let audit=null;
  if(o.serverMute!==n.serverMute) audit=await findAuditEntry(m.guild,AuditLogEvent.MemberUpdate,m.id,e=>e.changes?.some(c=>c.key==="mute"));
  const e=new EmbedBuilder().setColor(LOG_COLORS.purple).setTitle("🎙️ Voice Log")
    .setThumbnail(userAvatar(m.user))
    .addFields({name:"Member",value:`${mention(m.id)} (${m.id})`,inline:false},{name:"Update",value:ch.join("\n"),inline:false},{name:"By",value:adminText(audit?.executorId),inline:true});
  await sendLog(m.guild,"voice",e);
  if(audit) await recordAudit(m.guild,audit,"VOICE MOD",m.id);
});

client.on("channelCreate", async ch=>{
  if(!ch.guild) return;
  const a=await findAuditEntry(ch.guild,AuditLogEvent.ChannelCreate,ch.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.cyan).setTitle("📁 Channel Created").addFields({name:"Channel",value:`${ch.name} (${ch.id})`,inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(ch.guild,"channels",e);
  if(a) await recordAudit(ch.guild,a,"CHANNEL CREATE",ch.id);
  const mute=ch.guild.roles.cache.find(r=>r.name==="RAGEL SADY MUTED");
  if(mute) await applyMuteToChannel(ch,mute).catch(()=>{});
});
client.on("channelDelete", async ch=>{
  if(!ch.guild) return;
  const a=await findAuditEntry(ch.guild,AuditLogEvent.ChannelDelete,ch.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.red).setTitle("🗑️ Channel Deleted").addFields({name:"Channel",value:`${ch.name} (${ch.id})`,inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(ch.guild,"channels",e);
  if(a) await recordAudit(ch.guild,a,"CHANNEL DELETE",ch.id);
});
client.on("channelUpdate", async (o,n)=>{
  if(!n.guild) return;
  if(o.name===n.name&&o.topic===n.topic) return;
  const a=await findAuditEntry(n.guild,AuditLogEvent.ChannelUpdate,n.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.cyan).setTitle("⚙️ Channel Updated").addFields({name:"Channel",value:`${n.name} (${n.id})`,inline:false},{name:"By",value:adminText(a?.executorId),inline:true});
  await sendLog(n.guild,"channels",e);
  if(a) await recordAudit(n.guild,a,"CHANNEL UPDATE",n.id);
});

client.on("guildBanAdd", async ban=>{
  const cmdA=getCommandAdmin(ban.guild.id,ban.user.id,"BAN");
  const a=await findAuditEntry(ban.guild,AuditLogEvent.MemberBanAdd,ban.user.id);
  const adminId=cmdA||a?.executorId;
  const e=new EmbedBuilder().setColor(LOG_COLORS.red).setTitle("🔨 Member Banned")
    .setThumbnail(userAvatar(ban.user))
    .setDescription(`**${userTag(ban.user)}**`)
    .addFields({name:"Reason",value:trim(a?.reason||"غير متاح",900),inline:false},{name:"Banned by",value:adminText(adminId),inline:true},{name:"User ID",value:`${ban.user.id}`,inline:false});
  await sendLog(ban.guild,"punishments",e);
  if(a&&!cmdA) await recordAudit(ban.guild,a,"BAN",ban.user.id);
});
client.on("guildBanRemove", async ban=>{
  const cmdA=getCommandAdmin(ban.guild.id,ban.user.id,"UNBAN");
  const a=await findAuditEntry(ban.guild,AuditLogEvent.MemberBanRemove,ban.user.id);
  db.prepare(`DELETE FROM tempbans WHERE guild = ? AND user = ?`).run(ban.guild.id,ban.user.id);
  const e=new EmbedBuilder().setColor(LOG_COLORS.green).setTitle("🔓 Member Unbanned").addFields({name:"Member",value:`${ban.user.username} (${ban.user.id})`,inline:false},{name:"By",value:adminText(cmdA||a?.executorId),inline:true});
  await sendLog(ban.guild,"punishments",e);
  if(a&&!cmdA) await recordAudit(ban.guild,a,"UNBAN",ban.user.id);
});

/* =========================================
               TEMPBAN + CLEANUP
========================================= */

let checking=false;
async function checkTempbans(){
  if(checking) return; checking=true;
  try{
    const exp=db.prepare(`SELECT * FROM tempbans WHERE expires <= ? LIMIT 50`).all(Date.now());
    for(const r of exp){
      try{
        const g=await client.guilds.fetch(r.guild);
        const b=await g.bans.fetch(r.user).catch(e=>e.code===10026?null:Promise.reject(e));
        if(b){ markCommandAction(g.id,r.user,"UNBAN",client.user.id); await g.members.unban(r.user,"Tempban expired"); }
        db.prepare(`DELETE FROM tempbans WHERE guild = ? AND user = ?`).run(r.guild,r.user);
        const e=new EmbedBuilder().setColor(LOG_COLORS.green).setTitle("✅ Temp Ban Expired").addFields({name:"Member",value:`${mention(r.user)} (${r.user})`,inline:false},{name:"Admin",value:r.admin?adminText(r.admin):"غير متاح",inline:true});
        await sendLog(g,"punishments",e);
      }catch(e){ console.error("TEMPBAN:",e.message); }
    }
  }finally{ checking=false; }
}
setInterval(()=>{
  const t=Date.now();
  for(const [id,c] of recentMessages) if(t-c>60000) recentMessages.delete(id);
  for(const [k,a] of adminActions){ const v=a.filter(x=>t-x.time<CONFIG.massWindow); if(v.length) adminActions.set(k,v); else adminActions.delete(k); }
  for(const [k,v] of commandAudit) if(t-v.time>30000) commandAudit.delete(k);
  try{ db.prepare(`DELETE FROM actions WHERE created < ?`).run(t-30*24*60*60*1000); }catch{}
},30000);

async function sendStartupMessage(guild){
  try{
    const bot=await guild.members.fetchMe();
    if(!bot.roles.cache.has(CONFIG.botRole)) console.warn(`BOT ROLE NOT FOUND: ${CONFIG.botRole}`);
    const ch=await guild.channels.fetch(CONFIG.startupChannel).catch(()=>null);
    if(!ch?.isTextBased()) return;
    if(!ch.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])){ console.error("STARTUP MESSAGE: Missing channel permissions"); return; }
    await ch.send({ embeds:[new EmbedBuilder().setColor(CONFIG.color).setDescription("انا جيت")], allowedMentions:{parse:[]} });
    console.log("STARTUP MESSAGE SENT");
  }catch(e){ console.error("STARTUP:",e.message); }
}

client.once("clientReady", async ()=>{
  console.log(`\nBOT IS ONLINE\nBot: ${client.user.tag}\nServers: ${client.guilds.cache.size}\nCommands: ${Object.keys(commands).length}\nPrefix: .\nHelp: .help!\nDatabase: SQLite`);
  client.user.setActivity(".help! | RAGEL SADY");
  for(const g of client.guilds.cache.values()){ await sendStartupMessage(g); await cacheInvites(g); }
  await checkTempbans();
  setInterval(()=>checkTempbans().catch(console.error),30000);
});
client.on("guildCreate", g=>cacheInvites(g));
client.on("error", e=>console.error("CLIENT ERROR:",e));
process.on("unhandledRejection", e=>console.error("UNHANDLED:",e));
client.login(TOKEN);
