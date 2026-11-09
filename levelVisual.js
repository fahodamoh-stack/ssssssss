const fs = require("node:fs/promises");
const path = require("node:path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const ROOT = __dirname;
const BACKGROUND = path.join(ROOT, "level-background.png");
const WIDTH = 900;
const HEIGHT = 500;

let displayFont = "sans-serif";
let arabicFont = "sans-serif";

try {
  if (GlobalFonts.registerFromPath(
    path.join(ROOT, "Floane-Bold.otf"),
    "MilanLevel"
  )) displayFont = "MilanLevel";
  else console.warn("LEVEL: Floane-Bold.otf unavailable.");
} catch (error) {
  console.warn("LEVEL FONT:", error.message);
}

try {
  if (GlobalFonts.registerFromPath(
    path.join(ROOT, "KOMission-Black.otf"),
    "MilanLevelArabic"
  )) arabicFont = "MilanLevelArabic";
  else console.warn("LEVEL: KOMission-Black.otf unavailable.");
} catch (error) {
  console.warn("LEVEL ARABIC FONT:", error.message);
}

function font(size) {
  return `bold ${size}px "${displayFont}", "${arabicFont}", sans-serif`;
}

async function loadAssets(user) {
  const backgroundBytes = await fs.readFile(BACKGROUND);

  const response = await fetch(
    user.displayAvatarURL({
      extension: "png",
      size: 256,
      forceStatic: true,
    }),
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    throw new Error(`Avatar download failed: ${response.status}`);
  }

  return {
    background: await loadImage(backgroundBytes),
    avatar: await loadImage(Buffer.from(await response.arrayBuffer())),
  };
}

function cover(ctx, image) {
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

function base(ctx, background) {
  cover(ctx, background);

  const shade = ctx.createLinearGradient(0, 0, WIDTH, 0);
  shade.addColorStop(0, "rgba(4, 8, 10, 0.94)");
  shade.addColorStop(0.6, "rgba(4, 8, 10, 0.78)");
  shade.addColorStop(1, "rgba(4, 8, 10, 0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = "rgba(135, 211, 183, 0.65)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
}

function circleAvatar(ctx, image, x, y, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  const side = Math.min(image.width, image.height);
  ctx.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    x - radius,
    y - radius,
    radius * 2,
    radius * 2
  );
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = "#8ddcc0";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function fit(ctx, value, maxWidth) {
  const chars = Array.from(String(value));
  if (ctx.measureText(chars.join("")).width <= maxWidth) {
    return chars.join("");
  }

  while (
    chars.length &&
    ctx.measureText(chars.join("") + "...").width > maxWidth
  ) chars.pop();

  return chars.join("") + "...";
}

function text(ctx, value, x, y, size, color, maxWidth) {
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fit(ctx, value, maxWidth), x, y);
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(10, 25, 24, 0.82)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
}

async function levelUpGif(user, level, guild) {
  const assets = await loadAssets(user);

  // Prepare a grayscale avatar once, rather than once per frame.
  const avatarCanvas = createCanvas(256, 256);
  const avatarCtx = avatarCanvas.getContext("2d");
  avatarCtx.drawImage(assets.avatar, 0, 0, 256, 256);
  const pixels = avatarCtx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(
      0.299 * pixels.data[i] +
      0.587 * pixels.data[i + 1] +
      0.114 * pixels.data[i + 2]
    );
    pixels.data[i] = gray;
    pixels.data[i + 1] = gray;
    pixels.data[i + 2] = gray;
  }
  avatarCtx.putImageData(pixels, 0, 0);

  let guildIcon = null;
  const iconUrl = guild?.iconURL({ extension: "png", size: 128, forceStatic: true });
  if (iconUrl) {
    try {
      const response = await fetch(iconUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      guildIcon = await loadImage(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.warn("LEVEL GUILD ICON:", error.message);
    }
  }
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const gif = GIFEncoder();
  const frames = 20;

  for (let i = 0; i < frames; i++) {
    const phase = (i / frames) * Math.PI * 2;
    base(ctx, assets.background);

    panel(ctx, 35, 50, 575, 400);

    const bounce = Math.sin(phase) * 7;
    circleAvatar(ctx, avatarCanvas, 170, 210 + bounce, 82);

    // Smooth looping bounce for the title and level text.
    const titleBounce = Math.sin(phase) * 8;
    text(ctx, "LEVEL UP!", 290, 145 + titleBounce, 50, "#a6f3d3", 285);
    text(ctx, `@${user.username}`, 290, 220, 31, "#ffffff", 275);
    text(ctx, `LEVEL ${level}`, 290, 280 + titleBounce * 0.6, 38, "#e5fff5", 275);

    if (guildIcon) {
      circleAvatar(ctx, guildIcon, 700, 80, 42);
    }
    text(ctx, "MILAN COMMUNITY", 70, 385, 19, "#a8c1b8", 450);

    const rgba = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    const palette = quantize(rgba, 256);

    gif.writeFrame(applyPalette(rgba, palette), WIDTH, HEIGHT, {
      palette,
      delay: 70,
      repeat: 0,
    });

    await new Promise(resolve => setImmediate(resolve));
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

async function rankCard(user, data) {
  const assets = await loadAssets(user);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  base(ctx, assets.background);
  panel(ctx, 30, 35, 650, 430);
  circleAvatar(ctx, assets.avatar, 125, 132, 65);

  text(ctx, "MILAN • RANK", 220, 85, 35, "#a6f3d3", 425);
  text(ctx, `@${user.username}`, 220, 140, 29, "#ffffff", 425);

  text(ctx, `LEVEL  ${data.level}`, 65, 235, 27, "#ffffff", 260);
  text(ctx, `TIER  ${data.tier}`, 340, 235, 25, "#d7e9e1", 290);
  text(ctx, `RANK  #${data.rank}`, 65, 285, 24, "#d7e9e1", 260);
  text(ctx, `MESSAGES  ${data.messages}`, 340, 285, 23, "#d7e9e1", 290);

  const barX = 65;
  const barY = 345;
  const barW = 550;
  const barH = 16;

  ctx.fillStyle = "rgba(220, 240, 230, 0.20)";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 8);
  ctx.fill();

  if (data.percent > 0) {
    ctx.fillStyle = "#86d9b5";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * data.percent / 100, barH, 8);
    ctx.fill();
  }

  text(
    ctx,
    `${data.currentXp.toLocaleString()} / ${data.neededXp.toLocaleString()} XP`,
    65, 393, 22, "#ffffff", 350
  );

  text(ctx, `${data.percent}%`, 525, 393, 22, "#a6f3d3", 100);
  text(ctx, "COINS: NOT AVAILABLE YET", 65, 430, 16, "#a8c1b8", 500);

  return canvas.toBuffer("image/png");
}

module.exports = { levelUpGif, rankCard };