const { Events, GatewayIntentBits } = require('discord.js');
const { handleNewMember } = require('../features/welcome');

// الترحيب + الرتب التلقائية عند دخول عضو
module.exports = {
    name: Events.GuildMemberAdd,
    once: false,
    intents: [GatewayIntentBits.GuildMembers], // يُجمع تلقائياً في index.js
    execute: handleNewMember
};
