const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { leave } = require('../features/voiceControl');

// /leave — يخرج البوت من أي روم صوتي هو فيه في هذا السيرفر
module.exports = {
    data: new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
    async execute(interaction) {
        if (!interaction.inGuild()) return interaction.reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral });
        const result = leave(interaction.guild);
        await interaction.reply({ content: result.ok ? '👋 Left the voice channel.' : result.message, flags: MessageFlags.Ephemeral });
    }
};
