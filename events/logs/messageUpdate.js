const { Events, GatewayIntentBits } = require('discord.js');
const { COLORS, sendLog, logEmbed } = require('../../features/logService');
const { clip } = require('../../utils/text');

module.exports = {
    name: Events.MessageUpdate,
    intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    async execute(oldMessage, newMessage) {
        if (!newMessage.guild || newMessage.partial || newMessage.author?.bot) return;
        if (oldMessage.partial || oldMessage.content == null) return;      // لا نعرف النص القديم
        if (oldMessage.content === newMessage.content) return;             // تغيّر شيء آخر (مثل embed)

        await sendLog(newMessage.guild, 'messages', logEmbed({
            color: COLORS.yellow,
            title: '✏️ Message edited',
            user: newMessage.author,
            description: `[Jump to message](${newMessage.url})`,
            fields: [
                { name: 'Channel', value: `${newMessage.channel}` },
                { name: 'Before', value: clip(oldMessage.content || '—', 1000), inline: false },
                { name: 'After', value: clip(newMessage.content || '—', 1000), inline: false }
            ]
        }));
    }
};
