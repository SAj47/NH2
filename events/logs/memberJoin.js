const { Events, GatewayIntentBits } = require('discord.js');
const { COLORS, sendLog, logEmbed } = require('../../features/logService');

module.exports = {
    name: Events.GuildMemberAdd,
    intents: [GatewayIntentBits.GuildMembers],
    async execute(member) {
        const user = member.user;
        const ageDays = (Date.now() - user.createdTimestamp) / 86_400_000;

        const fields = [
            { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>` },
            { name: 'Member count', value: String(member.guild.memberCount) }
        ];
        if (!user.bot && ageDays < 7) {
            fields.push({ name: '⚠️ New account', value: `Created ${Math.floor(ageDays)} day(s) ago`, inline: false });
        }

        await sendLog(member.guild, 'joins', logEmbed({
            color: COLORS.green,
            title: user.bot ? '🤖 Bot joined' : '📥 Member joined',
            user,
            description: `${member} joined the server.`,
            fields
        }));
    }
};
