const {
  Events,
  PermissionsBitField,
} = require("discord.js");

const LOG_CHANNEL_ID = "1560996909366120510";
const CHECKPOINT_MS = 60_000;

// Avoid counting long periods when the event loop was paused or disconnected.
// A prolonged pause may cause some real voice time to be undercounted.
const MAX_INTERVAL_MS = 90_000;

module.exports = function registerVoiceActivity(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_activity (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      total_ms INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild, user)
    );
  `);

  const addTime = db.prepare(`
    INSERT INTO voice_activity (guild, user, total_ms, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild, user) DO UPDATE SET
      total_ms = voice_activity.total_ms + excluded.total_ms,
      updated_at = excluded.updated_at
  `);

  // Active sessions live only in memory.
  // This prevents counting time while the bot is offline.
  const sessions = new Map();
  let ready = false;

  function key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function eligible(state) {
    if (!state?.channelId || !state.guild) return false;
    if (state.channelId === state.guild.afkChannelId) return false;

    // Avoid counting bots or states without a known member.
    if (!state.member || state.member.user.bot) return false;

    return true;
  }

  async function logError(guild, context, error) {
    console.error(`VOICE ACTIVITY [${context}]:`, error);

    try {
      if (!guild) return;

      const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
      if (!channel?.isTextBased() || !channel.send) return;

      const me = guild.members.me || await guild.members.fetchMe();
      const perms = channel.permissionsFor(me);

      if (!perms?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
      ])) return;

      await channel.send({
        content:
          `**MILAN • VOICE ACTIVITY ERROR**\n` +
          `Context: ${context}\n` +
          `Error: ${String(error?.message || error).slice(0, 500)}`,
        allowedMentions: { parse: [] },
      });
    } catch (logError) {
      console.error("VOICE ACTIVITY LOG ERROR:", logError);
    }
  }

  function saveElapsed(session, now) {
    const elapsed = Math.max(
      0,
      Math.min(now - session.lastSavedAt, MAX_INTERVAL_MS)
    );

    if (elapsed > 0) {
      addTime.run(
        session.guildId,
        session.userId,
        elapsed,
        now
      );
    }

    session.lastSavedAt = now;
  }

  function begin(state, now) {
    const sessionKey = key(state.guild.id, state.id);

    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, {
        guildId: state.guild.id,
        userId: state.id,
        lastSavedAt: now,
      });
    }
  }

  function stop(state, now) {
    const sessionKey = key(state.guild.id, state.id);
    const session = sessions.get(sessionKey);

    if (!session) return;

    saveElapsed(session, now);
    sessions.delete(sessionKey);
  }

  function checkpoint() {
    const now = Date.now();

    for (const session of sessions.values()) {
      try {
        saveElapsed(session, now);
      } catch (error) {
        const guild = client.guilds.cache.get(session.guildId);
        void logError(guild, "CHECKPOINT", error);
      }
    }
  }

  client.once(Events.ClientReady, () => {
    // Start sessions only from the time the client becomes ready.
    const now = Date.now();

    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (eligible(state)) begin(state, now);
      }
    }

    ready = true;
    setInterval(checkpoint, CHECKPOINT_MS);

    console.log("VOICE ACTIVITY READY");
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!ready) return;

    try {
      const now = Date.now();
      const wasEligible = eligible(oldState);
      const isEligible = eligible(newState);

      if (wasEligible && !isEligible) {
        stop(oldState, now);
      } else if (!wasEligible && isEligible) {
        begin(newState, now);
      }

      // Moving between two eligible channels keeps the same session.
    } catch (error) {
      void logError(newState.guild || oldState.guild, "VOICE UPDATE", error);
    }
  });

  // If the bot disconnects from the gateway, stop counting until ready again.
  client.on(Events.ShardDisconnect, () => {
    checkpoint();
    sessions.clear();
    ready = false;
  });

  client.on(Events.ShardResume, () => {
    const now = Date.now();

    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (eligible(state)) begin(state, now);
      }
    }

    ready = true;
  });
};