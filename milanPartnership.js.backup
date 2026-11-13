"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  Events,
  MessageFlags,
  AttachmentBuilder
} = require("discord.js");

const {
  createCanvas,
  loadImage,
  GlobalFonts
} = require("@napi-rs/canvas");

const {
  GIFEncoder,
  quantize,
  applyPalette
} = require("gifenc");

const configPath = path.join(__dirname, "partnership.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function assetPath(value) {
  return path.isAbsolute(value) ? value : path.join(__dirname, value);
}

const backgroundPath = assetPath(config.backgroundPath);

if (!fs.existsSync(backgroundPath)) {
  throw new Error(`Partnership background not found: ${backgroundPath}`);
}

let fontFamily = "sans-serif";

for (let i = 0; i < (config.fontPaths || []).length; i++) {
  const fontPath = assetPath(config.fontPaths[i]);
  if (!fs.existsSync(fontPath)) continue;

  const name = `MilanPartnerFont${i}`;

  try {
    if (GlobalFonts.registerFromPath(fontPath, name) && fontFamily === "sans-serif") {
      fontFamily = name;
    }
  } catch (error) {
    console.warn("PARTNERSHIP FONT:", error.message);
  }
}

const CHANNEL_ID = String(config.channelId || "");
const LOG_CHANNEL_ID = String(config.logChannelId || "");
const MAX_DESCRIPTION = Math.max(
  1,
  Math.min(1500, Number(config.maxDescriptionLength) || 1500)
);
const MAX_GIF_BYTES = Math.max(
  100_000,
  Math.min(24_000_000, Number(config.maxGifBytes) || 8_000_000)
);

if (!/^\d{17,20}$/.test(CHANNEL_ID) ||
    !/^\d{17,20}$/.test(LOG_CHANNEL_ID)) {
  throw new Error("Invalid partnership channel ID in config.");
}

function safeName(value) {
  return String(value || "Server")
    .replace(/[\r\n`*_~|<>@\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "Server";
}

function safeLogText(value) {
  return String(value || "")
    .replace(/[\r\n`<>@]/g, " ")
    .slice(0, 350);
}

// Accept only actual Discord invite domains and a single path code.
// Boundaries prevent domains such as discord.gg.example.com.
const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([A-Za-z0-9_-]{2,64})(?![A-Za-z0-9_.\/-])/gi;

function extractInvites(text) {
  const found = [];
  INVITE_REGEX.lastIndex = 0;

  for (const match of text.matchAll(INVITE_REGEX)) {
    const before = match.index > 0 ? text[match.index - 1] : "";

    // Do not treat a substring of another hostname or email as an invite.
    if (before && /[A-Za-z0-9_.@/-]/.test(before)) continue;

    found.push({
      code: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return found;
}

function removeInvite(text, invite) {
  return (
    text.slice(0, invite.start) +
    text.slice(invite.end)
  ).trim();
}

function cover(ctx, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

function circleImage(ctx, image, x, y, radius, alpha, glow) {
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.shadowColor = `rgba(180, 145, 255, ${glow})`;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = "#d9c6ff";
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  const size = Math.min(image.width, image.height);
  const sx = (image.width - size) / 2;
  const sy = (image.height - size) / 2;

  ctx.drawImage(
    image,
    sx, sy, size, size,
    x - radius, y - radius, radius * 2, radius * 2
  );

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ede4ff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

async function renderGif(localIconUrl, partnerIconUrl, localName, partnerName) {
  // Both URLs are produced by Discord.js from Discord guild objects.
  const [background, localIcon, partnerIcon] = await Promise.all([
    loadImage(backgroundPath),
    loadImage(localIconUrl),
    loadImage(partnerIconUrl)
  ]);

  const width = 800;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const gif = GIFEncoder();

  const frames = 32;

  for (let frame = 0; frame < frames; frame++) {
    const fade = Math.min(1, (frame + 1) / 10);
    const pulse = 0.25 + 0.2 * (1 + Math.sin(frame * Math.PI * 2 / frames));

    ctx.clearRect(0, 0, width, height);
    cover(ctx, background, width, height);

    // Dark overlay keeps text and icons readable over any background.
    ctx.fillStyle = "rgba(6, 8, 16, 0.48)";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(125, 84, 180, 0.18)");
    gradient.addColorStop(0.5, "rgba(8, 10, 18, 0.08)");
    gradient.addColorStop(1, "rgba(95, 130, 180, 0.18)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    circleImage(ctx, localIcon, 190, 210, 85, fade, pulse);
    circleImage(ctx, partnerIcon, 610, 210, 85, fade, pulse);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(185, 150, 255, 0.8)";
    ctx.shadowBlur = 12 + pulse * 15;
    ctx.font = `bold 34px "${fontFamily}", sans-serif`;
    ctx.fillText("PARTNER WITH", 400, 210, 230);

    ctx.shadowBlur = 0;
    ctx.font = `bold 23px "${fontFamily}", sans-serif`;
    ctx.fillText(localName, 190, 330, 260);
    ctx.fillText(partnerName, 610, 330, 260);

    ctx.strokeStyle = "rgba(235, 222, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(330, 248);
    ctx.lineTo(470, 248);
    ctx.stroke();
    ctx.restore();

    const rgba = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);

    gif.writeFrame(applyPalette(rgba, palette), width, height, {
      palette,
      delay: 90,
      repeat: 0
    });

    // Yield so other bot events can continue between frames.
    await new Promise(resolve => setImmediate(resolve));
  }

  gif.finish();
  const result = Buffer.from(gif.bytes());

  if (result.length > MAX_GIF_BYTES) {
    throw new Error(
      `Generated GIF is too large (${result.length} bytes; limit ${MAX_GIF_BYTES}).`
    );
  }

  return result;
}

function logPanel(title, text) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: 17,
      accent_color: 0x203234,
      components: [
        { type: 10, content: `### MILAN • PARTNERSHIP ${title}` },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: text }
      ]
    }],
    allowedMentions: { parse: [], repliedUser: false }
  };
}

