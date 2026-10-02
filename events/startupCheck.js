const { Events } = require('discord.js');
const CONFIG = require('../config');
const { runHealthCheck, formatReport } = require('../features/healthCheck');

// عند التشغيل: يفحص الإعدادات (IDs، رتب، صلاحيات، Gemini) ويطبع تقريراً واضحاً
module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        if (CONFIG.HEALTH_CHECK?.ON_START === false) return;
        const result = await runHealthCheck(client);
        console.log(formatReport(result));
    }
};
