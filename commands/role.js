const { SlashCommandBuilder, EmbedBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const CONFIG = require('../config');
const { RateLimiter } = require('../utils/rateLimiter');
const { clip } = require('../utils/text');
const {
    findSelfRole, getSelfRoleEntries, grantSelfRole, norm,
    removeAnyRole, getMemberRemovableRoles
} = require('../features/selfRoles');

// ════════════════════════════════════════════════════════════════
//  /role add <name>     ← اطلب رتبة (تُفهم الأخطاء الإملائية والأسماء البديلة)
//  /role remove <name>  ← أزل رتبة عن نفسك
//  /role list           ← الرتب المتاحة وما تملكه منها
//  الرتب المتاحة تُحدَّد في config.js > SELF_ROLES
// ════════════════════════════════════════════════════════════════
const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const NO_MENTIONS = { parse: [] };
const COLOR = { ok: CONFIG.BOT.COLOR, warn: '#F0A020', info: '#3498DB' };

const limiter = new RateLimiter({
    cooldownMs: (CONFIG.ROLE_COMMAND?.COOLDOWN_SECONDS ?? 5) * 1000,
    dailyLimit: 0
});

const card = (color, title, description, fields = []) =>
    new EmbedBuilder().setColor(color).setTitle(title).setDescription(clip(description, 4000))
        .addFields(fields).setTimestamp();

const show = q => escapeMarkdown(clip(String(q).replace(/\s+/g, ' '), 60));
const availableList = entries => entries.length ? entries.map(e => `• **${e.name}**`).join('\n') : '*(none yet)*';

async function resolveMember(interaction) {
    if (interaction.member?.roles?.add) return interaction.member;
    return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

const notAvailable = (query, entries) => card(
    COLOR.warn, '😔 Role not available yet',
    `Sorry, I couldn't find a role like **“${show(query)}”**.\n` +
    `It isn't available right now — **it's coming soon!** 🚀\n\n` +
    `عذراً، لم أجد هذه الرتبة حالياً، وستكون متاحة **قريباً** إن شاء الله.`,
    [{ name: 'Available now', value: availableList(entries) }]
);

const ambiguous = (query, options) => card(
    COLOR.info, '🤔 Which one do you mean?',
    `“${show(query)}” matches more than one role. Please be more specific:`,
    [{ name: 'Matches', value: availableList(options) }]
);

// ───────────────────────── add ─────────────────────────
async function handleAdd(interaction, member) {
    const query = interaction.options.getString('name', true);
    const found = findSelfRole(interaction.guild, query);

    if (found.status === 'none') return notAvailable(query, found.entries);
    if (found.status === 'ambiguous') return ambiguous(query, found.options);

    const result = await grantSelfRole(member, found.entry.key);
    if (!result.ok) return card(result.alreadyHad ? COLOR.info : COLOR.warn, result.alreadyHad ? 'ℹ️ Nothing to do' : '⚠️ Could not add the role', result.message);

    const note = found.status === 'close' ? `\n*I matched “${show(query)}” to **${result.role.name}**.*` : '';
    return card(COLOR.ok, '✅ Role added', `You now have the **${result.role.name}** role.${note}`);
}

// ───────────────────────── remove ─────────────────────────
// يعمل مع أي رتبة يملكها العضو (وليس فقط SELF_ROLES)، عدا الرتب المحمية في config.js > PROTECTED_ROLES
async function handleRemove(interaction, member) {
    const query = interaction.options.getString('name', true);
    const result = await removeAnyRole(member, query);

    if (!result.ok) {
        if (result.ambiguous) return ambiguous(query, result.options);
        return card(result.protected ? COLOR.warn : (result.notFound ? COLOR.info : COLOR.warn),
            result.protected ? '🙏 Not allowed' : (result.notFound ? '🔎 Role not found' : '⚠️ Could not remove the role'),
            result.message);
    }

    const note = result.matched ? `\n*I matched “${show(query)}” to **${result.role.name}**.*` : '';
    return card(COLOR.ok, '✅ Role removed', `The **${result.role.name}** role was removed.${note}`);
}

// ───────────────────────── list ─────────────────────────
function handleList(interaction, member) {
    const entries = getSelfRoleEntries(interaction.guild);
    if (entries.length === 0) {
        return card(COLOR.info, '🎭 Self-assignable roles', 'No roles are available yet — **coming soon!** 🚀');
    }
    const lines = entries.map(e => `${member?.roles?.cache?.has(e.id) ? '✅' : '▫️'} **${e.name}**`);
    return card(COLOR.info, '🎭 Self-assignable roles',
        lines.join('\n') + '\n\n`/role add` • `/role remove`\n*More roles are coming soon!*');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Request or remove a self-assignable role')
        .addSubcommand(s => s.setName('add')
            .setDescription('Request a role')
            .addStringOption(o => o.setName('name').setDescription('The role you want').setRequired(true).setAutocomplete(true).setMaxLength(60)))
        .addSubcommand(s => s.setName('remove')
            .setDescription('Remove one of your self-assignable roles')
            .addStringOption(o => o.setName('name').setDescription('The role to remove').setRequired(true).setAutocomplete(true).setMaxLength(60)))
        .addSubcommand(s => s.setName('list')
            .setDescription('Show the available roles and which ones you have')),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.guild) {
            return interaction.reply({ content: 'This command only works inside the server.', ...EPHEMERAL });
        }

        const gate = limiter.consume(interaction.user.id);
        if (!gate.ok) return interaction.reply({ content: gate.message, ...EPHEMERAL });

        await interaction.deferReply(EPHEMERAL);
        try {
            const member = await resolveMember(interaction);
            const sub = interaction.options.getSubcommand();
            const embed = sub === 'add' ? await handleAdd(interaction, member)
                : sub === 'remove' ? await handleRemove(interaction, member)
                : handleList(interaction, member);
            await interaction.editReply({ embeds: [embed], allowedMentions: NO_MENTIONS });
        } catch (err) {
            console.error('❌ /role failed:', err);
            await interaction.editReply({ content: '❌ Something went wrong. Please try again.', embeds: [] }).catch(() => {});
        }
    },

    // اقتراحات أثناء الكتابة:
    //  add    = رتب SELF_ROLES التي لا يملكها بعد
    //  remove = كل رتب العضو الفعلية القابلة للإزالة (عدا المحمية)
    async autocomplete(interaction) {
        if (!interaction.guild) return interaction.respond([]);
        const sub = interaction.options.getSubcommand(false);
        const q = norm(interaction.options.getFocused());

        if (sub === 'remove') {
            const member = interaction.member?.roles?.cache ? interaction.member : null;
            if (!member) return interaction.respond([]);
            const pool = getMemberRemovableRoles(member).filter(e => !q || e.terms.some(t => t.includes(q)));
            return interaction.respond(pool.slice(0, 25).map(e => ({ name: clip(e.name, 100), value: e.name })));
        }

        const roles = interaction.member?.roles;
        const has = id => Array.isArray(roles) ? roles.includes(id) : !!roles?.cache?.has(id);
        const pool = getSelfRoleEntries(interaction.guild)
            .filter(e => !has(e.id))
            .filter(e => !q || e.terms.some(t => t.includes(q)));
        await interaction.respond(pool.slice(0, 25).map(e => ({ name: clip(e.name, 100), value: e.key })));
    }
};
