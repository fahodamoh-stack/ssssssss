const fs = require("node:fs/promises");
const path = require("node:path");

const {
  createCanvas,
  loadImage,
  GlobalFonts,
} = require("@napi-rs/canvas");

const {
  GIFEncoder,
  quantize,
  applyPalette,
} = require("gifenc");

const {
  AttachmentBuilder,
  Events,
  PermissionsBitField,
} = require("discord.js");

const config = require("./welcomeGifConfig");

// ============================================================
// FONTS
// ============================================================

let fontFamily = config.fontFamily || "Arial";

function registerWelcomeFont() {
  // Respect an explicitly configured font first.
  const candidates = [
    config.fontPath,
    "./Floane-Bold.otf",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const fontPath = path.resolve(__dirname, candidate);

      if (
        GlobalFonts.registerFromPath(
          fontPath,
          "MilanWelcome"
        )
      ) {
        fontFamily = "MilanWelcome";
        console.log(`WELCOME GIF FONT: ${candidate}`);
        return;
      }
    } catch (error) {
      console.warn(
        `WELCOME GIF FONT [${candidate}]:`,
        error.message
      );
    }
  }

  console.warn(
    `WELCOME GIF: custom font unavailable, using ${fontFamily}`
  );
}

registerWelcomeFont();

// ============================================================
// IMAGE HELPERS
// ============================================================

async function loadBackground() {
  if (!config.backgroundImage) {
    throw new Error(
      "WELCOME GIF: backgroundImage is not configured."
    );
  }

  const imagePath = path.resolve(
    __dirname,
    config.backgroundImage
  );

  let bytes;

  try {
    bytes = await fs.readFile(imagePath);
  } catch (error) {
    throw new Error(
      `Background image could not be read: ${imagePath} (${error.message})`
    );
  }

  return loadImage(bytes);
}

async function loadAvatar(member) {
  const url = member.displayAvatarURL({
    extension: "png",
    size: 256,
    forceStatic: true,
  });

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `Avatar download failed: ${response.status}`
    );
  }

  return loadImage(
    Buffer.from(await response.arrayBuffer())
  );
}

function fitText(ctx, value, maxWidth) {
  const chars = Array.from(String(value));

  if (ctx.measureText(chars.join("")).width <= maxWidth) {
    return chars.join("");
  }

  while (
    chars.length &&
    ctx.measureText(chars.join("") + "...").width > maxWidth
  ) {
    chars.pop();
  }

  return chars.join("") + "...";
}

function drawCircleImage(ctx, image, x, y, radius) {
  const side = Math.min(image.width, image.height);
  const sourceX = (image.width - side) / 2;
  const sourceY = (image.height - side) / 2;

  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    side,
    side,
    x - radius,
    y - radius,
    radius * 2,
    radius * 2
  );

  ctx.restore();
}

function setDisplayFont(ctx, size, bold = false) {
  // The configured display font is used first.
  // System fonts are included for unsupported characters.
  const style = bold ? "bold " : "";

  ctx.font =
    `${style}${Math.max(10, Math.round(size))}px ` +
    `"${fontFamily}", Arial, sans-serif`;
}

// ============================================================
// GIF DESIGN
// ============================================================

function drawFrame(
  ctx,
  background,
  avatar,
  username,
  width,
  height,
  phase
) {
  const colors = config.colors;
  const unit = Math.min(width, height);

  // Draw the complete background without cropping.
  ctx.drawImage(background, 0, 0, width, height);

  const darkness = Math.max(
    0,
    Math.min(
      1,
      Number(config.backgroundDarkness) || 0
    )
  );

  ctx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
  ctx.fillRect(0, 0, width, height);

  // Darken the left side for text readability while keeping
  // the character on the right visible.
  const shade = ctx.createLinearGradient(
    0,
    0,
    width * 0.62,
    0
  );

  shade.addColorStop(0, "rgba(0, 0, 0, 0.48)");
  shade.addColorStop(0.75, "rgba(0, 0, 0, 0.28)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width * 0.62, height);

  // Smooth periodic bounce. The username follows the avatar.
  const avatarX = width * 0.135;
  const avatarY =
    height * 0.43 +
    Math.sin(phase) * unit * 0.018;

  const avatarRadius = unit * 0.13;

  // Subtle animated border glow.
  ctx.save();

  ctx.shadowColor = colors.crimson;
  ctx.shadowBlur =
    unit * (0.035 + 0.008 * (1 + Math.sin(phase)) / 2);

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, unit * 0.007);

  ctx.beginPath();
  ctx.arc(
    avatarX,
    avatarY,
    avatarRadius + unit * 0.006,
    0,
    Math.PI * 2
  );
  ctx.stroke();

  ctx.restore();

  drawCircleImage(
    ctx,
    avatar,
    avatarX,
    avatarY,
    avatarRadius
  );

  // Actual Discord username below the avatar.
  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  setDisplayFont(ctx, unit * 0.047, true);

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  ctx.fillText(
    fitText(ctx, username, width * 0.23),
    avatarX,
    avatarY + avatarRadius + unit * 0.06
  );

  ctx.restore();

  // A small lower panel, kept left of the character.
  const panelX = width * 0.055;
  const panelY = height * 0.75;
  const panelW = width * 0.49;
  const panelH = height * 0.16;
  const bounce = Math.sin(phase + 0.35) * unit * 0.012;

  ctx.save();
  ctx.translate(0, bounce);

  ctx.fillStyle = "rgba(8, 7, 9, 0.72)";
  ctx.strokeStyle = "rgba(178, 36, 50, 0.65)";
  ctx.lineWidth = Math.max(1, unit * 0.004);

  ctx.beginPath();
  ctx.roundRect(
    panelX,
    panelY,
    panelW,
    panelH,
    Math.max(5, unit * 0.025)
  );
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#ffffff";
  setDisplayFont(ctx, unit * 0.075, true);

  ctx.fillText(
    fitText(ctx, "Welcome to milan", panelW - 20),
    panelX + panelW / 2,
    panelY + panelH / 2
  );

  ctx.restore();
}

