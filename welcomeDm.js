const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createCanvas,
  loadImage,
  GlobalFonts,
} = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const IMAGE_PATH = path.join(__dirname, "111.png");
const FONT_PATH = path.join(__dirname, "Floane-Bold.otf");

let customFontFamily = "Arial";

// Floane may not contain Arabic glyphs; canvas will fall back to a system font
// for unsupported characters. If available, this font is used for Latin text.
try {
  if (awaitFontRegistration()) customFontFamily = "FloaneWelcome";
} catch (error) {
  console.warn("WELCOME DM FONT:", error.message);
}

function awaitFontRegistration() {
  return GlobalFonts.registerFromPath(FONT_PATH, "FloaneWelcome");
}

let arabicFontFamily = "Arial";

try {
  if (GlobalFonts.registerFromPath(
    path.join(__dirname, "KOMission-Black.otf"),
    "KOMissionArabic"
  )) {
    arabicFontFamily = "KOMissionArabic";
    console.log("WELCOME DM: KOMission Arabic font loaded");
  } else {
    console.warn("WELCOME DM: KOMission font could not be loaded; using Arial");
  }
} catch (error) {
  console.warn("WELCOME DM FONT:", error.message);
}
async function createDmWelcomeImage(member) {
  const imageBytes = await fs.readFile(IMAGE_PATH);
  const background = await loadImage(imageBytes);

  const width = background.width;
  const height = background.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gif = GIFEncoder();
  const frames = 24;
  const delay = 60;

  for (let frame = 0; frame < frames; frame++) {
    const phase = (frame / frames) * Math.PI * 2;
    const bounce = Math.sin(phase) * height * 0.015;

  // Keep the original 111.png image intact as the background.
  ctx.drawImage(background, 0, 0, width, height);

  // A subtle dark fade near the bottom improves text readability.
  const fade = ctx.createLinearGradient(0, height * 0.58, 0, height);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, height * 0.58, width, height * 0.42);

  // Main text panel at the bottom, away from the character's face.
  const panelX = width * 0.055;
  const panelY = height * 0.72;
  const panelW = width * 0.89;
  const panelH = height * 0.22;

  ctx.save();
  ctx.fillStyle = "rgba(8, 8, 10, 0.48)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // One Arabic greeting only; no Latin heading or emoji.
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.font = `${Math.round(height * 0.070)}px "${arabicFontFamily}", Arial, sans-serif`;
  ctx.fillStyle = "#f5eeee";

  ctx.fillText(
    "نورتتت السيرفر يا كوتيي",
    width / 2,
    panelY + panelH / 2 + bounce,
    panelW - 24
  );

  ctx.restore();
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);

    gif.writeFrame(indexed, width, height, {
      palette,
      delay,
      repeat: 0,
    });

    await new Promise(resolve => setImmediate(resolve));
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = async function sendWelcomeDm(member) {
  try {
    const image = await createDmWelcomeImage(member);

    await member.send({
      files: [
        new AttachmentBuilder(image, {
          name: `welcome-${member.id}.gif`,
          description: "Arabic welcome image",
        }),
      ],
      // No DM text: the greeting is rendered directly onto the image.
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (error?.code === 50007) {
      console.warn(`WELCOME DM: ${member.user.tag} has DMs disabled.`);
      return;
    }

    console.error("WELCOME DM ERROR:", error);
  }
};
