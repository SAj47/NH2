const { SlashCommandBuilder } = require('discord.js');
const CONFIG = require('../config');
const { handleAsk } = require('../features/askHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask Not Human Service AI any question')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Enter your prompt or question')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(CONFIG.AI.MAX_PROMPT_LENGTH)
        )
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Attach an image for the AI to analyze (PNG, JPG, WEBP)')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('private')
                .setDescription('Only you can see the answer')
                .setRequired(false)
        ),
    execute: handleAsk
};
