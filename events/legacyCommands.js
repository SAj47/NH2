const { Events, GatewayIntentBits } = require('discord.js');
const { handleTypeCommand } = require('../features/typeCommand');
const { handleWelcmCommand } = require('../features/welcomeAll');

// أوامر نصية قديمة الطراز (!) بجانب أوامر الـ Slash: !type و !welcm
module.exports = {
    name: Events.MessageCreate,
    once: false,
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    async execute(message) {
        if ((await handleTypeCommand(message).catch(err => { console.error('❌ !type crashed:', err); return true; }))) return;
        await handleWelcmCommand(message).catch(err => console.error('❌ !welcm crashed:', err));
    }
};
