const { SlashCommandBuilder, ChannelType, EmbedBuilder, MessageFlags, GatewayIntentBits } = require('discord.js');
const CONFIG = require('../config');
const { resolveTargetChannel, joinSilently } = require('../features/voiceControl');

// /join [channel] — يدخل الروم الصوتي المحدد، أو روم العضو الحالي، ويبقى بلا صوت
module.exports = {
    // GuildVoiceStates: بدونها لا تصل تحديثات الصوت للبوت عبر الـ Gateway، فلا يكتمل أي اتصال صوتي إطلاقاً.
    // فعّلها أيضاً من Developer Portal إن لم تكن Privileged (هذه ليست Privileged، لكن يجب أن تكون مفعّلة في الكود).
    intents: [GatewayIntentBits.GuildVoiceStates],
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join a voice channel (no audio, just presence)')
        .addChannelOption(o => o.setName('channel').setDescription('Voice channel to join').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(false)),

    async execute(interaction) {
        if (!interaction.inGuild()) return interaction.reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral });

        const member = interaction.member?.voice ? interaction.member : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const channel = resolveTargetChannel(interaction, member ?? {});
        if (!channel) {
            return interaction.reply({ content: '🔊 Join a voice channel first, or use the `channel` option.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await joinSilently(channel);
        if (!result.ok) return interaction.editReply(result.message);

        const embed = new EmbedBuilder()
            .setColor(CONFIG.BOT.COLOR)
            .setDescription(result.alreadyThere ? `🔊 Already in **${channel.name}**.` : `🔊 Joined **${channel.name}**. I'll just sit here quietly.`);
        await interaction.editReply({ embeds: [embed] });
    }
};
