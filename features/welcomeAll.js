const CONFIG = require('../config');
const { sendWelcome } = require('./welcome');

const PREFIX = '!welcm';
const running = new Set(); // guild IDs قيد إعادة الترحيب حالياً (يمنع تشغيل متزامن)

function findAuthorizedRole(guild) {
    if (CONFIG.ROLES?.STAFF_ROLE_ID) {
        return guild.roles.cache.get(CONFIG.ROLES.STAFF_ROLE_ID) ?? null;
    }
    return guild.roles.cache.find(r => r.name.toLowerCase() === 'staff') ?? null;
}

function isAuthorized(member, role) {
    return !!role && member.roles.cache.has(role.id);
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

// يعيد إرسال بطاقة الترحيب لكل الأعضاء الحاليين (بدون إعادة الرتب التلقائية — العضو أصلاً يملكها)
async function resendWelcomeToAll(guild, { onProgress } = {}) {
    if (running.has(guild.id)) return { started: false };
    running.add(guild.id);

    try {
        await guild.members.fetch().catch(() => {});
        const includeBots = CONFIG.WELCM?.INCLUDE_BOTS === true;
        const targets = guild.members.cache.filter(m => includeBots || !m.user.bot);

        let done = 0, failed = 0;
        const total = targets.size;
        for (const member of targets.values()) {
            try {
                await sendWelcome(member);
            } catch (err) {
                failed++;
                console.error(`❌ Re-welcome failed for ${member.user.tag}:`, err.message);
            }
            done++;
            if (onProgress) { try { await onProgress({ done, total, failed }); } catch {} }
            if (done < total) await sleep(CONFIG.WELCM?.DELAY_MS ?? 2000);
        }
        return { started: true, total, failed };
    } finally {
        running.delete(guild.id);
    }
}

async function handleWelcmCommand(message) {
    if (!message.guild || message.author.bot) return false;
    if (message.content.toLowerCase().trim() !== PREFIX) return false;

    const role = findAuthorizedRole(message.guild);
    if (!role) {
        console.error('❌ !welcm: no "staff" role found — set ROLES.STAFF_ROLE_ID in config.js or create a role named "staff".');
        return true;
    }

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!isAuthorized(member, role)) return true; // صامت لغير المخوَّلين

    if (running.has(message.guild.id)) {
        await message.reply('⏳ A re-welcome is already running — please wait for it to finish.').catch(() => {});
        return true;
    }

    const total = message.guild.memberCount;
    const etaSec = Math.ceil((total * (CONFIG.WELCM?.DELAY_MS ?? 2000)) / 1000);
    const status = await message.channel.send(
        `🔄 Re-welcoming up to **${total}** members as if the bot just joined... ETA ~${etaSec}s.`
    ).catch(() => null);

    const result = await resendWelcomeToAll(message.guild, {
        onProgress: async ({ done, total: t, failed }) => {
            if (status && (done % 10 === 0 || done === t)) {
                await status.edit(`🔄 Re-welcoming... **${done}/${t}**${failed ? ` (${failed} failed)` : ''}`).catch(() => {});
            }
        }
    });

    const summary = result.started
        ? `✅ Done! Re-welcomed **${result.total - result.failed}/${result.total}** member(s).${result.failed ? ` ⚠️ ${result.failed} failed (see console).` : ''}\nNormal welcome-on-join keeps working as usual.`
        : '⏳ A re-welcome is already running.';

    if (status) await status.edit(summary).catch(() => {});
    else await message.channel.send(summary).catch(() => {});
    return true;
}

module.exports = { handleWelcmCommand, resendWelcomeToAll, PREFIX, findAuthorizedRole };