module.exports = function registerPartnership(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS milan_partnership_jobs (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      status TEXT NOT NULL,
      partner_guild_id TEXT,
      partner_name TEXT,
      announcement_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS milan_partnership_status
      ON milan_partnership_jobs(status, created_at);
  `);

  const claim = db.prepare(`
    INSERT OR IGNORE INTO milan_partnership_jobs
      (message_id, guild_id, channel_id, author_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'processing', ?, ?)
  `);

  const setPartner = db.prepare(`
    UPDATE milan_partnership_jobs
    SET partner_guild_id = ?, partner_name = ?, updated_at = ?
    WHERE message_id = ? AND status = 'processing'
  `);

  const setPosted = db.prepare(`
    UPDATE milan_partnership_jobs
    SET status = 'posted', announcement_id = ?, updated_at = ?
    WHERE message_id = ? AND status = 'processing'
  `);

  const setDone = db.prepare(`
    UPDATE milan_partnership_jobs
    SET status = 'done', updated_at = ?
    WHERE message_id = ? AND status = 'posted'
  `);

  const setFailed = db.prepare(`
    UPDATE milan_partnership_jobs
    SET status = 'failed', error = ?, updated_at = ?
    WHERE message_id = ? AND status = 'processing'
  `);

  const setDeleteError = db.prepare(`
    UPDATE milan_partnership_jobs
    SET error = ?, updated_at = ?
    WHERE message_id = ? AND status = 'posted'
  `);

  async function log(guild, title, text) {
    try {
      const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
      if (!channel?.isTextBased() || typeof channel.send !== "function") {
        console.error("PARTNERSHIP LOG: channel unavailable.");
        return;
      }

      await channel.send(logPanel(title, text));
    } catch (error) {
      console.error("PARTNERSHIP LOG ERROR:", error);
    }
  }

  async function notifyFailure(message, reason) {
    await log(
      message.guild,
      "FAILED",
      `Source: \`${message.id}\`\n` +
      `Member: <@${message.author.id}>\n` +
      `Channel: <#${message.channel.id}>\n` +
      `Reason: ${safeLogText(reason)}\n` +
      "The original message was not deleted."
    );

    await message.reply({
      ...logPanel(
        "ERROR",
        "Could not create the partnership announcement. " +
        "Your original message was not deleted; staff have been notified."
      ),
      failIfNotExists: false
    }).catch(error => console.error("PARTNERSHIP ERROR REPLY:", error));
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (message.channel.id !== CHANNEL_ID) return;

    const content = message.content || "";
    const invites = extractInvites(content);

    // Ordinary messages do not trigger this system.
    if (invites.length === 0) return;

    const now = Date.now();

    let claimed;
    try {
      claimed = claim.run(
        message.id,
        message.guild.id,
        message.channel.id,
        message.author.id,
        now,
        now
      );
    } catch (error) {
      console.error("PARTNERSHIP CLAIM ERROR:", error);
      return;
    }

    // A message already claimed is never automatically processed twice.
    if (Number(claimed.changes) !== 1) return;

    let posted = false;

    try {
      if (invites.length !== 1) {
        throw new Error("Send exactly one Discord invite per message.");
      }

      const description = content.trim();

      if (description.length > MAX_DESCRIPTION) {
        throw new Error(
          `Description is too long. Maximum is ${MAX_DESCRIPTION} characters.`
        );
      }

      let invite;
      try {
        invite = await client.fetchInvite(invites[0].code, {
          withCounts: true
        });
      } catch {
        throw new Error("Invite is invalid, expired, or unavailable.");
      }

      if (!invite.guild?.id || !invite.guild?.name) {
        throw new Error("Invite does not provide server details.");
      }

      const localIconUrl = message.guild.iconURL({
        extension: "png",
        size: 256,
        forceStatic: true
      });

      const partnerIconUrl = invite.guild.iconURL({
        extension: "png",
        size: 256,
        forceStatic: true
      });

      if (!localIconUrl) {
        throw new Error("MILAN server does not have an accessible icon.");
      }

      if (!partnerIconUrl) {
        throw new Error("Partner server does not have an accessible icon.");
      }

      const localName = safeName(message.guild.name);
      const partnerName = safeName(invite.guild.name);

      setPartner.run(
        invite.guild.id,
        partnerName,
        Date.now(),
        message.id
      );

      const gif = await renderGif(
        localIconUrl,
        partnerIconUrl,
        localName,
        partnerName
      );

      const components = [
        {
          type: 10,
          content: `### ${localName} • PARTNER WITH • ${partnerName}`
        },
        {
          type: 12,
          items: [{
            media: { url: "attachment://partnership.gif" },
            description: `${localName} partnership with ${partnerName}`
          }]
        }
      ];

      if (description) {
        components.push(
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: description }
        );
      }

      const announcement = await message.channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [{
          type: 17,
          accent_color: 0x203234,
          components
        }],
        files: [
          new AttachmentBuilder(gif, { name: "partnership.gif" })
        ],
        allowedMentions: { parse: [], repliedUser: false }
      });

      posted = true;

      // Save the announcement ID before attempting to delete the source.
      const changed = setPosted.run(announcement.id, Date.now(), message.id);

      if (Number(changed.changes) !== 1) {
        throw new Error("Announcement sent but database status could not be saved.");
      }

      try {
        await message.delete();
        setDone.run(Date.now(), message.id);
      } catch (error) {
        setDeleteError.run(
          safeLogText(error.message),
          Date.now(),
          message.id
        );

        await log(
          message.guild,
          "DELETE WARNING",
          `Announcement: \`${announcement.id}\`\n` +
          `Original: \`${message.id}\`\n` +
          `Member: <@${message.author.id}>\n` +
          `Could not delete original: ${safeLogText(error.message)}`
        );
      }

      await log(
        message.guild,
        "SUCCESS",
        `Member: <@${message.author.id}>\n` +
        `Partner: **${partnerName}** (\`${invite.guild.id}\`)\n` +
        `Original: \`${message.id}\`\n` +
        `Announcement: \`${announcement.id}\``
      );
    } catch (error) {
      console.error("PARTNERSHIP ERROR:", error);

      if (!posted) {
        try {
          setFailed.run(safeLogText(error.message), Date.now(), message.id);
        } catch (dbError) {
          console.error("PARTNERSHIP DATABASE ERROR:", dbError);
        }

        await notifyFailure(message, error.message);
      } else {
        // Do not resend or delete the original if bookkeeping failed.
        await log(
          message.guild,
          "REVIEW REQUIRED",
          `An announcement was sent for source \`${message.id}\`, ` +
          `but final bookkeeping failed: ${safeLogText(error.message)}.\n` +
          "Check the channel and database before taking action."
        );
      }
    }
  });

  console.log("MILAN PARTNERSHIP SYSTEM LOADED");
};