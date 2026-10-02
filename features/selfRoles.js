const CONFIG = require('../config');
const { clip } = require('../utils/text');

// ─────────────────────────────────────────────────────────────
// أدوات المطابقة: تجاهل الحروف الكبيرة والرموز والإيموجي (تدعم العربية)
// ─────────────────────────────────────────────────────────────
const norm = s => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

function levenshtein(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

// ─────────────────────────────────────────────────────────────
// قائمة الرتب الذاتية: [{ key, id, role, name, terms }]
// terms = الكلمات التي تُطابَق: المفتاح + اسم الرتبة الحقيقي + الأسماء البديلة (ROLE_ALIASES)
// ─────────────────────────────────────────────────────────────
function getSelfRoleEntries(guild) {
    return Object.entries(CONFIG.SELF_ROLES ?? {}).map(([key, id]) => {
        const role = guild.roles.cache.get(id) ?? null;
        const name = role?.name ?? key;
        const terms = [...new Set([key, name, ...(CONFIG.ROLE_ALIASES?.[key] ?? [])].map(norm).filter(Boolean))];
        return { key, id, role, name, terms };
    });
}

// البحث عن رتبة بنص كتبه العضو. النتيجة:
//  { status: 'exact' | 'close' | 'ambiguous' | 'none', entry?, options?, entries }
function findSelfRole(guild, query) {
    const entries = getSelfRoleEntries(guild);
    const q = norm(query);
    if (!q || entries.length === 0) return { status: 'none', entries };

    // 1) تطابق تام
    const exact = entries.filter(e => e.terms.includes(q));
    if (exact.length === 1) return { status: 'exact', entry: exact[0], entries };
    if (exact.length > 1) return { status: 'ambiguous', options: exact, entries };

    // 2) احتواء (مثل: "i want gamer" تحتوي gamer) — بشرط 3 أحرف فأكثر
    if (q.length >= 3) {
        const contained = entries.filter(e => e.terms.some(t => t.length >= 3 && (t.includes(q) || q.includes(t))));
        if (contained.length === 1) return { status: 'close', entry: contained[0], entries };
        if (contained.length > 1) return { status: 'ambiguous', options: contained, entries };
    }

    // 3) أخطاء إملائية بسيطة (gamr → gamer) — بشرط 4 أحرف فأكثر
    if (q.length >= 4) {
        const scored = entries
            .map(e => ({ e, score: Math.max(...e.terms.map(t => similarity(q, t))) }))
            .sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best.score >= 0.7) {
            const tied = scored.filter(s => s.score === best.score);
            if (tied.length > 1) return { status: 'ambiguous', options: tied.map(s => s.e), entries };
            return { status: 'close', entry: best.e, entries };
        }
    }

    return { status: 'none', entries };
}

// ─────────────────────────────────────────────────────────────
// منح / سحب رتبة ذاتية. التحقق النهائي هنا (الرتبة مسموحة؟ موجودة؟ البوت يستطيع؟)
// ─────────────────────────────────────────────────────────────
async function resolveManageableRole(member, roleName) {
    const key = String(roleName ?? '').toLowerCase().trim();

    // hasOwn بدل [] حتى لا يمرّ مفتاح مثل "constructor" أو "__proto__"
    if (!key || !Object.hasOwn(CONFIG.SELF_ROLES, key)) {
        return { error: `❌ The role **${clip(key || 'unknown', 40)}** isn't available for self-assignment.` };
    }
    if (!member?.roles?.add) {
        return { error: '❌ I could not load your member profile. Please try again.' };
    }

    const role = await member.guild.roles.fetch(CONFIG.SELF_ROLES[key]).catch(() => null);
    if (!role) {
        console.error(`❌ Self-role "${key}": role ID ${CONFIG.SELF_ROLES[key]} not found in guild.`);
        return { error: '❌ That role is misconfigured. Please tell a server admin.' };
    }
    if (!role.editable) {
        console.error(`❌ Self-role "${role.name}": bot cannot manage it (move the bot's role above it).`);
        return { error: "❌ I can't manage that role right now — my role must be above it. Please tell a server admin." };
    }
    return { key, role };
}

async function grantSelfRole(member, roleName) {
    try {
        const r = await resolveManageableRole(member, roleName);
        if (r.error) return { ok: false, message: r.error };

        if (member.roles.cache.has(r.role.id)) {
            return { ok: false, alreadyHad: true, message: `You already have the **${r.role.name}** role. ✅` };
        }
        await member.roles.add(r.role, 'Self-role requested by member');
        return { ok: true, role: r.role };
    } catch (error) {
        console.error(`❌ Failed to assign self-role (${roleName}):`, error.message);
        return { ok: false, message: "❌ I couldn't assign the role. Please tell a server admin to check my permissions." };
    }
}

