"use strict";

const { createCanvas } = require("@napi-rs/canvas");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

// European wheel order, clockwise from zero.
const ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13,
  36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36
]);

const WIDTH = 640;
const HEIGHT = 360;
const FRAMES = 75;
const FPS = 15;
const MAX_BYTES = 8 * 1024 * 1024;

// Limit rendering load to one animation per bot process.
// Other rounds still settle and show a text result.
let busy = false;

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function drawFrame(ctx, number, frame) {
  const cx = WIDTH / 2;
  const cy = 170;
  const index = ORDER.indexOf(number);
  const step = Math.PI * 2 / ORDER.length;
  const t = Math.min(frame / 59, 1);
  const eased = easeOut(t);

  // At the end, the chosen pocket is centered under the top pointer.
  const finalRotation = Math.PI * 2 * 3 - index * step;
  const rotation = finalRotation * eased;

  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const background = ctx.createRadialGradient(
    cx, cy, 20, cx, cy, WIDTH * 0.65
  );
  background.addColorStop(0, "#24211b");
  background.addColorStop(0.45, "#111313");
  background.addColorStop(1, "#050606");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft gold ambient halo.
  const halo = ctx.createRadialGradient(cx, cy, 80, cx, cy, 220);
  halo.addColorStop(0, "rgba(198,155,65,0.15)");
  halo.addColorStop(1, "rgba(198,155,65,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Shadow and metallic outer rings.
  ctx.beginPath();
  ctx.ellipse(cx, cy + 8, 157, 151, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fill();

  const outer = ctx.createRadialGradient(cx - 45, cy - 50, 20, cx, cy, 155);
  outer.addColorStop(0, "#443d2c");
  outer.addColorStop(0.72, "#171816");
  outer.addColorStop(0.88, "#d0aa5a");
  outer.addColorStop(0.93, "#5b4727");
  outer.addColorStop(1, "#171612");

  ctx.beginPath();
  ctx.arc(cx, cy, 151, 0, Math.PI * 2);
  ctx.fillStyle = outer;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 141, 0, Math.PI * 2);
  ctx.fillStyle = "#101211";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#b28d4c";
  ctx.stroke();

  // Rotating numbered pockets.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  for (let i = 0; i < ORDER.length; i++) {
    const pocket = ORDER[i];
    const center = -Math.PI / 2 + i * step;
    const start = center - step / 2;
    const end = center + step / 2;

    ctx.beginPath();
    ctx.arc(0, 0, 124, start, end);
    ctx.arc(0, 0, 91, end, start, true);
    ctx.closePath();
    ctx.fillStyle = pocket === 0
      ? "#087344"
      : RED.has(pocket)
        ? "#a31321"
        : "#101216";
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#b49454";
    ctx.stroke();

    ctx.save();
    ctx.rotate(center + Math.PI / 2);
    ctx.fillStyle = "#f5e8c8";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(pocket), 0, -110);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 90, 0, Math.PI * 2);
  ctx.fillStyle = "#171713";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#a98340";
  ctx.stroke();

  const centerGold = ctx.createRadialGradient(-18, -20, 2, 0, 0, 73);
  centerGold.addColorStop(0, "#eee0a1");
  centerGold.addColorStop(0.22, "#ad873f");
  centerGold.addColorStop(0.55, "#30291c");
  centerGold.addColorStop(1, "#090b0b");

  ctx.beginPath();
  ctx.arc(0, 0, 76, 0, Math.PI * 2);
  ctx.fillStyle = centerGold;
  ctx.fill();

  // Fine spokes for a premium metallic center.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 22, Math.sin(angle) * 22);
    ctx.lineTo(Math.cos(angle) * 71, Math.sin(angle) * 71);
    ctx.strokeStyle = "rgba(218,181,104,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 23, 0, Math.PI * 2);
  ctx.fillStyle = "#9a753a";
  ctx.fill();
  ctx.strokeStyle = "#ead59a";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#e2c17a";
  ctx.fill();
  ctx.restore();

  // Fixed pointer.
  ctx.beginPath();
  ctx.moveTo(cx, cy - 150);
  ctx.lineTo(cx - 6, cy - 162);
  ctx.lineTo(cx + 6, cy - 162);
  ctx.closePath();
  ctx.fillStyle = "#e5c77f";
  ctx.fill();

  // Ball runs around the outer track and settles at the selected pocket.
  const ballAngle = -Math.PI / 2 - Math.PI * 2 * 3 * eased;
  const drop = Math.max(0, (t - 0.78) / 0.22);
  const smoothDrop = drop * drop * (3 - 2 * drop);
  const radius = 135 - 27 * smoothDrop;
  const bx = cx + Math.cos(ballAngle) * radius;
  const by = cy + Math.sin(ballAngle) * radius;

  const ball = ctx.createRadialGradient(bx - 2, by - 3, 1, bx, by, 7);
  ball.addColorStop(0, "#ffffff");
  ball.addColorStop(0.35, "#dce0df");
  ball.addColorStop(1, "#555c5c");

  ctx.beginPath();
  ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = ball;
  ctx.fill();

  if (t > 0.9) {
    ctx.beginPath();
    ctx.arc(bx, by, 12, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(244,205,117,${(t - 0.9) * 2})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Branding below the wheel.
  ctx.save();
  ctx.fillStyle = "#d6b76c";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M I L A N", cx, 346);
  ctx.restore();
}

function writeFrame(stream, buffer) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new Error("ffmpeg input stream closed."));
      return;
    }
    stream.write(buffer, error => error ? reject(error) : resolve());
  });
}

module.exports = async function renderRoulette(number) {
  if (!Number.isInteger(number) || !ORDER.includes(number)) {
    throw new Error("Invalid roulette number.");
  }

  if (busy) {
    throw new Error("Animation renderer is busy; using text result.");
  }

  busy = true;
  let directory;
  let child;
  let timer;

  try {
    directory = await mkdtemp(path.join(tmpdir(), "milan-roulette-"));
    const output = path.join(directory, "roulette.gif");

    child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-vcodec", "png",
      "-i", "pipe:0",
      "-loop", "-1",
      output,
    ], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });

    // Prevent an unhandled stream error if ffmpeg exits early.
    child.stdin.on("error", () => {});

    const exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(
          `ffmpeg failed (code=${code}, signal=${signal}): ${stderr}`
        ));
      });
    });

    // Attach a rejection handler immediately while frames are being written.
    exit.catch(() => {});

    timer = setTimeout(() => child.kill(), 90000);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    for (let frame = 0; frame < FRAMES; frame++) {
      drawFrame(ctx, number, frame);
      const png = canvas.toBuffer("image/png");
      await writeFrame(child.stdin, png);
    }

    child.stdin.end();
    await exit;

    const gif = await readFile(output);
    if (!gif.length || gif.length > MAX_BYTES) {
      throw new Error(`GIF size is invalid: ${gif.length} bytes.`);
    }
    return gif;
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(error =>
        console.error("ROULETTE TEMP CLEANUP ERROR:", error.message)
      );
    }
    busy = false;
  }
};