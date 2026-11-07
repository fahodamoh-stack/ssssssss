"use strict";

const { Events, MessageFlags, AttachmentBuilder } = require("discord.js");
const { createCanvas } = require("@napi-rs/canvas");
const { randomInt } = require("node:crypto");

module.exports = function registerGuessPicture(client) {
  const active = new Map();
  const answers = ["Circle", "Square", "Triangle", "Star"];

  function drawPicture(answer) {
    const canvas = createCanvas(480, 320);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, 480, 320);

    ctx.fillStyle = "#ad4deb";
    ctx.strokeStyle = "#e7d8ff";
    ctx.lineWidth = 5;
    ctx.beginPath();

    if (answer === "Circle") {
      ctx.arc(240, 160, 92, 0, Math.PI * 2);
    } else if (answer === "Square") {
      ctx.rect(148, 68, 184, 184);
    } else if (answer === "Triangle") {
      ctx.moveTo(240, 55);
      ctx.lineTo(348, 250);
      ctx.lineTo(132, 250);
      ctx.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        const radius = i % 2 === 0 ? 105 : 45;
        const x = 240 + Math.cos(angle) * radius;
        const y = 160 + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    ctx.fill();
    ctx.stroke();
    return canvas.toBuffer("image/png");
  }

  function panel(id, text, disabled = false) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17,
        accent_color: 0x203234,
        components: [
          { type: 10, content: "### MILAN • GUESS PICTURE" },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: text },
          {
            type: 12,
            items: [{
              media: { url: "attachment://guess-picture.png" },
              description: "Guess the shape"
            }]
          },
          {
            type: 1,
            components: answers.map((answer, index) => ({
              type: 2,
              style: 2,
              custom_id: `milan_picture:${id}:${index}`,
              label: answer,
              disabled
            }))
          }
        ]
      }],
      allowedMentions: { parse: [], repliedUser: false }
    };
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if ((message.content || "").trim().toLowerCase() !== ".guesspicture") return;

    const key = `${message.guild.id}:${message.channel.id}`;
    if (active.has(key)) {
      await message.reply({
        content: "A Guess Picture round is already active here.",
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      }).catch(console.error);
      return;
    }

    const game = {
      id: message.id,
      answer: answers[randomInt(answers.length)],
      ended: false
    };
    active.set(key, game);

    try {
      const image = drawPicture(game.answer);
      const sent = await message.reply({
        ...panel(game.id, "What shape is in the picture? You have **30 seconds**."),
        files: [new AttachmentBuilder(image, { name: "guess-picture.png" })],
        failIfNotExists: false
      });

      const collector = sent.createMessageComponentCollector({ time: 30_000 });

      collector.on("collect", async interaction => {
        if (!interaction.isButton()) return;
        const prefix = `milan_picture:${game.id}:`;
        if (!interaction.customId.startsWith(prefix)) return;

        const action = interaction.customId.slice(prefix.length);
        if (!/^[0-3]$/.test(action)) return;

        if (game.ended) {
          await interaction.reply({
            content: "This round has ended.",
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
          return;
        }

        if (answers[Number(action)] !== game.answer) {
          await interaction.reply({
            content: "Wrong answer. Try again.",
            flags: MessageFlags.Ephemeral
          }).catch(console.error);
          return;
        }

        game.ended = true;
        try {
          await interaction.update(panel(
            game.id,
            `Correct: **${game.answer}**\nWinner: <@${interaction.user.id}>`,
            true
          ));
        } catch (error) {
          console.error("GUESS PICTURE UPDATE ERROR:", error);
          await sent.edit(panel(
            game.id,
            `Correct: **${game.answer}**\nWinner: <@${interaction.user.id}>`,
            true
          )).catch(console.error);
        } finally {
          collector.stop("finished");
        }
      });

      collector.on("end", async (_collected, reason) => {
        if (active.get(key) === game) active.delete(key);
        if (reason === "finished") return;

        game.ended = true;
        await sent.edit(panel(
          game.id,
          `Time is up! The answer was **${game.answer}**.`,
          true
        )).catch(console.error);
      });
    } catch (error) {
      if (active.get(key) === game) active.delete(key);
      console.error("GUESS PICTURE START ERROR:", error);
    }
  });

  console.log("MILAN GUESS PICTURE LOADED");
};