async function removeSelfRole(member, roleName) {
    try {
        const r = await resolveManageableRole(member, roleName);
        if (r.error) return { ok: false, message: r.error };

        if (!member.roles.cache.has(r.role.id)) {
            return { ok: false, didNotHave: true, message: `You don't have the **${r.role.name}** role.` };
        }
        await member.roles.remove(r.role, 'Self-role removed by member');
        return { ok: true, role: r.role };
    } catch (error) {
        console.error(`❌ Failed to remove self-role (${roleName}):`, error.message);
        return { ok: false, message: "❌ I couldn't remove the role. Please tell a server admin to check my permissions." };
    }
}

// ─────────────────────────────────────────────────────────────
// /role remove على أي رتبة حقيقية (وليس فقط SELF_ROLES)، عدا رتب محمية
// ─────────────────────────────────────────────────────────────
const protectedTerms = () => new Set((CONFIG.PROTECTED_ROLES ?? []).map(norm));

function isProtectedRoleName(name) {
    return protectedTerms().has(norm(name));
}

// كل رتب العضو الفعلية القابلة للإزالة (تُستخدم في الإكمال التلقائي لـ /role remove)
function getMemberRemovableRoles(member) {
    return member.roles.cache
        .filter(r => r.id !== member.guild.id && !r.managed && !isProtectedRoleName(r.name))
        .map(r => ({ id: r.id, name: r.name, terms: [norm(r.name)] }));
}

// البحث عن رتبة يملكها العضو بالاسم الذي كتبه (تطابق تام، ثم احتواء، ثم تشابه إملائي)
function findMemberRole(member, query) {
    const entries = getMemberRemovableRoles(member);
    const q = norm(query);
    if (!q || entries.length === 0) return { status: 'none', entries };

    const exact = entries.filter(e => e.terms.includes(q));
    if (exact.length === 1) return { status: 'exact', entry: exact[0], entries };
    if (exact.length > 1) return { status: 'ambiguous', options: exact, entries };

    if (q.length >= 3) {
        const contained = entries.filter(e => e.terms.some(t => t.length >= 3 && (t.includes(q) || q.includes(t))));
        if (contained.length === 1) return { status: 'close', entry: contained[0], entries };
        if (contained.length > 1) return { status: 'ambiguous', options: contained, entries };
    }

    if (q.length >= 4) {
        const scored = entries.map(e => ({ e, score: similarity(q, e.terms[0]) })).sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best && best.score >= 0.7) {
            const tied = scored.filter(s => s.score === best.score);
            if (tied.length > 1) return { status: 'ambiguous', options: tied.map(s => s.e), entries };
            return { status: 'close', entry: best.e, entries };
        }
    }

    return { status: 'none', entries };
}

// يحاول مطابقة الاسم مع رتبة **محمية** في السيرفر (حتى لو العضو لا يملكها) — ليعطي رسالة اعتذار واضحة
function findProtectedRoleMatch(guild, query) {
    const q = norm(query);
    if (!q) return null;
    const protectedRoles = guild.roles.cache.filter(r => isProtectedRoleName(r.name));
    for (const role of protectedRoles.values()) {
        if (norm(role.name) === q) return role;
    }
    // تشابه إملائي بسيط أيضاً (مثل "admn")
    for (const role of protectedRoles.values()) {
        if (q.length >= 3 && similarity(q, norm(role.name)) >= 0.75) return role;
    }
    return null;
}

async function removeAnyRole(member, roleName) {
    const protectedMatch = findProtectedRoleMatch(member.guild, roleName);
    if (protectedMatch) {
        return { ok: false, protected: true, message: `🙏 Sorry, the **${protectedMatch.name}** role can't be removed with this command. Please ask a staff member.` };
    }

    const found = findMemberRole(member, roleName);
    if (found.status === 'ambiguous') return { ok: false, ambiguous: true, options: found.options };
    if (found.status === 'none') return { ok: false, notFound: true, message: `You don't have a role like **"${clip(roleName, 40)}"**.` };

    const role = member.guild.roles.cache.get(found.entry.id);
    if (!role) return { ok: false, message: '❌ That role no longer exists.' };
    if (isProtectedRoleName(role.name)) {
        return { ok: false, protected: true, message: `🙏 Sorry, the **${role.name}** role can't be removed with this command. Please ask a staff member.` };
    }
    if (!role.editable) {
        console.error(`❌ Role "${role.name}": bot cannot manage it (move the bot's role above it).`);
        return { ok: false, message: "❌ I can't remove that role right now — my role must be above it. Please tell a server admin." };
    }

    try {
        await member.roles.remove(role, 'Role removed by member via /role remove');
        return { ok: true, role, matched: found.status === 'close' };
    } catch (error) {
        console.error(`❌ Failed to remove role (${role.name}):`, error.message);
        return { ok: false, message: "❌ I couldn't remove the role. Please tell a server admin to check my permissions." };
    }
}

module.exports = {
    grantSelfRole, removeSelfRole, findSelfRole, getSelfRoleEntries, norm,
    removeAnyRole, findMemberRole, getMemberRemovableRoles, isProtectedRoleName
};
