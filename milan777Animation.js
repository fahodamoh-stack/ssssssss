"use strict";

const { createCanvas } = require("@napi-rs/canvas");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const SYMBOLS = [
  "\u{1F352}", "\u{1F34B}", "\u{1F347}", "\u{1F349}",
  "\u2B50", "\u{1F48E}", "7\uFE0F\u20E3"
];

const LABELS = ["CHERRY", "LEMON", "GRAPE", "MELON", "STAR", "DIAMOND", "7"];
const COLORS = [
  "#db3549", "#ead16a", "#a976d6", "#e66b68",
  "#efc45e", "#83cad4", "#eddbc0"
];

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 15;
const FRAMES = 75;
const MAX_BYTES = 8 * 1024 * 1024;
let busy = false;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function frame(ctx, selected, n) {
  const bg = ctx.createRadialGradient(320, 145, 5, 320, 170, 380);
  bg.addColorStop(0, "#28251e");
  bg.addColorStop(0.55, "#111413");
  bg.addColorStop(1, "#050606");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  roundRect(ctx, 55, 35, 530, 260, 22);
  ctx.fillStyle = "#171916";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#b49657";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e6ca88";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("M I L A N", 320, 68);

  for (let reel = 0; reel < 3; reel++) {
    const x = 82 + reel * 162;
    const stopFrame = 30 + reel * 10;
    const locked = n >= stopFrame;

    const symbolIndex = locked
      ? selected[reel]
      : Math.floor(n * (1.3 + reel * 0.15) + reel * 2) % LABELS.length;

    roundRect(ctx, x, 104, 152, 145, 12);
    const slot = ctx.createLinearGradient(0, 104, 0, 249);
    slot.addColorStop(0, "#090b0b");
    slot.addColorStop(0.5, "#282a25");
    slot.addColorStop(1, "#090b0b");
    ctx.fillStyle = slot;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = locked ? "#d3b46c" : "#6c5a39";
    ctx.stroke();

    ctx.fillStyle = COLORS[symbolIndex];
    ctx.font = symbolIndex === 6
      ? "bold 72px sans-serif"
      : "bold 20px sans-serif";
    ctx.fillText(LABELS[symbolIndex], x + 76, 175);

    ctx.fillStyle = locked ? "#bfa465" : "#716a58";
    ctx.font = "12px sans-serif";
    ctx.fillText(locked ? "LOCKED" : "SPINNING", x + 76, 225);
  }

  ctx.fillStyle = "#d6b76c";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("M I L A N   |   7 7 7", 320, 325);
}

function writeFrame(stream, buffer) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new Error("ffmpeg input closed"));
      return;
    }
    stream.write(buffer, error => error ? reject(error) : resolve());
  });
}

module.exports = async function render777(symbols) {
  if (!Array.isArray(symbols) || symbols.length !== 3) {
    throw new Error("Invalid settled symbols");
  }

  const selected = symbols.map(symbol => SYMBOLS.indexOf(symbol));
  if (selected.some(index => index < 0)) {
    throw new Error("Unknown settled symbol");
  }

  if (busy) {
    throw new Error("777 renderer busy; use text result");
  }

  busy = true;
  let directory;
  let child;
  let timer;

  try {
    directory = await mkdtemp(path.join(tmpdir(), "milan-777-"));
    const output = path.join(directory, "777.gif");

    child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-vcodec", "png",
      "-i", "pipe:0",
      "-loop", "-1",
      output
    ], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.stdin.on("error", () => {});

    const exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(
          `ffmpeg failed: code=${code}, signal=${signal}, ${stderr}`
        ));
      });
    });
    exit.catch(() => {});

    timer = setTimeout(() => child.kill(), 90000);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    for (let n = 0; n < FRAMES; n++) {
      frame(ctx, selected, n);
      await writeFrame(child.stdin, canvas.toBuffer("image/png"));
    }

    child.stdin.end();
    await exit;

    const gif = await readFile(output);
    if (!gif.length || gif.length > MAX_BYTES) {
      throw new Error(`Invalid GIF size: ${gif.length}`);
    }
    return gif;
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(error =>
        console.error("777 TEMP CLEANUP ERROR:", error.message)
      );
    }
    busy = false;
  }
};