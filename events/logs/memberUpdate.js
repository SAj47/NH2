const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who, changed } = require('../../features/logService');

// تغييرات العضو: الرتب (roles) والتايم أوت (time-out)
module.exports = {
    name: Events.GuildMemberUpdate,
    intents: [GatewayIntentBits.GuildMembers],
    async execute(oldMember, newMember) {
        if (oldMember.partial) return; // لا توجد بيانات قديمة للمقارنة
        const guild = newMember.guild;
        const user = newMember.user;

        // ── الرتب ──
        const before = oldMember.roles.cache;
        const after = newMember.roles.cache;
        const added = after.filter(r => !before.has(r.id));
        const removed = before.filter(r => !after.has(r.id));

        if (added.size || removed.size) {
            const entry = await findRecentAudit(guild, {
                actions: [AuditLogEvent.MemberRoleUpdate],
                match: e => e.target?.id === user.id
            });
            const fields = [];
            if (added.size) fields.push({ name: '➕ Added', value: added.map(r => `${r}`).join(' '), inline: false });
            if (removed.size) fields.push({ name: '➖ Removed', value: removed.map(r => `${r}`).join(' '), inline: false });
            fields.push({ name: 'By', value: who(entry) });

            await sendLog(guild, 'roles', logEmbed({
                color: COLORS.blue,
                title: '🎭 Roles updated',
                user,
                description: `Roles changed for ${user}.`,
                fields
            }));
        }

        // ── التايم أوت ──
        const tBefore = oldMember.communicationDisabledUntilTimestamp ?? null;
        const tAfter = newMember.communicationDisabledUntilTimestamp ?? null;
        const now = Date.now();
        const wasActive = !!tBefore && tBefore > now;
        const isActive = !!tAfter && tAfter > now;

        if ((isActive && tAfter !== tBefore) || (wasActive && !isActive)) {
            const entry = await findRecentAudit(guild, {
                actions: [AuditLogEvent.MemberUpdate],
                match: e => e.target?.id === user.id && changed(e, 'communication_disabled_until')
            });

            if (isActive) {
                await sendLog(guild, 'timeout', logEmbed({
                    color: COLORS.orange,
                    title: wasActive ? '⏱️ Timeout updated' : '⏱️ Member timed out',
                    user,
                    description: `${user} was timed out.`,
                    fields: [
                        { name: 'Until', value: `<t:${Math.floor(tAfter / 1000)}:F> (<t:${Math.floor(tAfter / 1000)}:R>)`, inline: false },
                        { name: 'By', value: who(entry) },
                        { name: 'Reason', value: entry?.reason ?? 'No reason provided' }
                    ]
                }));
            } else {
                await sendLog(guild, 'timeout', logEmbed({
                    color: COLORS.green,
                    title: '✅ Timeout removed',
                    user,
                    description: `The timeout on ${user} was removed.`,
                    fields: [{ name: 'By', value: who(entry) }]
                }));
            }
        }
    }
};
