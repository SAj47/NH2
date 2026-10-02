const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who } = require('../../features/logService');

module.exports = {
    name: Events.GuildBanRemove,
    intents: [GatewayIntentBits.GuildModeration],
    async execute(ban) {
        const entry = await findRecentAudit(ban.guild, {
            actions: [AuditLogEvent.MemberBanRemove],
            match: e => e.target?.id === ban.user.id
        });

        await sendLog(ban.guild, 'unbanned', logEmbed({
            color: COLORS.blue,
            title: '♻️ Member unbanned',
            user: ban.user,
            description: `${ban.user} was unbanned.`,
            fields: [
                { name: 'Unbanned by', value: who(entry) },
                { name: 'Reason', value: entry?.reason ?? 'No reason provided' }
            ]
        }));
    }
};
