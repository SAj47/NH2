const { SlashCommandBuilder } = require('discord.js');
const { handleReset } = require('../features/askHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aireset')
        .setDescription('Make the AI forget your current conversation'),
    execute: handleReset
};
