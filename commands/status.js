const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config');
const { runHealthCheck } = require('../features/healthCheck');
const { clip } = require('../utils/text');

// /status — تقرير فحص كامل للبوت (للأدمن فقط): القنوات، الرتب، الصلاحيات، الـ AI
module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Run a full self-check of the bot (admins only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '🚫 Admins only.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { lines, summary, ok } = await runHealthCheck(client);

        const embed = new EmbedBuilder()
            .setColor(ok ? CONFIG.BOT.COLOR : '#ED4245')
            .setTitle('🩺 Bot self-check')
            .setDescription(clip(lines.join('\n'), 4000))
            .setFooter({ text: summary })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
