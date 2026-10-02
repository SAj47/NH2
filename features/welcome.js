const { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config');
const { cleanInline } = require('../utils/text');

// ─────────────────────────────────────────────────────────────
// صورة الترحيب: يفضّل .jpg (أخف بكثير) ثم .png، داخل assets/ أو بجانب index.js
// ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const IMAGE_CANDIDATES = [
    path.join(ROOT, 'assets', 'welcome.jpg'),
    path.join(ROOT, 'assets', 'welcome.png'),
    path.join(ROOT, 'welcome.jpg'),
    path.join(ROOT, 'welcome.png')
];

function findWelcomeImage() {
    return IMAGE_CANDIDATES.find(f => fs.existsSync(f)) ?? null;
}

// ─────────────────────────────────────────────────────────────
// منع التكرار لفترة قصيرة فقط (30 ثانية) بدل المنع للأبد
// (الحل القديم كان يمنع الرتب والترحيب عن أي عضو يخرج ويدخل مرة ثانية)
// ─────────────────────────────────────────────────────────────
const DEDUPE_WINDOW_MS = 30 * 1000;
const recentlyHandled = new Map();

function isDuplicate(member) {
    const now = Date.now();
    for (const [key, time] of recentlyHandled) {
        if (now - time > DEDUPE_WINDOW_MS) recentlyHandled.delete(key);
    }
    const key = `${member.guild.id}:${member.id}`;
    if (recentlyHandled.has(key)) return true;
    recentlyHandled.set(key, now);
    return false;
}

