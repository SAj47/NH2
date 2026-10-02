const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who } = require('../../features/logService');

module.exports = {
    name: Events.GuildBanAdd,
    intents: [GatewayIntentBits.GuildModeration],
    async execute(ban) {
        const full = ban.partial ? await ban.fetch().catch(() => ban) : ban;
        const entry = await findRecentAudit(ban.guild, {
            actions: [AuditLogEvent.MemberBanAdd],
            match: e => e.target?.id === ban.user.id
        });

        await sendLog(ban.guild, 'banned', logEmbed({
            color: COLORS.red,
            title: '🔨 Member banned',
            user: ban.user,
            description: `${ban.user} was banned.`,
            fields: [
                { name: 'Banned by', value: who(entry) },
                { name: 'Reason', value: entry?.reason ?? full.reason ?? 'No reason provided' }
            ]
        }));
    }
};
