const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config');
const ai = require('../services/gemini');
const { RateLimiter } = require('../utils/rateLimiter');
const { splitText, clip } = require('../utils/text');
const { grantSelfRole } = require('./selfRoles');

const COLOR = CONFIG.BOT.COLOR;
const MAX_CHUNKS = 3;               // أقصى عدد رسائل للرد الواحد
const NO_MENTIONS = { parse: [] };  // لا منشن أبداً من ردود الـ AI

const limiter = new RateLimiter({
    cooldownMs: CONFIG.AI.COOLDOWN_SECONDS * 1000,
    dailyLimit: CONFIG.AI.DAILY_LIMIT_PER_USER
});

async function resolveMember(interaction) {
    if (!interaction.inGuild()) return null;
    if (interaction.member?.roles?.add) return interaction.member;
    return interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
}

function buildContext(interaction, member) {
    const roleIds = member ? [...member.roles.cache.keys()] : [];
    return {
        serverName: interaction.guild?.name,
        displayName: member?.displayName ?? interaction.user.username,
        heldSelfRoles: Object.entries(CONFIG.SELF_ROLES)
            .filter(([, id]) => roleIds.includes(id))
            .map(([name]) => name)
    };
}

function answerEmbed(description, { query, user, model, first, imageUrl }) {
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setDescription(description)
        .setFooter({ text: `Not Human AI • ${user}${model ? ` • ${model}` : ''}` })
        .setTimestamp();

    if (first) {
        embed.setAuthor({ name: 'NOT HUMAN SERVICE • AI CORE' });
        if (imageUrl) embed.setThumbnail(imageUrl);
        embed.addFields({ name: '⌁ QUERY', value: '> ' + clip(query.replace(/\s+/g, ' '), 250) });
    }
    return embed;
}

async function sendAnswer(interaction, { text, query, model, isPrivate, imageUrl }) {
    let chunks = splitText(text, 4000);
    if (chunks.length > MAX_CHUNKS) {
        chunks = chunks.slice(0, MAX_CHUNKS);
        chunks[MAX_CHUNKS - 1] += '\n\n*…response truncated.*';
    }

    const meta = { query, user: interaction.user.username, model, imageUrl };

    await interaction.editReply({
        content: '',
        embeds: [answerEmbed(chunks[0], { ...meta, first: true })],
        allowedMentions: NO_MENTIONS
    });

    for (const chunk of chunks.slice(1)) {
        await interaction.followUp({
            embeds: [answerEmbed(chunk, { ...meta, first: false })],
            allowedMentions: NO_MENTIONS,
            ...(isPrivate ? { flags: MessageFlags.Ephemeral } : {})
        });
    }
}

async function logRoleGrant(interaction, role, reason) {
    if (!CONFIG.LOG_CHANNEL_ID) return;
    try {
        const channel = await interaction.client.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;
        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('🤖 AI Role Grant')
            .addFields(
                { name: 'Member', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                { name: 'Role', value: role.name, inline: true },
                { name: 'Member\'s message', value: '> ' + clip(reason.replace(/\s+/g, ' '), 900) }
            )
            .setTimestamp();
        await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
    } catch (err) {
        console.warn('⚠️ Could not write role log:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────
// /ask
// ─────────────────────────────────────────────────────────────
async function handleAsk(interaction) {
    const prompt = interaction.options.getString('prompt', true).trim();
    const isPrivate = interaction.options.getBoolean('private') ?? false;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const userId = interaction.user.id;

    if (prompt.length < 2) {
        return interaction.reply({ content: '❓ Please write a longer question.', flags: MessageFlags.Ephemeral });
    }

    // الصورة (اختيارية): نفحصها قبل استهلاك حد الطلبات
    const attachment = interaction.options.getAttachment('image');
    let image = null;
    if (attachment) {
        const check = ai.validateImage(attachment);
        if (!check.ok) {
            return interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
        }
        image = { url: attachment.url, mimeType: check.mimeType };
    }

    if (!isAdmin) {
        const gate = limiter.consume(userId);
        if (!gate.ok) {
            return interaction.reply({ content: gate.message, flags: MessageFlags.Ephemeral });
        }
    }

    try {
        await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});
    } catch (deferError) {
        console.warn('⚠️ Interaction expired or invalid:', deferError.message);
        if (!isAdmin) limiter.refund(userId);
        return;
    }

    try {
        const member = await resolveMember(interaction);

        const result = await ai.ask({
            userId,
            prompt,
            image,
            context: buildContext(interaction, member),
            tools: {
                grant_role: async ({ roleName, reply }) => {
                    const outcome = await grantSelfRole(member, roleName);
                    if (outcome.ok) {
                        await logRoleGrant(interaction, outcome.role, prompt);
                        return {
                            success: true,
                            text: clip(reply || `✅ Approved. You now have the **${outcome.role.name}** role!`, 1500)
                        };
                    }
                    return { success: false, text: outcome.message };
                }
            }
        });

        await sendAnswer(interaction, {
            text: result.text,
            query: prompt,
            model: result.toolUsed ? null : result.model,
            isPrivate,
            imageUrl: image?.url
        });
    } catch (err) {
        const isKnown = err instanceof ai.AIServiceError;
        if (!isKnown) console.error('❌ /ask failed:', err);
        // فشل الخدمة ليس ذنب العضو: نعيد له طلبه
        if (!isAdmin) limiter.refund(userId);

        await interaction.editReply({
            content: isKnown ? err.userMessage : '❌ An unexpected error occurred while processing your request.',
            embeds: [],
            allowedMentions: NO_MENTIONS
        }).catch(e => console.warn('⚠️ Could not send error reply:', e.message));
    }
}

// ─────────────────────────────────────────────────────────────
// /aireset — مسح ذاكرة المحادثة الخاصة بالعضو
// ─────────────────────────────────────────────────────────────
async function handleReset(interaction) {
    const had = ai.clearHistory(interaction.user.id);
    await interaction.reply({
        content: had ? '🧠 Conversation memory wiped. Fresh start.' : '🧠 There was nothing to forget.',
        flags: MessageFlags.Ephemeral
    });
}

module.exports = { handleAsk, handleReset };