// ─────────────────────────────────────────────────────────────
// الرتب التلقائية: رتبة رتبة (حتى لو فشلت واحدة تكمل الباقي)
// ─────────────────────────────────────────────────────────────
async function assignAutoRoles(member) {
    const list = member.user.bot ? CONFIG.BOT_AUTO_ROLES : CONFIG.AUTO_ROLES;
    const roleIds = (list || []).filter(id => id && id.length > 5);
    if (roleIds.length === 0) return;

    const me = member.guild.members.me ?? await member.guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        console.error('❌ Auto-role: البوت ما عنده صلاحية Manage Roles.');
        return;
    }

    for (const roleId of roleIds) {
        const role = member.guild.roles.cache.get(roleId)
            ?? await member.guild.roles.fetch(roleId).catch(() => null);

        if (!role) {
            console.error(`❌ Auto-role: الرتبة ${roleId} غير موجودة في هذا السيرفر (تأكد من الـ ID).`);
            continue;
        }

        // editable = false إذا: الرتبة أعلى/تساوي رتبة البوت، أو رتبة بوت/تكامل (managed)
        if (!role.editable) {
            console.error(
                `❌ Auto-role: البوت لا يستطيع إعطاء رتبة "${role.name}". ` +
                `ارفع رتبة البوت فوقها في Server Settings > Roles (أو الرتبة managed).`
            );
            continue;
        }

        try {
            // رتبة واحدة في كل طلب (PUT) حتى لا نمسح رتباً أضافها بوت آخر في نفس اللحظة
            await member.roles.add(role, 'Auto-role on join');
            console.log(`✅ Auto-role "${role.name}" assigned to: ${member.user.tag}`);
        } catch (err) {
            console.error(`❌ Auto-role "${role.name}" failed for ${member.user.tag}:`, err.message);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// رسالة الترحيب
// ─────────────────────────────────────────────────────────────
async function sendWelcome(member) {
    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID)
        ?? await member.guild.channels.fetch(CONFIG.WELCOME_CHANNEL_ID).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        console.error(`❌ Welcome channel not found or not a text channel: ${CONFIG.WELCOME_CHANNEL_ID}`);
        return;
    }

    // فحص صلاحيات البوت في قناة الترحيب
    const me = member.guild.members.me ?? await member.guild.members.fetchMe();
    const missing = channel.permissionsFor(me)?.missing([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles
    ]);
    if (!missing || missing.length > 0) {
        console.error(`❌ Welcome: البوت ينقصه صلاحيات في القناة: ${missing ? missing.join(', ') : 'unknown'}`);
        return;
    }

    const files = [];
    let imageUrl = null;
    const imagePath = findWelcomeImage();
    if (imagePath) {
        const imageName = path.basename(imagePath);
        files.push(new AttachmentBuilder(imagePath, { name: imageName }));
        imageUrl = `attachment://${imageName}`;
    } else {
        console.warn('⚠️ welcome image not found (assets/welcome.jpg or welcome.png)');
    }

    const isBot = member.user.bot;
    // تنظيف الأسماء حتى لا تكسر الـ code block أو الـ `inline code`
    const safeName = cleanInline(member.user.username);
    const safeTag = cleanInline(member.user.tag);

    const embed = new EmbedBuilder()
        .setColor(CONFIG.BOT.COLOR)
        .setAuthor({
            name: 'NOT HUMAN SERVICE • INGRESS PROTOCOL',
            iconURL: member.guild.iconURL() ?? undefined
        })
        .setTitle(`>>> NEW ${isBot ? 'SYNTHETIC UNIT' : 'SUBJECT'} DETECTED: ${safeName.toUpperCase()}`.slice(0, 256))
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(
            '```yaml\n' +
            `[SYSTEM LOG]: NEW ${isBot ? 'BOT' : 'HUMAN ENTITY'} ARRIVED\n` +
            '[STATUS]: VERIFIED & LOGGED\n' +
            `[DIRECTIVE]: Welcome to the core network, ${safeName}.\n` +
            '```'
        )
        .addFields(
            {
                name: '👤 Identity Profile',
                value: `> **User:** ${member}\n> **Tag:** \`${safeTag}\`\n> **Type:** \`${isBot ? 'Bot 🤖' : 'Human 👤'}\``,
                inline: true
            },
            {
                name: '📊 System Metrics',
                value: `> **Humanity:** \`${isBot ? '0%' : '100%'}\`\n> **Community:** \`100%\`\n> **Power Level:** \`∞\``,
                inline: true
            }
        )
        .setFooter({
            text: `NOT HUMAN SYSTEM • Member #${member.guild.memberCount}`,
            iconURL: member.user.displayAvatarURL()
        })
        .setTimestamp();

    if (imageUrl) embed.setImage(imageUrl);

    const payload = {
        content: `⚠️ **INCOMING TRANSMISSION** | Welcome ${member}!`,
        embeds: [embed],
        files,
        allowedMentions: { users: [member.id] }
    };

    try {
        await channel.send(payload);
    } catch (err) {
        // "This operation was aborted" = انتهت مهلة رفع الصورة. نرسل الترحيب بدون صورة بدل أن يضيع
        if (files.length === 0) throw err;
        console.warn(`⚠️ Send with image failed (${err.message}). Retrying without image...`);
        embed.setImage(null);
        await channel.send({ ...payload, files: [] });
    }

    console.log(`✅ Welcome card sent for: ${member.user.tag}`);
}

// ─────────────────────────────────────────────────────────────
async function handleNewMember(member) {
    if (!member || !member.user) return;

    // تجاهل البوت نفسه
    if (member.user.id === member.client.user.id) return;

    if (isDuplicate(member)) {
        console.log(`⚠️ Duplicate guildMemberAdd ignored for: ${member.user.tag}`);
        return;
    }

    console.log(`\n--- [PROCESSING NEW ENTRY: ${member.user.tag}] ---`);

    // الرتب والترحيب مستقلان: فشل أحدهما لا يوقف الآخر
    const results = await Promise.allSettled([sendWelcome(member), assignAutoRoles(member)]);
    for (const r of results) {
        if (r.status === 'rejected') {
            console.error(`❌ Join handling error for ${member.user.tag}:`, r.reason?.message ?? r.reason);
        }
    }
}

module.exports = { handleNewMember, findWelcomeImage, sendWelcome, assignAutoRoles, _internals: { recentlyHandled } };
