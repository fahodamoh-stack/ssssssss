const { Events } = require("discord.js");

const OWNER_ID = "1561045275643215992";

function normalize(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u0640/g, "")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function emojiId(value) {
  const input = String(value).trim();

  if (/^\d{17,20}$/.test(input)) return input;

  const match = input.match(/^<a?:[^:]+:(\d{17,20})>$/);
  return match ? match[1] : null;
}

module.exports = function registerEmoSystem(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emo_reactions (
      guild TEXT NOT NULL,
      word TEXT NOT NULL,
      display_word TEXT NOT NULL,
      emoji_id TEXT NOT NULL,
      PRIMARY KEY (guild, word)
    )
  `);

  const command = {
    name: "emo",
    description: "إدارة رياكت الكلمات",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "add",
        description: "إضافة أو تحديث كلمة وإيموجي",
        options: [
          {
            type: 3,
            name: "word",
            description: "الكلمة",
            required: true,
            max_length: 100,
          },
          {
            type: 3,
            name: "emoji",
            description: "ID الإيموجي أو الإيموجي المخصص",
            required: true,
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "remove",
        description: "حذف كلمة",
        options: [
          {
            type: 3,
            name: "word",
            description: "الكلمة المطلوب حذفها",
            required: true,
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "list",
        description: "عرض الكلمات",
      },
    ],
  };

  async function registerCommand(guild) {
    try {
      await guild.commands.create(command);
      console.log(`EMO COMMAND READY [${guild.id}]`);
    } catch (error) {
      console.error(`EMO REGISTER [${guild.id}]:`, error);
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

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "emo" || !interaction.guildId) return;

    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: "الأمر مخصص لشخص محدد فقط.",
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const action = interaction.options.getSubcommand();

      if (action === "add") {
        const displayWord = interaction.options.getString("word", true).trim();
        const word = normalize(displayWord);
        const id = emojiId(interaction.options.getString("emoji", true));

        if (!word) {
          await interaction.editReply("اكتب كلمة فيها حروف أو أرقام.");
          return;
        }

        if (!id) {
          await interaction.editReply("اكتب ID إيموجي مخصص صحيح أو الإيموجي نفسه.");
          return;
        }

        const emoji = client.emojis.cache.get(id)
          || await client.emojis.fetch(id).catch(() => null);

        if (!emoji) {
          await interaction.editReply(
            "مش لاقي الإيموجي. تأكد من الـID وإن البوت يقدر يشوفه."
          );
          return;
        }

        db.prepare(`
          INSERT INTO emo_reactions (guild, word, display_word, emoji_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(guild, word) DO UPDATE SET
            display_word = excluded.display_word,
            emoji_id = excluded.emoji_id
        `).run(interaction.guildId, word, displayWord, id);

        await interaction.editReply({
          content: `تم حفظ الكلمة والإيموجي ${emoji} (\`${id}\`).`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (action === "remove") {
        const word = normalize(interaction.options.getString("word", true));

        if (!word) {
          await interaction.editReply("اكتب كلمة صحيحة.");
          return;
        }

        const result = db.prepare(`
          DELETE FROM emo_reactions WHERE guild = ? AND word = ?
        `).run(interaction.guildId, word);

        await interaction.editReply(
          Number(result.changes) > 0
            ? "تم حذف الكلمة."
            : "الكلمة دي مش محفوظة."
        );
        return;
      }

      if (action === "list") {
        const rows = db.prepare(`
          SELECT display_word, emoji_id
          FROM emo_reactions
          WHERE guild = ?
          ORDER BY display_word
          LIMIT 50
        `).all(interaction.guildId);

        const lines = rows.map((row, index) => {
          const safeWord = row.display_word.replace(/[`@\r\n]/g, " ");
          return `${index + 1}. \`${safeWord}\` — \`${row.emoji_id}\``;
        });

        await interaction.editReply({
          content: rows.length
            ? `الكلمات المحفوظة، أول 50:\n${lines.join("\n")}`.slice(0, 1900)
            : "مفيش كلمات محفوظة.",
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      console.error("EMO COMMAND ERROR:", error);

      const response = {
        content: "حصل خطأ في أمر emo. راجع الكونسل.",
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(response).catch(console.error);
      } else {
        await interaction.reply({
          ...response,
          ephemeral: true,
        }).catch(console.error);
      }
    }
  });

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || !message.content) return;

    const content = normalize(message.content);
    if (!content) return;

    try {
      const rows = db.prepare(`
        SELECT word, emoji_id FROM emo_reactions WHERE guild = ?
      `).all(message.guild.id);

      const ids = new Set();

      for (const row of rows) {
        if (row.word && content.includes(row.word)) {
          ids.add(row.emoji_id);
        }
      }

      for (const id of ids) {
        await message.react(id).catch(error => {
          console.warn(`EMO REACTION [${id}]:`, error.message);
        });
      }
    } catch (error) {
      console.error("EMO MESSAGE ERROR:", error);
    }
  });
};