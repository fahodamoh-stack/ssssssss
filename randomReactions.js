const { Events, PermissionsBitField } = require("discord.js");
const { randomInt } = require("node:crypto");

const CHANNEL_ID = "1560996836808855593";
const LOG_CHANNEL_ID =
  process.env.AUTO_REACTION_LOG_CHANNEL_ID || "1560996906686091284";

const EMOJIS = [
  "1567439679006048319",
  "1567439676535734272",
  "1567439674958544936",
  "1567439672328593448",
  "1567439670923501678",
  "1567439668448993280",
  "1567439666578333697",
  "1567439663160102953",
  "1567439661473730711",
  "1567439659632435200",
  "1567439656516063283",
  "1567439653630378035",
  "1567439652191862865",
  "1567439649247596635",
  "1567439647800295484",
  "1567439645778780250",
  "1567439641164906597",
  "1567439639663349790",
  "1567439635230101575",
  "1567439630561972294",
];

module.exports = function registerRandomReactions(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS random_reaction_history (
      guild TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild, channel, message)
    )
  `);

  const seen = db.prepare(`
    SELECT 1 FROM random_reaction_history
    WHERE guild = ? AND channel = ? AND message = ?
  `);

  const save = db.prepare(`
    INSERT OR IGNORE INTO random_reaction_history
      (guild, channel, message, emoji, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  async function logFailure(guild, error) {
    const detail = String(error?.message || error)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 700);

    console.error("RANDOM REACTION:", detail);

    if (!guild) return;

    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL_ID);

      if (!channel?.isTextBased() || !channel.send) return;

      await channel.send({
        content: `**MILAN • RANDOM REACTION ERROR**\n${detail}`,
        allowedMentions: { parse: [] },
      });
    } catch (logError) {
      console.error("RANDOM REACTION LOG:", logError.message);
    }
  }

  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;

    let guild = null;

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);

      if (!channel?.guild || !channel.messages) {
        throw new Error("Configured reaction channel is unavailable.");
      }

      guild = channel.guild;

      const me = guild.members.me || await guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);

      if (!permissions?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AddReactions,
      ])) {
        throw new Error("Missing View Channel, Read Message History, or Add Reactions.");
      }

      const messages = await channel.messages.fetch({ limit: 100 });

      const candidates = messages.filter(message =>
        !message.author?.bot &&
        !message.webhookId &&
        !seen.get(guild.id, channel.id, message.id)
      );

      if (!candidates.size) return;

      const list = [...candidates.values()];
      const message = list[randomInt(list.length)];
      const emoji = EMOJIS[randomInt(EMOJIS.length)];

      // One API attempt per tick. Discord.js handles REST rate limits.
      await message.react(emoji);

      save.run(guild.id, channel.id, message.id, emoji, Date.now());
    } catch (error) {
      await logFailure(guild, error);
    } finally {
      busy = false;
    }
  }

  client.once(Events.ClientReady, () => {
    console.log("RANDOM REACTIONS READY");
    setInterval(() => void tick(), 60_000);
  });
};