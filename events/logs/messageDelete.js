const { Events, GatewayIntentBits, AuditLogEvent } = require('discord.js');
const { COLORS, sendLog, logEmbed, findRecentAudit, who } = require('../../features/logService');
const { clip } = require('../../utils/text');

// ملاحظة: يسجّل فقط الرسائل التي استلمها البوت منذ تشغيله (المخزنة في الكاش)
module.exports = {
    name: Events.MessageDelete,
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    async execute(message) {
        if (!message.guild || message.partial || message.author?.bot) return;

        const entry = await findRecentAudit(message.guild, {
            actions: [AuditLogEvent.MessageDelete],
            match: e => e.target?.id === message.author.id && e.extra?.channel?.id === message.channelId
        });

        const attachments = [...message.attachments.values()].map(a => a.name).join(', ');

        await sendLog(message.guild, 'messages', logEmbed({
            color: COLORS.red,
            title: '🗑️ Message deleted',
            user: message.author,
            description: message.content ? '> ' + clip(message.content.replace(/\n/g, '\n> '), 3500) : '*(no text content)*',
            fields: [
                { name: 'Channel', value: `${message.channel}` },
                { name: 'Deleted by', value: entry ? who(entry) : 'Author / unknown' },
                ...(attachments ? [{ name: 'Attachments', value: attachments, inline: false }] : [])
            ]
        }));
    }
};
