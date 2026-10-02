const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who, changed } = require('../../features/logService');

// الصوت: rooms (دخول/خروج) • mouved (انتقال) • muted-demute (كتم/فك كتم من الإدارة)
module.exports = {
    name: Events.VoiceStateUpdate,
    intents: [GatewayIntentBits.GuildVoiceStates],
    async execute(oldState, newState) {
        const member = newState.member ?? oldState.member;
        if (!member) return;
        const guild = newState.guild;
        const user = member.user;

        // دخول / خروج / انتقال
        if (oldState.channelId !== newState.channelId) {
            if (!oldState.channelId) {
                await sendLog(guild, 'rooms', logEmbed({
                    color: COLORS.green, title: '🔊 Joined voice', user,
                    description: `${member} joined ${newState.channel}.`
                }));
            } else if (!newState.channelId) {
                await sendLog(guild, 'rooms', logEmbed({
                    color: COLORS.gray, title: '🔈 Left voice', user,
                    description: `${member} left ${oldState.channel}.`
                }));
            } else {
                // هل نقله شخص آخر؟ (بحث تقريبي في الـ audit log)
                const entry = await findRecentAudit(guild, {
                    actions: [AuditLogEvent.MemberMove],
                    match: e => e.extra?.channel?.id === newState.channelId && e.executor?.id !== user.id
                });
                await sendLog(guild, 'moved', logEmbed({
                    color: COLORS.purple, title: '🔀 Moved voice channel', user,
                    description: `${member} moved between voice channels.`,
                    fields: [
                        { name: 'From', value: `${oldState.channel}` },
                        { name: 'To', value: `${newState.channel}` },
                        { name: 'Moved by', value: entry ? who(entry) : 'Self / unknown' }
                    ]
                }));
            }
        }

        // كتم / صمم من الإدارة (Server Mute / Deafen)
        const muteChanged = oldState.serverMute !== newState.serverMute;
        const deafChanged = oldState.serverDeaf !== newState.serverDeaf;
        if (muteChanged || deafChanged) {
            const entry = await findRecentAudit(guild, {
                actions: [AuditLogEvent.MemberUpdate],
                match: e => e.target?.id === user.id && (changed(e, 'mute') || changed(e, 'deaf'))
            });
            const parts = [];
            if (muteChanged) parts.push(newState.serverMute ? 'Server muted' : 'Server unmuted');
            if (deafChanged) parts.push(newState.serverDeaf ? 'Server deafened' : 'Server undeafened');

            await sendLog(guild, 'muted', logEmbed({
                color: (newState.serverMute || newState.serverDeaf) ? COLORS.orange : COLORS.green,
                title: `🎙️ ${parts.join(' & ')}`,
                user,
                description: `${member}: ${parts.join(', ').toLowerCase()}.`,
                fields: [{ name: 'By', value: who(entry) }]
            }));
        }
    }
};
