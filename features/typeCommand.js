const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config');
const { clip } = require('../utils/text');

const PREFIX = '!type';
const NO_MENTIONS = { parse: [] };

// يبحث عن الرتبة المخوَّلة: بالـ ID من config أولاً، وإلا بالاسم "typing"
function findAuthorizedRole(guild) {
    if (CONFIG.ROLES?.TYPING_ROLE_ID) {
        return guild.roles.cache.get(CONFIG.ROLES.TYPING_ROLE_ID) ?? null;
    }
    return guild.roles.cache.find(r => r.name.toLowerCase() === 'typing') ?? null;
}

function isAuthorized(member, role) {
    return !!role && member.roles.cache.has(role.id);
}

// رسالة "مجهَّزة": بطاقة منسّقة بدل نص عادي منسوخ
function buildAnnouncement(content) {
    return new EmbedBuilder()
        .setColor(CONFIG.BOT.COLOR)
        .setAuthor({ name: 'NOT HUMAN SERVICE • TRANSMISSION' })
        .setDescription(clip(content, 4000))
        .setTimestamp();
}

// حذف رسالة (إن أمكن) بعد مهلة، بدون رمي خطأ إن فشل
async function deleteAfter(message, ms) {
    if (ms > 0) await new Promise(res => setTimeout(res, ms));
    await message.delete().catch(() => {});
}

async function handleTypeCommand(message) {
    if (!message.guild || message.author.bot) return false;
    const lower = message.content.toLowerCase();
    if (lower !== PREFIX && !lower.startsWith(PREFIX + ' ')) return false;

    const role = findAuthorizedRole(message.guild);
    if (!role) {
        console.error('❌ !type: no "typing" role found — set ROLES.TYPING_ROLE_ID in config.js or create a role named "typing".');
        return true;
    }

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!isAuthorized(member, role)) return true; // صامت لغير المخوَّلين

    const content = message.content.slice(PREFIX.length).trim();
    if (!content) {
        const warn = await message.reply({ content: `❓ Usage: \`${PREFIX} <message>\`` }).catch(() => null);
        if (warn) deleteAfter(warn, CONFIG.TYPE_COMMAND?.USAGE_WARNING_DELETE_MS ?? 5000);
        return true;
    }

    const canDelete = message.guild.members.me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages);
    if (canDelete) await message.delete().catch(() => {});

    await message.channel.send({ embeds: [buildAnnouncement(content)], allowedMentions: NO_MENTIONS });
    return true;
}

module.exports = { handleTypeCommand, PREFIX, findAuthorizedRole };
