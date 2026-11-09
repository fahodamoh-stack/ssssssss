const {
  ActionRowBuilder,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require("discord.js");

const EMOJI_IDS = {
  economy: "1568544017866563584",
  level: "1568544323128262697",
  games: "1568544172124807239",
  tasks: "1568544100142030929",
  tickets: "1568544106756710410",
  server: "1568544016075722864",
  owner: "1568544017866563584",
  settings: "1568543950887850004",
};

const SECTIONS = {
  economy: {
    label: "ECONOMY",
    description: "Coin economy",
    body: [
      "**COIN ECONOMY**",
      "`.balance` — View your Coin balance.",
      "`.daily` — Claim your daily Coin reward.",
      "`.work 100` — Bet at least 100 Coin. Win or lose the amount.",
      "`.pay @member 100` — Transfer Coin to another member.",
      "",
      "`.work` is available in <#1560996851640045710> and <#1560996836808855593>.",
      "Work normally has a one-hour cooldown; eligible roles have exceptions.",
      "The unlimited-balance role is separate from the cooldown exemption.",
      "",
      "Shop, inventory and missions are still under development."
    ].join("\n"),
  },

  level: {
    label: "LEVEL & RANK",
    description: "XP, levels and rank",
    body: [
      "**LEVEL & RANK**",
      "`.rank` or `/rank` — View your rank in <#1560996851640045710>.",
      "Eligible messages grant XP with a cooldown.",
      "Level-up announcements: <#1560996854072615053>.",
      "The rank display includes XP, level, messages, Coin and voice activity.",
      "",
      "Additional rank features and the requested XP curve are still being completed."
    ].join("\n"),
  },

  games: {
    label: "GAMES",
    description: "Games and activities",
    body: [
      "**GAMES**",
      "`.xo 100` — XO against another member; if nobody joins in 15 seconds, play the bot for free.",
      "`.rps` — Rock Paper Scissors against the bot.",
      "`.trivia` — Trivia questions.",
      "`.wyr` — Would You Rather.",
      "`.vote` — Voting.",
      "`.capitals` — Guess capitals.",
      "`.flags` — Guess flags.",
      "`.guess` — Guess the number.",
      "`.guesspicture` — Guess the picture.",
      "`.dice` — Dice.",
      "`.cut` — Cut Tweet.",
      "`.slots` — Slots.",
      "`.roulette` — Roulette.",
      "`.box` — Lucky Box.",
      "`.imposter` — Find the Imposter.",
      "`.mafia` • `.thief` • `.detective` — Social games.",
      "`.حظ` — Daily prize wheel in <#1560996851640045710>.",
      "",
      "Use an individual command for its usage and rules.",
      "Games have been loaded, but some features still require testing.",
      "XO unsettled stakes require staff review; open a ticket if there is a problem."
    ].join("\n"),
  },

  tasks: {
    label: "TASKS & MISSIONS",
    description: "Daily and weekly missions",
    body: [
      "**TASKS & MISSIONS**",
      "Daily and weekly missions, progress and mission rewards are still under development.",
      "This section will be updated when they are available."
    ].join("\n"),
  },

  tickets: {
    label: "TICKETS",
    description: "Support tickets",
    body: [
      "**TICKETS**",
      "Open a ticket from the ticket panel and choose the appropriate category:",
      "Partner, Report, Support or Verify Girl.",
      "Staff can claim and close tickets; ticket activity is logged.",
      "",
      "If you have a problem with a game or transaction, open a support ticket."
    ].join("\n"),
  },

  server: {
    label: "SERVER",
    description: "Help and server commands",
    body: [
      "**SERVER**",
      "`.help` or `/help` — Open this help menu.",
      "`.rank` or `/rank` — View rank in <#1560996851640045710>.",
      "Partnerships: post a valid server invite in <#1560996824641437866>.",
      "The partnership system creates an announcement with a GIF and keeps the invite.",
      "",
      "Administrative sections appear according to your permissions.",
      "Some systems still need end-to-end testing."
    ].join("\n"),
  },

  owner: {
    label: "OWNER",
    description: "Server owner information",
    ownerOnly: true,
    body: [
      "هذا القسم ظاهر لمالك السيرفر فقط.",
      "أوامر المالك الجديدة هتظهر هنا بعد تنفيذها.",
    ].join("\n"),
  },

  settings: {
    label: "SETTINGS",
    description: "Administration and settings",
    adminOnly: true,
    body: [
      "**إدارة الأعضاء**",
      "`.تايم @عضو [دقائق] [سبب]`",
      "`.بان @عضو [سبب]` • `.انبان ID [سبب]`",
      "`.تايم بان @عضو [دقائق] [سبب]` • `.كيك @عضو [سبب]`",
      "`.وارن @عضو [سبب]` • `.ورنات @عضو`",
      "`.انوارن رقم_التحذير`",
      "",
      "**السيرفر والفويس**",
      "`.رول @عضو اسم_الرول` • `.نك @عضو الاسم`",
      "`.سجن @عضو` • `.حريه @عضو`",
      "`.مسح العدد` • `.ق` • `.ف`",
      "`.اخرص @عضو` • `.ارغي @عضو`",
      "`.vk @عضو` • `.اسكت @عضو` • `.اكلمم @عضو`",
      "`.انقلني`",
      "",
      "`.wlctest` • `.wl.5` — اختبار الترحيب.",
      "`/emo add` • `/emo remove` • `/emo list` — نظام الإيموجي الحالي.",
      "",
      "تنفيذ كل أمر يحتاج صلاحياته المناسبة؛ `/emo` له صلاحياته الخاصة.",
    ].join("\n"),
  },
};

const MEMBER_ROLE = "1567427149701451786";

const STAFF_RULES = {
  "1563517877644955790": ["timeout"],
  "1563505395576742011": ["timeout", "voice", "status"],
  "1563089554028634132": ["timeout", "nickname"],
  "1561044845269876736": ["timeout", "clear", "voice"],
  "1561044515597582336": ["timeout", "kick", "ban", "nickname"],
  "1561043898359353485": ["all"],
  "1565446860359868508": ["all"],
};

function getHelpAccess(guild, userId, member) {
  const owner = guild.ownerId === userId;
  const admin = Boolean(
    member.permissions?.has(PermissionsBitField.Flags.Administrator)
  );
  const rules = new Set();

  for (const [roleId, permissions] of Object.entries(STAFF_RULES)) {
    if (member.roles.cache.has(roleId)) {
      for (const permission of permissions) rules.add(permission);
    }
  }

  const extraFullHelpRoles = [
    "1561045275643215992",
    "1563541870150164631",
    "1565432232913535136",
    "1539363458145853590",
  ];
  if (owner || admin || extraFullHelpRoles.some(id => member.roles.cache.has(id))) {
    rules.add("all");
  }

  return {
    allowed: owner || admin ||
      member.roles.cache.has(MEMBER_ROLE) ||
      rules.size > 0,
    rules,
  };
}

function adminText(rules) {
  if (rules.has("all")) {
    return SECTIONS.settings.body;
  }

  const lines = [];
  if (rules.has("timeout")) {
    lines.push("`.تايم @عضو [دقائق] [سبب]`");
  }
  if (rules.has("nickname")) {
    lines.push("`.نك @عضو الاسم`");
  }
  if (rules.has("clear")) {
    lines.push("`.مسح العدد`");
  }
  if (rules.has("kick")) {
    lines.push("`.كيك @عضو [سبب]`");
  }
  if (rules.has("ban")) {
    lines.push("`.بان @عضو [سبب]` • `.انبان ID [سبب]`");
  }

  // Voice command spellings are not assumed without inspecting their handlers.
  if (rules.has("voice")) {
    lines.push("الفويس: ميوت • ديفن • نقل أعضاء.");
  }
  if (rules.has("status")) {
    lines.push("الفويس: حالة القناة.");
  }

  if (!lines.length) return "";

  lines.push("");
  lines.push("ظهور الأمر هنا لا يمنح صلاحية تنفيذه.");
  return lines.join("\n");
}

function makeHelp(client, guild, userId, member) {
  const access = getHelpAccess(guild, userId, member);

  if (!access.allowed) {
    return {
      content: "الـHelp متاح للأعضاء اللي معاهم رول العضو أو رول إداري محدد.",
      allowedMentions: { parse: [] },
    };
  }

  const fields = [
    {
      name: "ECONOMY & COIN SYSTEM",
      value: [
        "`.balance` — Check your Coin balance.",
        "`.daily` — Claim your daily reward.",
        "`.work 100` — Bet at least 100 Coin; win or lose your bet.",
        "`.pay @member 100` — Transfer Coins.",
        "",
        "**Work:** <#1560996851640045710> • <#1560996836808855593>",
        "Standard cooldown: 1 hour; eligible roles have exceptions.",
        "The unlimited-balance role is separate from the cooldown exemption.",
        "*Shop, Inventory and Missions are under development.*",
      ].join("\n"),
    },
    {
      name: "LEVEL & RANK",
      value: [
        "`.rank` or `/rank` — View your rank in <#1560996851640045710>.",
        "Eligible messages grant XP with a cooldown.",
        "Level-up announcements: <#1560996854072615053>.",
        "Your rank shows XP, level, Coin, messages and voice activity.",
        "*Additional rank features are being completed.*",
      ].join("\n"),
    },
    {
      name: "GAMES & ENTERTAINMENT",
      value: [
        "**Multiplayer**",
        "`.xo 100` — Challenge a member; if nobody joins in 15 seconds, play the bot for free.",
        "**Quick games**",
        "`.rps` • `.trivia` • `.wyr` • `.vote`",
        "`.guess` • `.guesspicture` • `.cut`",
        "**Knowledge**",
        "`.capitals` • `.flags`",
        "**Casino & luck**",
        "`.dice` • `.slots` • `.roulette` • `.box`",
        "`.حظ` — Daily prize wheel in <#1560996851640045710>.",
        "**Social & deduction**",
        "`.imposter` • `.mafia` • `.thief` • `.detective`",
        "",
        "Use each command for its instructions and rules.",
        "Unsettled XO stakes require staff review; open a Support ticket.",
      ].join("\n"),
    },
    {
      name: "TICKETS & SUPPORT",
      value: [
        "Open a ticket from the ticket panel:",
        "**Partner** • **Report** • **Support** • **Verify Girl**",
        "Staff can claim and close tickets; ticket activity is logged.",
        "For game or transaction problems, open a Support ticket.",
      ].join("\n"),
    },
    {
      name: "SERVER & COMMUNITY",
      value: [
        "`.help` — Display the Help Center in chat.",
        "`/help` — Open the Help Center privately.",
        "`.rank` or `/rank` — View your rank in <#1560996851640045710>.",
        "**Partnerships**",
        "Post a valid server invite in <#1560996824641437866>.",
        "The system creates an announcement with a GIF and keeps the invite.",
      ].join("\n"),
    },
  ];

  // Display only: keep the existing role mapping and command permissions.
  const administration = adminText(access.rules)
    .split("\n")
    .filter(line => !line.includes(".wlctest") && !line.includes(".wl.5"))
    .join("\n")
    .trim();

  if (administration) {
    fields.push({ name: "ADMINISTRATION", value: administration });
  }

  for (const field of fields) {
    if (!field.value || field.value.length > 1024) {
      throw new Error(`HELP FIELD INVALID: ${field.name}`);
    }
  }

  const total = fields.reduce(
    (sum, field) => sum + field.name.length + field.value.length, 0
  );
  if (total > 5500) throw new Error(`HELP TOO LONG: ${total}`);

  const embed = new EmbedBuilder()
    .setColor(0x203234)
    .setTitle("MILAN | HELP CENTER")
    .setDescription(
      "Welcome to **MILAN COMMUNITY**.\n" +
      "Your destination for gaming, economy, rankings and community."
    )
    .addFields(fields)
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: "MILAN | PLAY • COMPETE • PROGRESS" });

  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}