// ============================================================
// GIF GENERATION
// ============================================================

async function createWelcomeGif(member) {
  const [background, avatar] = await Promise.all([
    loadBackground(),
    loadAvatar(member),
  ]);

  const width = Math.max(
    320,
    Math.min(1000, Number(config.width) || 720)
  );

  const height = Math.max(
    1,
    Math.round(
      width * background.height / background.width
    )
  );

  if (height < 180 || height > 1200) {
    throw new Error(
      `Unsupported background dimensions: ${width}x${height}`
    );
  }

  const frames = Math.max(
    2,
    Math.min(60, Number(config.frames) || 24)
  );

  const delay = Math.max(
    20,
    Number(config.frameDelay) || 60
  );

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const gif = GIFEncoder();

  const username = member.user.username;

  for (let frame = 0; frame < frames; frame++) {
    const phase = (frame / frames) * Math.PI * 2;

    drawFrame(
      ctx,
      background,
      avatar,
      username,
      width,
      height,
      phase
    );

    const rgba = ctx.getImageData(
      0,
      0,
      width,
      height
    ).data;

    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);

    gif.writeFrame(
      indexed,
      width,
      height,
      {
        palette,
        delay,
        repeat: 0,
      }
    );

    // Allow other bot events to run between frames.
    await new Promise(resolve => setImmediate(resolve));
  }

  gif.finish();

  return Buffer.from(gif.bytes());
}

// ============================================================
// DISCORD MESSAGE
// ============================================================

function welcomePayload(member, gifBuffer, filename) {
  return {
    content: [
      `Welcome to Milan <@${member.id}>`,
      `Please read rules <#${config.rulesChannelId}>`,
      `Chat with ppl <#${config.chatChannelId}>`,
    ].join("\n"),

    files: [
      new AttachmentBuilder(gifBuffer, {
        name: filename,
      }),
    ],

    allowedMentions: {
      parse: [],
      users: [member.id],
    },
  };
}

// ============================================================
// EVENTS AND TEST COMMAND
// ============================================================

module.exports = function registerWelcomeGif(client) {
  const testCooldown = new Map();

  // Admin-only test command. Sends the test in the current channel.
  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot) return;

    if (
      message.content.trim().toLowerCase() !== ".wlctest"
    ) {
      return;
    }

    if (
      !message.member?.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      await message.reply({
        content: "الامر للإداريين فقط.",
        allowedMentions: {
          repliedUser: false,
        },
      }).catch(console.error);

      return;
    }

    const now = Date.now();
    const previous =
      testCooldown.get(message.guild.id) || 0;

    if (now - previous < 30000) {
      await message.reply({
        content: "استنى شوية قبل ما تجرب تاني.",
        allowedMentions: {
          repliedUser: false,
        },
      }).catch(console.error);

      return;
    }

    testCooldown.set(message.guild.id, now);
    // WLC TEST DM
    // Run separately so a DM error does not stop the GIF test.
    Promise.resolve()
      .then(() => require("./welcomeDm")(message.member))
      .catch(error => {
        console.error("WELCOME DM TEST ERROR:", error);
      });

    try {
      const gifBuffer = await createWelcomeGif(
        message.member
      );

      await message.channel.send(
        welcomePayload(
          message.member,
          gifBuffer,
          `welcome-test-${message.author.id}.gif`
        )
      );
    } catch (error) {
      console.error("WELCOME GIF TEST ERROR:", error);

      await message.reply({
        content:
          "حصل خطأ أثناء إنشاء الـGIF. راجع الكونسل.",
        allowedMentions: {
          repliedUser: false,
        },
      }).catch(console.error);
    }
  });
};

// Used by the existing welcome listener in main.js.
module.exports.createPayload = async function createPayload(member, filename) {
  const gifBuffer = await createWelcomeGif(member);
  return welcomePayload(member, gifBuffer, filename);
};
