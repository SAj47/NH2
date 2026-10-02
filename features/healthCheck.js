const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits: P } = require('discord.js');
const CONFIG = require('../config');
const { DEFAULT_CHANNEL_NAMES, getLogChannel } = require('./logService');
const { findWelcomeImage } = require('./welcome');
const { MODEL_CHAIN } = require('../services/gemini');

const ROOT = path.join(__dirname, '..');
const ICON = { ok: '✅', warn: '⚠️', error: '❌' };

// ملفات من النسخ القديمة إذا بقيت في المشروع قد تسبب تكرار الأحداث أو أخطاء
const LEGACY_FILES = [
    'commands/ai.js', 'events/logger.js',
    'features/ask.js', 'features/roles.js', 'features/logger.js', 'services/ai.js',
    'events/guildMemberAdd.js', 'events/logCacheWarmup.js', 'events/logMemberJoin.js',
    'events/logMemberLeave.js', 'events/logBanAdd.js', 'events/logBanRemove.js',
    'events/logMemberUpdate.js', 'events/logMessageDelete.js', 'events/logMessageUpdate.js',
    'events/logVoice.js'
];

const fetchChannel = async (guild, id) =>
    guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);

// ───────────────────────── الرتب ─────────────────────────
const SNOWFLAKE_RE = /^\d{15,25}$/;

async function checkRoles(guild, ids, label, add) {
    for (const id of ids) {
        if (!id || !SNOWFLAKE_RE.test(String(id))) {
            add('warn', `${label}: invalid role ID "${id}" — replace the placeholder in config.js with a real role ID.`);
            continue;
        }
        const role = guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
        if (!role) {
            add('error', `${label} role ${id} was not found in this server — fix the ID in config.js.`);
        } else if (!role.editable) {
            add('error', `${label} role "${role.name}": the bot cannot assign it. ` + (role.managed
                ? 'It is a managed (bot/integration) role and can never be assigned.'
                : "Move the bot's role ABOVE it in Server Settings > Roles."));
        } else {
            add('ok', `${label} role "${role.name}"`);
        }
    }
}

// ───────────────────────── السيرفر ─────────────────────────
async function checkGuild(guild, add) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    add('ok', `Server: ${guild.name} (${guild.memberCount} members)`);
    if (!me) { add('error', 'Could not load the bot member in this server.'); return; }

    // صلاحيات البوت العامة
    const usesRoles = (CONFIG.AUTO_ROLES?.length ?? 0) + (CONFIG.BOT_AUTO_ROLES?.length ?? 0) + Object.keys(CONFIG.SELF_ROLES ?? {}).length > 0;
    if (usesRoles) {
        if (me.permissions.has(P.ManageRoles)) add('ok', 'Bot has "Manage Roles"');
        else add('error', 'Bot is missing "Manage Roles" — auto roles / self roles cannot work.');
    }
    if (me.permissions.has(P.ViewAuditLog)) add('ok', 'Bot has "View Audit Log"');
    else add('warn', 'Bot is missing "View Audit Log" — logs will not show who performed each action.');

    // قناة الترحيب
    const wc = await fetchChannel(guild, CONFIG.WELCOME_CHANNEL_ID);
    if (!wc || !wc.isTextBased()) {
        add('error', `Welcome channel ${CONFIG.WELCOME_CHANNEL_ID} not found (or not a text channel) — fix WELCOME_CHANNEL_ID.`);
    } else {
        const need = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles];
        const missing = wc.permissionsFor(me)?.missing(need) ?? ['unknown'];
        if (missing.length) add('error', `Welcome channel #${wc.name}: bot is missing ${missing.join(', ')}.`);
        else add('ok', `Welcome channel #${wc.name}`);
    }

    // صورة الترحيب
    const img = findWelcomeImage();
    if (!img) {
        add('warn', 'No welcome image found (assets/welcome.jpg) — welcome cards will be sent without an image.');
    } else {
        const kb = Math.round(fs.statSync(img).size / 1024);
        if (kb > 3072) add('warn', `Welcome image ${path.relative(ROOT, img)} is ${kb} KB — large images can time out on slow connections. Use the .jpg version.`);
        else add('ok', `Welcome image ${path.relative(ROOT, img)} (${kb} KB)`);
    }

    // الرتب
    await checkRoles(guild, CONFIG.AUTO_ROLES ?? [], 'Auto', add);
    await checkRoles(guild, CONFIG.BOT_AUTO_ROLES ?? [], 'Bot auto', add);
    await checkRoles(guild, Object.values(CONFIG.SELF_ROLES ?? {}), 'Self', add);

    // قنوات الـ Logs
    if (CONFIG.LOGS?.ENABLED === false) {
        add('warn', 'Logs are disabled (LOGS.ENABLED = false).');
    } else {
        const keys = Object.keys(DEFAULT_CHANNEL_NAMES);
        const ready = []; const notFound = []; const noPerm = [];
        for (const key of keys) {
            const ch = await getLogChannel(guild, key);
            if (!ch) { notFound.push(`${key} → "${DEFAULT_CHANNEL_NAMES[key]}"`); continue; }
            const missing = ch.permissionsFor(me)?.missing([P.ViewChannel, P.SendMessages, P.EmbedLinks]) ?? ['unknown'];
            if (missing.length) noPerm.push(`#${ch.name} (${missing.join(', ')})`); else ready.push(ch.name);
        }
        add(ready.length === keys.length ? 'ok' : 'warn', `Log channels ready: ${ready.length}/${keys.length}`);
        if (notFound.length) add('warn', `Log channels not found inside category "${CONFIG.LOGS?.CATEGORY_NAME ?? 'Staff'}": ${notFound.join(' • ')} — create them, or set their IDs in config.js > LOGS.CHANNELS.`);
        if (noPerm.length) add('error', `Bot cannot write in: ${noPerm.join(' • ')} — give the bot's role View Channel + Send Messages + Embed Links (e.g. on the Staff category).`);
    }

    // قناة سجل رتب الـ AI (اختياري)
    if (CONFIG.LOG_CHANNEL_ID) {
        const lc = await fetchChannel(guild, CONFIG.LOG_CHANNEL_ID);
        if (!lc?.isTextBased()) add('error', `LOG_CHANNEL_ID ${CONFIG.LOG_CHANNEL_ID} not found (AI role-grant log).`);
        else add('ok', `AI role-grant log channel #${lc.name}`);
    }
}

