const {
  Events,
  PermissionsBitField,
} = require("discord.js");

const CONFIG = {
  channelId: "1560996836808855593",

  // Can be overridden in .env.
  // Default: the existing messages log channel from your main.js.
  logChannelId:
    process.env.AUTO_REACTION_LOG_CHANNEL_ID || "1560996906686091284",

  // Delay between successful/failed reaction attempts.
  delayMs: 1200,

  // Pause before looking for the next queued message.
  idleDelayMs: 3000,

  // Maximum messages scanned by one admin backfill request.
  backfillLimit: 100,
};

const ITEMS = [
  ["gothdangleearrings", "1567439679006048319"],
  ["gothbelt", "1567439676535734272"],
  ["gothrose", "1567439674958544936"],
  ["gothkitten", "1567439672328593448"],
  ["gothbatwings", "1567439670923501678"],
  ["gothsnake", "1567439668448993280"],
  ["gothskullearrings", "1567439666578333697"],
  ["gothnoteheart", "1567439663160102953"],
  ["gothheadphones", "1567439661473730711"],
  ["gothcake", "1567439659632435200"],
  ["gothspikedcollar", "1567439656516063283"],
  ["gothcharmearrings", "1567439653630378035"],
  ["gothlamp", "1567439652191862865"],
  ["crybaby", "1567439649247596635"],
  ["gothmoth", "1567439647800295484"],
  ["gothoccultplush", "1567439645778780250"],
  ["gothshoes", "1567439641164906597"],
  ["gothlifebag", "1567439639663349790"],
  ["gothsun", "1567439635230101575"],
  ["gothplushcat", "1567439630561972294"],
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeError(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}

module.exports = function registerInventoryReactions(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_reaction_jobs (
      guild TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      PRIMARY KEY (guild, channel, message)
    );

    CREATE TABLE IF NOT EXISTS inventory_reaction_results (
      guild TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      emoji TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      updated INTEGER NOT NULL,
      PRIMARY KEY (guild, channel, message, emoji)
    );

    CREATE INDEX IF NOT EXISTS inventory_reaction_pending_idx
      ON inventory_reaction_jobs(status, created);
  `);

  const addJob = db.prepare(`
    INSERT OR IGNORE INTO inventory_reaction_jobs
      (guild, channel, message, status, created, updated)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `);

  const getPending = db.prepare(`
    SELECT guild, channel, message
    FROM inventory_reaction_jobs
    WHERE status = 'pending'
    ORDER BY created ASC, message ASC
    LIMIT 1
  `);

  const claimJob = db.prepare(`
    UPDATE inventory_reaction_jobs
    SET status = 'processing', updated = ?
    WHERE guild = ? AND channel = ? AND message = ?
      AND status = 'pending'
  `);

  const finishJob = db.prepare(`
    UPDATE inventory_reaction_jobs
    SET status = ?, updated = ?
    WHERE guild = ? AND channel = ? AND message = ?
  `);

  const getResult = db.prepare(`
    SELECT status
    FROM inventory_reaction_results
    WHERE guild = ? AND channel = ? AND message = ? AND emoji = ?
  `);

  const saveResult = db.prepare(`
    INSERT INTO inventory_reaction_results
      (guild, channel, message, emoji, status, error, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild, channel, message, emoji) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated = excluded.updated
  `);

  // Resume jobs interrupted by a process restart.
  db.prepare(`
    UPDATE inventory_reaction_jobs
    SET status = 'pending', updated = ?
    WHERE status = 'processing'
  `).run(Date.now());

  function queueMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) {
      return false;
    }

    if (message.channelId !== CONFIG.channelId) return false;

    const now = Date.now();

    const result = addJob.run(
      message.guild.id,
      message.channelId,
      message.id,
      now,
      now
    );

    return Number(result.changes) > 0;
  }

  async function logFailure(guild, title, lines) {
    const text = [
      `**MILAN • AUTO REACTIONS — ${title}**`,
      ...lines,
    ].join("\n").slice(0, 1900);

    try {
      const logChannel = await guild.channels
        .fetch(CONFIG.logChannelId)
        .catch(() => null);

      if (!logChannel?.isTextBased() || !logChannel.send) {
        console.error("AUTO REACTIONS LOG:", text);
        return;
      }

      await logChannel.send({
        content: text,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("AUTO REACTIONS LOG ERROR:", safeError(error), text);
    }
  }

  async function processJob(job) {
    const claimed = claimJob.run(
      Date.now(),
      job.guild,
      job.channel,
      job.message
    );

    if (Number(claimed.changes) === 0) return;

    const guild = await client.guilds.fetch(job.guild).catch(() => null);

    if (!guild) {
      finishJob.run("failed", Date.now(), job.guild, job.channel, job.message);
      console.error(`AUTO REACTIONS: guild unavailable [${job.guild}]`);
      return;
    }

    const channel = await guild.channels.fetch(job.channel).catch(() => null);

    if (!channel?.isTextBased() || !channel.messages) {
      finishJob.run("failed", Date.now(), job.guild, job.channel, job.message);

      await logFailure(guild, "CHANNEL UNAVAILABLE", [
        `Channel ID: \`${job.channel}\``,
        `Message ID: \`${job.message}\``,
      ]);
      return;
    }

    let message;

    try {
      message = await channel.messages.fetch(job.message);
    } catch (error) {
      finishJob.run("failed", Date.now(), job.guild, job.channel, job.message);

      await logFailure(guild, "MESSAGE FETCH FAILED", [
        `Message ID: \`${job.message}\``,
        `Error: ${safeError(error)}`,
      ]);
      return;
    }

    if (message.author?.bot || message.webhookId) {
      finishJob.run("done", Date.now(), job.guild, job.channel, job.message);
      return;
    }

    const me = guild.members.me || await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    const required = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.AddReactions,
    ];

    if (!permissions?.has(required)) {
      finishJob.run("failed", Date.now(), job.guild, job.channel, job.message);

      await logFailure(guild, "MISSING PERMISSIONS", [
        `Channel: <#${job.channel}>`,
        `Message ID: \`${job.message}\``,
        "Required: View Channel, Read Message History, Add Reactions.",
      ]);
      return;
    }

    const failures = [];

    for (const [name, emojiId] of ITEMS) {
      const previous = getResult.get(
        job.guild,
        job.channel,
        job.message,
        emojiId
      );

      if (previous?.status === "success") continue;

      // Existing bot reaction means no second API call is necessary.
      const existing = message.reactions.cache.get(emojiId);

      if (existing?.me) {
        saveResult.run(
          job.guild,
          job.channel,
          job.message,
          emojiId,
          "success",
          null,
          Date.now()
        );
        continue;
      }

      try {
        await message.react(emojiId);

        saveResult.run(
          job.guild,
          job.channel,
          job.message,
          emojiId,
          "success",
          null,
          Date.now()
        );
      } catch (error) {
        const reason = safeError(error);

        saveResult.run(
          job.guild,
          job.channel,
          job.message,
          emojiId,
          "failed",
          reason,
          Date.now()
        );

        failures.push(`${name} (\`${emojiId}\`): ${reason}`);
      }

      await delay(CONFIG.delayMs);
    }

    finishJob.run(
      failures.length ? "failed" : "done",
      Date.now(),
      job.guild,
      job.channel,
      job.message
    );

    if (failures.length) {
      await logFailure(guild, "REACTIONS FAILED", [
        `Message: https://discord.com/channels/${job.guild}/${job.channel}/${job.message}`,
        ...failures,
        "Check emoji availability, permissions and the 20-reaction limit.",
      ]);
    }
  }

  let workerRunning = false;
  let stopped = false;

  async function worker() {
    if (workerRunning) return;
    workerRunning = true;

    try {
      while (!stopped) {
        const job = getPending.get();

        if (!job) {
          await delay(CONFIG.idleDelayMs);
          continue;
        }

        try {
          await processJob(job);
        } catch (error) {
          console.error("AUTO REACTIONS WORKER ERROR:", error);

          // Do not leave an unexpected failure permanently in processing.
          finishJob.run(
            "failed",
            Date.now(),
            job.guild,
            job.channel,
            job.message
          );

          const guild = client.guilds.cache.get(job.guild);

          if (guild) {
            await logFailure(guild, "WORKER ERROR", [
              `Message ID: \`${job.message}\``,
              `Error: ${safeError(error)}`,
            ]);
          }
        }
      }
    } finally {
      workerRunning = false;
    }
  }

  client.once(Events.ClientReady, () => {
    worker().catch(error => {
      console.error("AUTO REACTIONS WORKER STOPPED:", error);
    });
  });

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    // Queue new messages in the configured channel.
    if (message.channelId === CONFIG.channelId) {
      try {
        queueMessage(message);
      } catch (error) {
        console.error("AUTO REACTIONS QUEUE ERROR:", error);

        await logFailure(message.guild, "QUEUE ERROR", [
          `Message ID: \`${message.id}\``,
          `Error: ${safeError(error)}`,
        ]);
      }
    }

    // Admin-only manual scan of the latest 100 messages.
    if (message.content.trim().toLowerCase() !== ".reactbackfill") return;

    if (!message.member?.permissions.has(
      PermissionsBitField.Flags.Administrator
    )) {
      await message.reply({
        content: "الأمر للإداريين فقط.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
      return;
    }

    try {
      const channel = await message.guild.channels.fetch(CONFIG.channelId);

      if (!channel?.isTextBased() || !channel.messages) {
        throw new Error("Configured reaction channel is unavailable.");
      }

      const messages = await channel.messages.fetch({
        limit: CONFIG.backfillLimit,
      });

      let added = 0;

      // Oldest first, so queued work is processed chronologically.
      const ordered = [...messages.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      for (const oldMessage of ordered) {
        if (queueMessage(oldMessage)) added++;
      }

      await message.reply({
        content:
          `تم فحص ${messages.size} رسالة وإضافة ${added} رسالة جديدة للطابور. ` +
          "الرسائل المعالجة أو المسجلة سابقاً لم تُضف مرة أخرى.",
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      console.error("AUTO REACTIONS BACKFILL ERROR:", error);

      await logFailure(message.guild, "BACKFILL ERROR", [
        `By: \`${message.author.id}\``,
        `Error: ${safeError(error)}`,
      ]);

      await message.reply({
        content: "فشل فحص الرسائل القديمة. راجع روم اللوق والكونسل.",
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(console.error);
    }
  });
};