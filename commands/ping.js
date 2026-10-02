const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const CONFIG = require('../config');

// مثال بسيط لأمر: /ping
module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot latency'),

    async execute(interaction, client) {
        const embed = new EmbedBuilder()
            .setColor(CONFIG.BOT.COLOR)
            .setTitle('🏓 Pong!')
            .setDescription(`> **Gateway:** \`${client.ws.ping}ms\``)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
