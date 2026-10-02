const { Events, GatewayIntentBits } = require('discord.js');

// تحميل كل الأعضاء عند التشغيل حتى يستطيع البوت مقارنة (قبل/بعد) في سجلات الرتب والتايم أوت
module.exports = {
    name: Events.ClientReady,
    once: true,
    intents: [GatewayIntentBits.GuildMembers],
    async execute(client) {
        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.members.fetch();
                console.log(`🗂️ Log system: cached ${guild.members.cache.size} members of "${guild.name}".`);
            } catch (err) {
                console.warn(`⚠️ Could not cache members of "${guild.name}":`, err.message);
            }
        }
    }
};
