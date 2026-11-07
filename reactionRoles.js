const {
  EmbedBuilder,
  Events,
  PermissionsBitField,
} = require("discord.js");

const P = PermissionsBitField.Flags;
const LOG_CHANNEL = "1560996906686091284";

const PAIRS = [
  ["1568544429390700564", "1563110033372356754"],
  ["1568544433358774392", "1563119981808451694"],
  ["1568544463918469120", "1563110031870795860"],
  ["1568544467559129119", "1563118956426960979"],
  ["1568544400131494008", "1563119991644098664"],
  ["1568544413288898600", "1563119986908856460"],
  ["1568544410956865648", "1563119985407037490"],
];

module.exports = function registerReactionRoles(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reaction_role_panels (
      guild TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild, message)
    );

    CREATE TABLE IF NOT EXISTS reaction_role_pairs (
      guild TEXT NOT NULL,
      message TEXT NOT NULL,
      emoji TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (guild, message, emoji)
    );
  `);

  const getRole = db.prepare(`
    SELECT role FROM reaction_role_pairs
    WHERE guild = ? AND message = ? AND emoji = ?
  `);

  const queues = new Map();

  // Serialize changes for the same member and role.
  function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(task)
      .catch(error => console.error("REACTION ROLE QUEUE:", error));

    queues.set(key, next);

    void next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  }

  async function log(guild, title, details) {
    const text = [
      `**MILAN • REACTION ROLES — ${title}**`,
      ...details,
    ].join("\n").slice(0, 1900);

    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL);

      if (!channel?.isTextBased() || !channel.send) {
        console.warn(text);
        return;
      }

      await channel.send({
        content: text,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("REACTION ROLE LOG:", error.message, text);
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

  async function createPanel(message) {
    const guild = message.guild;
    const me = guild.members.me || await guild.members.fetchMe();
    const channelPerms = message.channel.permissionsFor(me);

    if (!message.member?.permissions.has(P.Administrator)) {
      await message.reply({
        content: "This command is for administrators only.",
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    const required = [
      P.ViewChannel,
      P.SendMessages,
      P.EmbedLinks,
      P.AddReactions,
      P.ReadMessageHistory,
    ];

    if (!channelPerms?.has(required) || !me.permissions.has(P.ManageRoles)) {
      throw new Error("Bot is missing channel permissions or Manage Roles.");
    }

    const rows = [];

    for (const [emojiId, roleId] of PAIRS) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      const emoji = await resolveEmoji(guild, emojiId);

      if (!role || role.managed || role.id === guild.id) {
        throw new Error(`Invalid or unavailable role: ${roleId}`);
      }

      if (role.position >= me.roles.highest.position) {
        throw new Error(`Role is above the bot: ${roleId}`);
      }

      if (!emoji) {
        throw new Error(`Emoji unavailable: ${emojiId}`);
      }

      rows.push({ emoji, role });
    }

    const embed = new EmbedBuilder()
      .setColor(0x203234)
      .setTitle("MILAN • REACTION ROLES")
      .setDescription([
        "Choose your roles below.",
        "Add a reaction to receive a role; remove it to remove the role.",
        "",
        ...rows.map(row => `${row.emoji}  •  <@&${row.role.id}>`),
      ].join("\n"))
      .setFooter({ text: "MILAN • ROLE SELECTION" });

    const panel = await message.channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    try {
      db.exec("BEGIN IMMEDIATE");

      db.prepare(`
        INSERT INTO reaction_role_panels
          (guild, channel, message, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        guild.id,
        message.channelId,
        panel.id,
        message.author.id,
        Date.now()
      );

      const insertPair = db.prepare(`
        INSERT INTO reaction_role_pairs (guild, message, emoji, role)
        VALUES (?, ?, ?, ?)
      `);

      for (const [emojiId, roleId] of PAIRS) {
        insertPair.run(guild.id, panel.id, emojiId, roleId);
      }

      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      await panel.delete().catch(() => {});
      throw error;
    }

    const failures = [];

    for (const [emojiId] of PAIRS) {
      try {
        await panel.react(emojiId);
      } catch (error) {
        failures.push(`${emojiId}: ${error.message}`);
      }
    }

    await log(guild, "PANEL CREATED", [
      `Channel: <#${message.channelId}>`,
      `Message ID: \`${panel.id}\``,
      `By: <@${message.author.id}>`,
      ...(failures.length ? ["Failed reactions:", ...failures] : []),
    ]);

    if (failures.length) {
      await message.reply({
        content: "Panel created, but some reactions failed. Check the log.",
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
  }

  async function handleReaction(reaction, user, added) {
    if (user.bot) return;

    try {
      if (reaction.partial) reaction = await reaction.fetch();

      const message = reaction.message;
      if (!message.guild || !reaction.emoji.id) return;

      const pair = getRole.get(
        message.guild.id,
        message.id,
        reaction.emoji.id
      );

      if (!pair) return;

      const guild = message.guild;
      const key = `${guild.id}:${user.id}:${pair.role}`;

      enqueue(key, async () => {
        try {
          const member = await guild.members.fetch(user.id);
          const role = await guild.roles.fetch(pair.role);
          const me = guild.members.me || await guild.members.fetchMe();

          if (
            !role ||
            role.managed ||
            !me.permissions.has(P.ManageRoles) ||
            role.position >= me.roles.highest.position
          ) {
            throw new Error(`Cannot manage role ${pair.role}`);
          }

          if (added) {
            if (member.roles.cache.has(role.id)) return;

            await member.roles.add(role, "MILAN reaction role");

            // Role granted without sending a role mention.
          } else {
            if (!member.roles.cache.has(role.id)) return;
            await member.roles.remove(role, "MILAN reaction role removed");
          }

          await log(guild, added ? "ROLE ADDED" : "ROLE REMOVED", [
            `Member: <@${user.id}>`,
            `Role: <@&${role.id}>`,
            `Panel: https://discord.com/channels/${guild.id}/${message.channelId}/${message.id}`,
          ]);
        } catch (error) {
          await log(guild, "ERROR", [
            `Member ID: \`${user.id}\``,
            `Role ID: \`${pair.role}\``,
            `Error: ${String(error.message).slice(0, 500)}`,
          ]);
        }
      });
    } catch (error) {
      console.error("REACTION ROLE EVENT:", error);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS reaction_role_first (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild, user)
    );
  `);

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (message.content.trim().toLowerCase() !== ".rc") return;

    try {
      await createPanel(message);
    } catch (error) {
      await log(message.guild, "PANEL ERROR", [
        `By: <@${message.author.id}>`,
        `Error: ${String(error.message).slice(0, 500)}`,
      ]);

      await message.reply({
        content: "Could not create the panel. Check the reaction-role log.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
    }
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void handleReaction(reaction, user, true);
  });

  client.on(Events.MessageReactionRemove, (reaction, user) => {
    void handleReaction(reaction, user, false);
  });
};