module.exports = function registerHelpSystem(client) {
  async function registerSlash(guild) {
    try {
      await guild.commands.create({
        name: "help",
        description: "Open the MILAN help center",
        dm_permission: false,
      });
      console.log(`HELP SLASH READY [${guild.id}]`);
    } catch (error) {
      console.error(`HELP REGISTER [${guild.id}]:`, error.message);
    }
  }

  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) {
      await registerSlash(guild);
    }
  });

  client.on(Events.GuildCreate, guild => {
    registerSlash(guild).catch(console.error);
  });

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (message.content.trim().toLowerCase() !== ".help") return;

    try {
      const member = await message.guild.members.fetch(message.author.id);
      const payload = makeHelp(client, message.guild, message.author.id, member);

      await message.reply({
        ...payload,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      console.error("HELP MESSAGE ERROR:", error);
      await message.reply({
        content: "تعذر فتح الـHelp حاليًا. راجع الكونسل.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
    }
  });
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.inGuild()) return;
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "help") return;

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const member = await interaction.guild.members.fetch(interaction.user.id);
      await interaction.editReply(
        makeHelp(client, interaction.guild, interaction.user.id, member)
      );
    } catch (error) {
      console.error("HELP INTERACTION ERROR:", error);
      const payload = {
        content: "تعذر فتح الـHelp حاليًا. راجع الكونسل.",
        allowedMentions: { parse: [] },
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(console.error);
      } else {
        await interaction.reply({
          ...payload,
          flags: MessageFlags.Ephemeral,
        }).catch(console.error);
      }
    }
  });
};