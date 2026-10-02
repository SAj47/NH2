const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who } = require('../../features/logService');

// خروج عضو: إما Kick (قناة kicked) أو خروج عادي (قناة left-membre). الـ Ban له سجله الخاص.
module.exports = {
    name: Events.GuildMemberRemove,
    intents: [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
    async execute(member) {
        const user = member.user;
        const guild = member.guild;

        const entry = await findRecentAudit(guild, {
            actions: [AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick],
            match: e => e.target?.id === user.id
        });

        if (entry?.action === AuditLogEvent.MemberBanAdd) return; // يُسجَّل في banned

        if (entry?.action === AuditLogEvent.MemberKick) {
            return sendLog(guild, 'kicked', logEmbed({
                color: COLORS.orange,
                title: '👢 Member kicked',
                user,
                description: `${user} was kicked from the server.`,
                fields: [
                    { name: 'Kicked by', value: who(entry) },
                    { name: 'Reason', value: entry.reason ?? 'No reason provided' }
                ]
            }));
        }

        const roles = member.roles?.cache
            ?.filter(r => r.id !== guild.id)
            .map(r => `${r}`).slice(0, 15).join(' ');

        await sendLog(guild, 'leaves', logEmbed({
            color: COLORS.gray,
            title: '📤 Member left',
            user,
            description: `${user} left the server.`,
            fields: [
                { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown' },
                { name: 'Member count', value: String(guild.memberCount) },
                { name: 'Roles', value: roles || 'None', inline: false }
            ]
        }));
    }
};
