const {
  Events,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js");

const GUILD_ID = "1539363168579747840";
const ROLE_ID = "1567427149701451786";

module.exports = function registerMilanAutoRole(client) {

  async function checkRole(guild) {
    if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) {
      throw new Error("GuildMembers intent is not enabled in the client.");
    }

    const me = await guild.members.fetchMe();
    const role = await guild.roles.fetch(ROLE_ID);

    if (!role) throw new Error("Target role not found.");
    if (role.managed || role.id === guild.id) {
      throw new Error("Target role cannot be assigned by the bot.");
    }
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      throw new Error("Bot needs Manage Roles.");
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      throw new Error("Bot role must be above the target role.");
    }
    return role;
  }

  client.on(Events.GuildMemberAdd, async member => {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;

    try {
      const role = await checkRole(member.guild);
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role, "MILAN auto role for new member");
      }
    } catch (error) {
      console.error(
        `AUTO ROLE ERROR [guild=${member.guild.id} member=${member.id}]:`,
        error.message
      );
    }
  });

  console.log("MILAN AUTO ROLE LOADED");
};