// ───────────────────────── Gemini ─────────────────────────
// طلب معلومات النموذج فقط (لا يستهلك حصة الردود): يتأكد أن الاسم صحيح والمفتاح يعمل
async function checkAI(add, fetchFn) {
    const key = process.env.GEMINI_API_KEY;
    for (const [i, model] of MODEL_CHAIN.entries()) {
        const level = i === 0 ? 'error' : 'warn'; // الأساسي خطأ، البدائل تحذير
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
        try {
            const res = await fetchFn(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const info = await res.json().catch(() => ({}));
                const methods = info.supportedGenerationMethods;
                if (Array.isArray(methods) && !methods.includes('generateContent')) {
                    add(level, `AI model "${model}" exists but does not support generateContent.`);
                } else {
                    add('ok', `AI model "${model}" is available`);
                }
            } else if (res.status === 404) {
                add(level, `AI model "${model}" NOT FOUND — set a valid GEMINI_MODEL in .env (names are listed in Google AI Studio).`);
            } else if ([400, 401, 403].includes(res.status)) {
                add('error', `Gemini API key was rejected (HTTP ${res.status}) — check GEMINI_API_KEY in .env.`);
            } else if (res.status === 429) {
                add('warn', `Could not verify "${model}": rate limited (HTTP 429).`);
            } else {
                add('warn', `Could not verify "${model}": HTTP ${res.status}.`);
            }
        } catch (err) {
            add('warn', `Could not reach the Gemini API to verify "${model}" (${err.message}).`);
        }
    }
}

function checkLegacyFiles(add) {
    const found = LEGACY_FILES.filter(f => fs.existsSync(path.join(ROOT, f)));
    if (found.length) {
        add('warn', `Old files from a previous version still exist — delete them (they can cause duplicate messages/logs): ${found.join(', ')}`);
    }
}

// ───────────────────────── الواجهة ─────────────────────────
async function runHealthCheck(client, {
    checkAIModel = CONFIG.HEALTH_CHECK?.CHECK_AI_MODEL !== false,
    fetchFn = globalThis.fetch
} = {}) {
    const items = [];
    const add = (level, text) => items.push({ level, text });

    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
        const others = [...client.guilds.cache.values()].map(g => `${g.name} (${g.id})`).join(', ') || 'no servers';
        add('error', `The bot is not in server ${CONFIG.GUILD_ID}: GUILD_ID in config.js is wrong, or the bot was not invited. It is currently in: ${others}.`);
    } else {
        try { await checkGuild(guild, add); }
        catch (err) { add('error', `Health check crashed while inspecting the server: ${err.message}`); }
    }

    if (checkAIModel) await checkAI(add, fetchFn);
    checkLegacyFiles(add);

    const count = level => items.filter(i => i.level === level).length;
    return {
        items,
        lines: items.map(i => `${ICON[i.level]} ${i.text}`),
        summary: `${count('ok')} ok • ${count('warn')} warning(s) • ${count('error')} error(s)`,
        ok: count('error') === 0
    };
}

function formatReport(result) {
    return ['', '╔══ STARTUP CHECK ══════════════════════════════════',
        ...result.lines.map(l => '  ' + l),
        `╚══ ${result.summary}`, ''].join('\n');
}

module.exports = { runHealthCheck, formatReport, LEGACY_FILES };
