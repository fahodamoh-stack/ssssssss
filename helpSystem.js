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
      "Random reactions are enabled in <#1560996836808855593>.",
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

function availableSections(guild, userId, member) {
  const isOwner = guild.ownerId === userId;
  const isAdmin = Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator)
  );

  return Object.entries(SECTIONS).filter(([, section]) => {
    if (section.ownerOnly && !isOwner) return false;
    if (section.adminOnly && !isAdmin && !isOwner) return false;
    return true;
  });
}

async function resolveEmojis(client, guild, sections) {
  const result = {};
  const missing = [];

  for (const [key] of sections) {
    const id = EMOJI_IDS[key];

    let emoji = client.emojis.cache.get(id);

    if (!emoji) {
      emoji = await guild.emojis.fetch(id).catch(() => null);
    }

    if (!emoji && client.application?.emojis) {
      emoji = await client.application.emojis.fetch(id).catch(() => null);
    }

    if (!emoji || !emoji.name || emoji.available === false) {
      missing.push(id);
      continue;
    }

    result[key] = emoji;
  }

  return {
    emojis: result,
    missing: [...new Set(missing)],
  };
}

function menuEmoji(emoji) {
  return {
    id: emoji.id,
    name: emoji.name,
    animated: Boolean(emoji.animated),
  };
}

function buildMenu(sections, emojis) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("milan_help:select")
    .setPlaceholder("اختار القسم")
    .addOptions(
      sections.map(([key, section]) => ({
        label: section.label,
        description: section.description,
        value: key,
        emoji: menuEmoji(emojis[key]),
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function homeEmbed(sections, emojis, client) {
  const list = sections
    .map(([key, section]) => `${emojis[key]} **${section.label}**`)
    .join("\n");

  return new EmbedBuilder()
    .setColor(0x203234)
    .setTitle("MILAN • HELP CENTER")
    .setDescription([
      "**Your ultimate server companion**",
      "",
      "**ONLINE**",
      "",
      "**أهلاً بك في قائمة المساعدة**",
      "اختار القسم من القائمة علشان تشوف التفاصيل.",
      "",
      list,
      "",
      "*الأنظمة غير المنفذة موضحة داخل أقسامها.*",
    ].join("\n"))
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: "MILAN • HELP CENTER" });
}

function sectionEmbed(key, emoji) {
  const section = SECTIONS[key];

  return new EmbedBuilder()
    .setColor(0x203234)
    .setTitle(`${emoji} ${section.label}`)
    .setDescription(section.body)
    .setFooter({ text: "MILAN • HELP CENTER" });
}

module.exports = function registerHelpSystem(client) {
  async function registerSlash(guild) {
    try {
      // Creates or updates only /help; does not replace other commands.
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

  async function makeHome(guild, userId, member) {
    const sections = availableSections(guild, userId, member);
    const { emojis, missing } = await resolveEmojis(client, guild, sections);

    if (missing.length) {
      throw new Error(
        `HELP EMOJIS UNAVAILABLE: ${missing.join(", ")}`
      );
    }

    return {
      embeds: [homeEmbed(sections, emojis, client)],
      components: [buildMenu(sections, emojis)],
      allowedMentions: { parse: [], repliedUser: false },
    };
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (message.content.trim().toLowerCase() !== ".help") return;

    try {
      const payload = await makeHome(
        message.guild,
        message.author.id,
        message.member
      );

      await message.reply(payload);
    } catch (error) {
      console.error("HELP MESSAGE ERROR:", error);

      await message.reply({
        content: "تعذر فتح الـHelp. تأكد من إيموجيات البوت وصلاحياته، وراجع الكونسل.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.inGuild()) return;

    const isHelpCommand =
      interaction.isChatInputCommand() &&
      interaction.commandName === "help";

    const isHelpMenu =
      interaction.isStringSelectMenu() &&
      interaction.customId === "milan_help:select";

    if (!isHelpCommand && !isHelpMenu) return;

    try {
      // Acknowledge first: emoji/member fetching can take more than 3 seconds.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const member = await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null);

      if (!member) {
        await interaction.editReply("مش قادر أتحقق من عضويتك حالياً.");
        return;
      }

      if (isHelpCommand) {
        const payload = await makeHome(
          interaction.guild,
          interaction.user.id,
          member
        );

        await interaction.editReply(payload);
        return;
      }

      const key = interaction.values[0];
      const sections = availableSections(
        interaction.guild,
        interaction.user.id,
        member
      );

      if (!sections.some(([sectionKey]) => sectionKey === key)) {
        await interaction.editReply("القسم ده مش متاح ليك.");
        return;
      }

      const { emojis, missing } = await resolveEmojis(
        client,
        interaction.guild,
        [[key, SECTIONS[key]]]
      );

      if (missing.length) {
        throw new Error(`HELP EMOJI UNAVAILABLE: ${missing.join(", ")}`);
      }

      await interaction.editReply({
        embeds: [sectionEmbed(key, emojis[key])],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("HELP INTERACTION ERROR:", error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          "تعذر فتح القسم. تأكد من الإيموجيات وراجع الكونسل."
        ).catch(console.error);
      } else {
        await interaction.reply({
          content: "حصل خطأ. راجع الكونسل.",
          flags: MessageFlags.Ephemeral,
        }).catch(console.error);
      }
    }
  });
};