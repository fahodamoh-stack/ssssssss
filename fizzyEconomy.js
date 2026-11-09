"use strict";

const { Events } = require("discord.js");
const { randomInt } = require("node:crypto");

module.exports = function registerFizzyEconomy(client, db) {
  const DAILY_AMOUNT = 500;
  const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
  const WORK_COOLDOWN = 60 * 60 * 1000;
  const MAX_BALANCE = 1_000_000_000;
  const EMOJI = "<:coin:1568544045041586246>";

  db.exec(`
    CREATE TABLE IF NOT EXISTS fizzy_wallets (
      guild TEXT NOT NULL,
      user TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      daily_at INTEGER NOT NULL DEFAULT 0,
      work_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild, user)
    );

    CREATE TABLE IF NOT EXISTS fizzy_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild TEXT NOT NULL,
      actor TEXT NOT NULL,
      target TEXT,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const ensure = db.prepare(`
    INSERT OR IGNORE INTO fizzy_wallets (guild, user)
    VALUES (?, ?)
  `);

  const get = db.prepare(`
    SELECT balance, daily_at, work_at
    FROM fizzy_wallets WHERE guild = ? AND user = ?
  `);

  const setDaily = db.prepare(`
    UPDATE fizzy_wallets
    SET balance = balance + ?, daily_at = ?
    WHERE guild = ? AND user = ?
  `);

  const setWork = db.prepare(`
    UPDATE fizzy_wallets
    SET balance = balance + ?, work_at = ?
    WHERE guild = ? AND user = ?
  `);

  const subtract = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance - ?
    WHERE guild = ? AND user = ?
  `);

  const add = db.prepare(`
    UPDATE fizzy_wallets SET balance = balance + ?
    WHERE guild = ? AND user = ?
  `);

  const record = db.prepare(`
    INSERT INTO fizzy_transactions
      (guild, actor, target, kind, amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function remaining(ms) {
    const minutes = Math.ceil(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} ساعة و ${rest} دقيقة` : `${minutes} دقيقة`;
  }

  function reward(guild, user, kind) {
    return transaction(() => {
      const now = Date.now();
      ensure.run(guild, user);
      const wallet = get.get(guild, user);
      const daily = kind === "daily";
      const last = daily ? wallet.daily_at : wallet.work_at;
      const cooldown = daily ? DAILY_COOLDOWN : WORK_COOLDOWN;
      const wait = last + cooldown - now;

      if (wait > 0) return { wait };

      const amount = daily ? DAILY_AMOUNT : randomInt(100, 301);
      if (wallet.balance + amount > MAX_BALANCE) {
        return { limit: true };
      }

      if (daily) setDaily.run(amount, now, guild, user);
      else setWork.run(amount, now, guild, user);

      record.run(guild, user, null, kind, amount, now);
      return { amount, balance: wallet.balance + amount };
    });
  }

  function workBet(guild, user, amount, bypassCooldown, unlimited) {
    return transaction(() => {
      const now = Date.now();
      ensure.run(guild, user);

      const wallet = get.get(guild, user);
      // UNLIMITED_ROLE_ECONOMY
      if (unlimited) {
        const won = randomInt(100) < 40;
        record.run(
          guild, user, null,
          won ? "work_unlimited_win" : "work_unlimited_loss",
          amount, now
        );
        return { won, amount, balance: wallet.balance, unlimited: true };
      }

      const wait = wallet.work_at + WORK_COOLDOWN - now;

      if (wait > 0 && !bypassCooldown) return { wait };
      if (wallet.balance < amount) return { insufficient: true };

      // Check before drawing so a rejected bet cannot consume a cooldown.
      if (wallet.balance + amount > MAX_BALANCE) return { limit: true };

      const won = randomInt(100) < 40;
      const delta = won ? amount : -amount;

      db.prepare(`
        UPDATE fizzy_wallets
        SET balance = balance + ?, work_at = ?
        WHERE guild = ? AND user = ?
      `).run(delta, now, guild, user);

      record.run(
        guild,
        user,
        null,
        won ? "work_win" : "work_loss",
        amount,
        now
      );

      return { won, amount, balance: wallet.balance + delta };
    });
  }
  function transfer(guild, sender, recipient, amount, unlimited) {
    return transaction(() => {
      ensure.run(guild, sender);
      ensure.run(guild, recipient);

      const from = get.get(guild, sender);
      const to = get.get(guild, recipient);

      if (!unlimited && from.balance < amount) return { insufficient: true };
      if (to.balance + amount > MAX_BALANCE) return { limit: true };

      if (!unlimited) subtract.run(amount, guild, sender);
      add.run(amount, guild, recipient);
      const selfCredit = unlimited && sender === recipient;
      record.run(
        guild, sender, recipient,
        selfCredit ? "pay_unlimited_self" : unlimited ? "pay_unlimited" : "pay",
        amount, Date.now()
      );

      return {
        balance: selfCredit ? to.balance + amount : unlimited ? from.balance : from.balance - amount,
        unlimited,
        selfCredit
      };
    });
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || message.webhookId) return;

    const content = message.content.trim();
    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();

    if (![".balance", ".daily", ".work", ".pay"].includes(command)) return;

    try {
      const guild = message.guild.id;
      const user = message.author.id;

      const reply = text => message.reply({
        content: text,
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false
      });

      if (command === ".balance") {
        if (parts.length !== 1) {
          await reply("الاستخدام: `.balance`");
          return;
        }

        const balanceMember = await message.guild.members.fetch({
          user,
          force: true
        }).catch(() => null);

        if (!balanceMember) {
          await reply("Could not verify your roles. Please try again.");
          return;
        }

        const unlimitedBalance = balanceMember.roles.cache.has("1568641134220017774");
        ensure.run(guild, user);
        const wallet = get.get(guild, user);
        await reply(`${EMOJI} رصيدك: **${(unlimitedBalance ? "\u221e" : wallet.balance.toLocaleString("en-US"))} Coin**`);
        return;
      }

      if (command === ".work") {
        const WORK_ALLOWED_CHANNELS = [
          "1560996851640045710",
          "1560996836808855593"
        ];

        if (!WORK_ALLOWED_CHANNELS.includes(message.channel.id)) {
          await message.reply({
            flags: 32768,
            components: [{
              type: 17,
              accent_color: 0x203234,
              components: [{
                type: 10,
                content:
                  "\u0627\u0633\u062a\u062e\u062f\u0645 `.work` \u0641\u064a " +
                  "<#1560996851640045710> \u0623\u0648 <#1560996836808855593>."
              }]
            }],
            allowedMentions: { parse: [], repliedUser: false },
            failIfNotExists: false
          });
          return;
        }
        if (parts.length !== 2 || !/^[1-9]\d*$/.test(parts[1])) {
          await reply("الاستخدام: `.work 100` — أقل مبلغ 100 Coin.");
          return;
        }

        const amount = Number(parts[1]);

        if (!Number.isSafeInteger(amount) || amount < 100 || amount > MAX_BALANCE) {
          await reply("اكتب مبلغ صحيح من 100 لحد الحد الأقصى للرصيد.");
          return;
        }

        // Fetch the current member so the exemption uses their current roles.
        const workMember = await message.guild.members.fetch({
          user,
          force: true
        }).catch(() => null);

        if (!workMember) {
          await reply("مش قادر أتأكد من رتبتك دلوقتي، جرّب تاني.");
          return;
        }

        const unlimited = workMember.roles.cache.has("1568641134220017774");
        const bypassCooldown =
          unlimited || workMember.roles.cache.has("1561045275643215992");
        const result = workBet(guild, user, amount, bypassCooldown, unlimited);

        if (result.wait) {
          await reply(`⏳ تقدر تستخدم الأمر تاني بعد **${remaining(result.wait)}**.`);
        } else if (result.insufficient) {
          await reply("رصيدك مش كافي للمبلغ ده.");
        } else if (result.limit) {
          await reply("المكسب المحتمل هيعدّي الحد الأقصى للرصيد.");
        } else {
          const statusEmoji = result.won
            ? "<:win:1568544354618843146>"
            : "<:lose:1568543980805689424>";
          const outcome = result.won
            ? "\u0645\u0643\u0633\u0628"
            : "\u062e\u0633\u0627\u0631\u0629";
          const sign = result.won ? "+" : "-";

          await message.reply({
            flags: 32768,
            components: [{
              type: 17,
              accent_color: result.won ? 0x2ecc71 : 0xe74c3c,
              components: [
                {
                  type: 10,
                  content: `${statusEmoji} **${outcome}**`
                },
                { type: 14, divider: true, spacing: 1 },
                {
                  type: 10,
                  content:
                    `${EMOJI} **${sign}${amount.toLocaleString("en-US")} Coin**\n` +
                    `${EMOJI} **\u0631\u0635\u064a\u062f\u0643:** ${(result.unlimited ? "\u221e" : result.balance.toLocaleString("en-US"))} Coin`
                }
              ]
            }],
            allowedMentions: { parse: [], repliedUser: false },
            failIfNotExists: false
          });
        }
        return;
      }

      if (command === ".daily") {
        if (parts.length !== 1) {
          await reply(`الاستخدام: \`${command}\``);
          return;
        }

        const result = reward(guild, user, command.slice(1));

        if (result.wait) {
          await reply(`⏳ تقدر تستخدم الأمر تاني بعد **${remaining(result.wait)}**.`);
        } else if (result.limit) {
          await reply("رصيدك هيعدّي الحد الأقصى، لذلك المكافأة لم تُضف.");
        } else {
          await reply(
            `${EMOJI} حصلت على **${result.amount} Coin**.\n` +
            `رصيدك: **${result.balance.toLocaleString("en-US")} Coin**`
          );
        }
        return;
      }

      if (parts.length !== 3 || !/^<@!?\d{17,20}>$/.test(parts[1]) ||
          !/^[1-9]\d{0,9}$/.test(parts[2])) {
        await reply("الاستخدام: `.pay @member 100`");
        return;
      }

      const recipient = message.mentions.users.first();
      const amount = Number(parts[2]);

      if (!recipient || recipient.bot ||
          !Number.isSafeInteger(amount) || amount > MAX_BALANCE) {
        await reply("اختار عضو حقيقي غيرك ومبلغ صحيح ضمن الحد المسموح.");
        return;
      }

      const member = await message.guild.members.fetch(recipient.id).catch(() => null);
      if (!member) {
        await reply("العضو غير موجود في السيرفر.");
        return;
      }

      const payMember = await message.guild.members.fetch({
        user,
        force: true
      }).catch(() => null);

      if (!payMember) {
        await reply("Could not verify your roles. Please try again.");
        return;
      }

      const unlimitedPay = payMember.roles.cache.has("1568641134220017774");

      if (recipient.id === user && !unlimitedPay) {
        await reply("Self-payment is available only to the unlimited role.");
        return;
      }

      const result = transfer(guild, user, recipient.id, amount, unlimitedPay);

      if (result.selfCredit) {
        await reply(
          `${EMOJI} Added **${amount.toLocaleString("en-US")} Coin** to your saved balance.\n` +
          `Saved balance: **${result.balance.toLocaleString("en-US")} Coin**\n` +
          `Unlimited display: **\u221e**`
        );
      } else if (result.insufficient) {
        await reply("رصيدك مش كافي للتحويل.");
      } else if (result.limit) {
        await reply("التحويل هيخلّي رصيد المستلم يتعدّى الحد الأقصى.");
      } else {
        await reply(
          `${EMOJI} تم تحويل **${amount.toLocaleString("en-US")} Coin** إلى ` +
          `**${recipient.username}**.\nرصيدك: **${(result.unlimited ? "\u221e" : result.balance.toLocaleString("en-US"))} Coin**`
        );
      }
    } catch (error) {
      console.error("FIZZY ECONOMY ERROR:", error);
      if (!message.deleted) {
        await message.reply({
          content: "حصل خطأ في الاقتصاد. راجع لوج البوت قبل إعادة المحاولة.",
          allowedMentions: { parse: [], repliedUser: false },
          failIfNotExists: false
        }).catch(() => {});
      }
    }
  });

  console.log("FIZZY ECONOMY LOADED");
};