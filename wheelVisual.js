"use strict";

const path = require("node:path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const SIZE = 480;
const CENTER = SIZE / 2;
const RADIUS = 205;
const TAU = Math.PI * 2;
const POINTER = -Math.PI / 2;

let displayFont = "sans-serif";

try {
  if (GlobalFonts.registerFromPath(
    path.join(__dirname, "Floane-Bold.otf"),
    "MilanWheel"
  )) {
    displayFont = "MilanWheel";
  }
} catch (error) {
  console.warn("WHEEL FONT:", error.message);
}

const COLORS = [
  "#ad4deb",
  "#1fc76c",
  "#ef9315",
  "#f0bb19",
  "#4289ed",
  "#12a881",
  "#e56478",
  "#d8a526",
];

/**
 * segments: [{ label: "Coin" | "XP" | "PIC" }, ...]
 * winnerIndex: index in that exact array.
 * resultText: e.g. "YOU WIN +100 COIN"
 */
async function createWheelGif(segments, winnerIndex, resultText) {
  if (!Array.isArray(segments) || segments.length < 2 || segments.length > 12) {
    throw new Error("Wheel needs between 2 and 12 segments.");
  }

  if (!Number.isInteger(winnerIndex) ||
      winnerIndex < 0 || winnerIndex >= segments.length) {
    throw new Error("Invalid winning segment.");
  }

  if (!segments.every(segment =>
    segment && ["Coin", "XP", "PIC"].includes(segment.label)
  )) {
    throw new Error("Invalid wheel segment.");
  }

  const text = String(resultText || "YOU WIN").slice(0, 40);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const gif = GIFEncoder();
  const slice = TAU / segments.length;

  // The middle of the chosen slice ends exactly under the top pointer.
  const finalRotation =
    TAU * 5 + POINTER - (winnerIndex + 0.5) * slice;

  const animationFrames = 36;
  const holdFrames = 8;
  const totalFrames = animationFrames + holdFrames;

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = Math.min(1, frame / (animationFrames - 1));
    const eased = 1 - Math.pow(1 - t, 3);
    const rotation = finalRotation * eased;

    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Outer rim.
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RADIUS + 6, 0, TAU);
    ctx.fillStyle = "#303849";
    ctx.fill();

    for (let i = 0; i < segments.length; i++) {
      const start = rotation + i * slice;
      const end = start + slice;
      const mid = start + slice / 2;

      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, RADIUS, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      ctx.stroke();

      ctx.save();
      ctx.translate(CENTER, CENTER);
      ctx.rotate(mid);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold 23px "${displayFont}", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#171921";
      ctx.fillStyle = "#ffffff";
      ctx.strokeText(segments[i].label, RADIUS * 0.68, 0);
      ctx.fillText(segments[i].label, RADIUS * 0.68, 0);
      ctx.restore();
    }

    // Center hub.
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 25, 0, TAU);
    ctx.fillStyle = "#4153bb";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#d3ddff";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 10, 0, TAU);
    ctx.fillStyle = "#c9d8ff";
    ctx.fill();

    // Fixed pointer.
    ctx.beginPath();
    ctx.moveTo(CENTER - 13, 15);
    ctx.lineTo(CENTER + 13, 15);
    ctx.lineTo(CENTER, 43);
    ctx.closePath();
    ctx.fillStyle = "#93a7ff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#edf1ff";
    ctx.stroke();

    if (frame >= animationFrames) {
      ctx.fillStyle = "rgba(5, 8, 15, 0.86)";
      ctx.fillRect(35, SIZE - 79, SIZE - 70, 50);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold 22px "${displayFont}", sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, CENTER, SIZE - 54, SIZE - 90);
    }

    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const palette = quantize(rgba, 256);

    gif.writeFrame(applyPalette(rgba, palette), SIZE, SIZE, {
      palette,
      delay: frame >= animationFrames ? 180 : 70,
      repeat: 0,
    });

    await new Promise(resolve => setImmediate(resolve));
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = { createWheelGif };