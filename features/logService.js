const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config');
const { clip } = require('../utils/text');

const COLORS = {
    green: CONFIG.BOT.COLOR, red: '#ED4245', orange: '#F0A020',
    gray: '#95A5A6', blue: '#3498DB', purple: '#9B59B6', yellow: '#FEE75C'
};

// المفتاح -> اسم القناة كما في السيرفر (يُقارن بعد تجاهل الرموز مثل ・ و -)
const DEFAULT_CHANNEL_NAMES = {
    messages: 'messages',
    timeout:  'time-out',
    roles:    'roles',
    rooms:    'rooms',
    moved:    'mouved',
    muted:    'muted-demute',
    kicked:   'kicked',
    banned:   'banned',
    unbanned: 'unbanned',
    joins:    'join-membre',
    leaves:   'left-membre'
};

const normalize = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = ms => new Promise(res => setTimeout(res, ms));
const warned = new Set();
const settings = { auditDelayMs: 1200 }; // الـ audit log يتأخر لحظة عن الحدث

function warnOnce(key, text) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(text);
}

// إيجاد قناة السجل: أولاً بالـ ID من config، وإلا بالاسم داخل كاتيغوري Staff
async function getLogChannel(guild, key) {
    const configuredId = CONFIG.LOGS?.CHANNELS?.[key];
    if (configuredId) {
        return guild.channels.cache.get(configuredId)
            ?? await guild.channels.fetch(configuredId).catch(() => null);
    }

    const wanted = normalize(DEFAULT_CHANNEL_NAMES[key]);
    const category = normalize(CONFIG.LOGS?.CATEGORY_NAME ?? 'Staff');
    return guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        normalize(c.name) === wanted &&
        normalize(c.parent?.name) === category
    ) ?? null;
}

async function sendLog(guild, key, embed) {
    if (CONFIG.LOGS?.ENABLED === false) return;
    try {
        const channel = await getLogChannel(guild, key);
        if (!channel) {
            warnOnce(`missing:${key}`, `⚠️ Log channel "${key}" not found (expected "${DEFAULT_CHANNEL_NAMES[key]}" inside category "${CONFIG.LOGS?.CATEGORY_NAME ?? 'Staff'}"). Set its ID in config.js > LOGS.CHANNELS.`);
            return;
        }
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
        warnOnce(`send:${key}`, `⚠️ Could not write to log "${key}": ${err.message} (give the bot View Channel + Send Messages + Embed Links in that channel).`);
    }
}

function logEmbed({ color = COLORS.gray, title, user, description, fields = [] }) {
    const embed = new EmbedBuilder().setColor(color).setTitle(clip(title, 250)).setTimestamp();
    if (description) embed.setDescription(clip(description, 4000));
    if (fields.length) {
        embed.addFields(fields.map(f => ({
            name: clip(f.name, 250),
            value: clip(f.value || '—', 1024),
            inline: f.inline ?? true
        })));
    }
    if (user) {
        embed.setAuthor({
            name: clip(user.tag ?? user.username ?? 'unknown', 250),
            iconURL: user.displayAvatarURL?.() ?? undefined
        });
        embed.setFooter({ text: `ID: ${user.id}` });
    }
    return embed;
}

// البحث في Audit Log عن إجراء حديث (لمعرفة من نفّذ الإجراء والسبب).
// يحتاج صلاحية View Audit Log. إذا لم تتوفر يرجع null والسجل يُكتب بدون المنفّذ.
async function findRecentAudit(guild, { actions, match = () => true, maxAgeMs = 15_000, delayMs = settings.auditDelayMs }) {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        warnOnce('audit-perm', '⚠️ Bot lacks "View Audit Log" permission — logs will not show who performed actions.');
        return null;
    }
    if (delayMs) await sleep(delayMs); // الـ audit log يتأخر لحظة عن الحدث
    try {
        const logs = await guild.fetchAuditLogs({ limit: 10 });
        return logs.entries.find(e =>
            actions.includes(e.action) &&
            Date.now() - e.createdTimestamp <= maxAgeMs &&
            match(e)
        ) ?? null;
    } catch (err) {
        console.warn('⚠️ Audit log fetch failed:', err.message);
        return null;
    }
}

const who = entry => entry?.executor ? `${entry.executor} (${entry.executor.tag ?? entry.executor.username})` : 'Unknown';
const changed = (entry, key) => !!entry?.changes?.some(c => c.key === key);

module.exports = { settings, COLORS, DEFAULT_CHANNEL_NAMES, normalize, getLogChannel, sendLog, logEmbed, findRecentAudit, who, changed };
