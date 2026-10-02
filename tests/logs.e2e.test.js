const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { AuditLogEvent, GuildBan, VoiceState, SnowflakeUtil, ChannelType } = require('discord.js');
const CONFIG = require('../config');
const { createWorld, validateEmbed, IDS } = require('./helpers/fakeDiscord');
const logService = require('../features/logService');

const load = f => require(`../events/logs/${f}`);
const quiet = async fn => { const o = { e: console.error, w: console.warn, l: console.log }; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { Object.assign(console, { error: o.e, warn: o.w, log: o.l }); } };

describe('نظام الـ Logs (كائنات حقيقية + audit log وهمي)', () => {
    let w;
    before(async () => { logService.settings.auditDelayMs = 0; w = await createWorld(CONFIG); });
    after(async () => { await w.close(); });
    beforeEach(() => { w.api.reset(); });

    const modUser = { id: IDS.MOD, username: 'mod', discriminator: '0', avatar: null, bot: false };
    const audit = (action, targetId, extra = {}) => {
        const targetUser = { id: targetId, username: 'target', discriminator: '0', avatar: null, bot: false };
        w.api.auditUsers.push(modUser, targetUser);
        w.api.auditEntries.push({ id: SnowflakeUtil.generate().toString(), action_type: action, user_id: IDS.MOD, target_id: targetId, reason: 'because', changes: [], ...extra });
    };
    // يرجع { قناة-السجل: [embeds] } من الطلبات المسجلة
    const posted = () => {
        const out = {};
        for (const p of w.api.posts) (out[w.guild.channels.cache.get(p.channelId).name] ??= []).push(...p.payload.embeds);
        return out;
    };
    const only = (name) => {
        const p = posted(); assert.deepEqual(Object.keys(p), [name], 'أُرسل إلى: ' + Object.keys(p).join(','));
        assert.equal(p[name].length, 1);
        assert.deepEqual(validateEmbed(p[name][0]), [], 'embed غير صالح');
        assert.equal(w.api.posts[0].payload.allowed_mentions.parse.length, 0, 'لا منشن');
        return p[name][0];
    };
    const field = (e, name) => e.fields?.find(f => f.name.includes(name))?.value;

    test('دخول عضو → join-membre (+ تحذير حساب جديد)', async () => {
        const m = w.addMember({ username: 'newbie' });
        await quiet(() => load('memberJoin').execute(m));
        const e = only('join-membre'); assert.match(e.title, /Member joined/);
        assert.match(e.author.name, /newbie/); assert.ok(field(e, 'Account created'));
    });

    test('حظر → banned مع المنفّذ والسبب من audit log', async () => {
        const m = w.addMember({ username: 'baddie' });
        audit(AuditLogEvent.MemberBanAdd, m.id);
        const ban = new GuildBan(w.client, { user: m.user.toJSON ? { id: m.id, username: 'baddie', discriminator: '0', avatar: null } : {}, reason: 'spam' }, w.guild);
        await quiet(() => load('banAdd').execute(ban));
        const e = only('banned'); assert.match(field(e, 'Banned by'), /mod/); assert.equal(field(e, 'Reason'), 'because');
    });

    test('فك حظر → unbanned', async () => {
        const m = w.addMember(); audit(AuditLogEvent.MemberBanRemove, m.id);
        const ban = new GuildBan(w.client, { user: { id: m.id, username: 'x', discriminator: '0', avatar: null }, reason: null }, w.guild);
        await quiet(() => load('banRemove').execute(ban));
        assert.match(field(only('unbanned'), 'Unbanned by'), /mod/);
    });

    test('خروج بعد طرد (Kick) → kicked وليس left-membre', async () => {
        const m = w.addMember(); audit(AuditLogEvent.MemberKick, m.id);
        await quiet(() => load('memberLeave').execute(m));
        const e = only('kicked'); assert.match(field(e, 'Kicked by'), /mod/); assert.equal(field(e, 'Reason'), 'because');
    });

    test('خروج بعد حظر → لا شيء في left-membre (banned يتولاه)', async () => {
        const m = w.addMember(); audit(AuditLogEvent.MemberBanAdd, m.id);
        await quiet(() => load('memberLeave').execute(m));
        assert.equal(w.api.posts.length, 0);
    });

    test('خروج عادي → left-membre مع الرتب ومدة العضوية', async () => {
        const m = w.addMember({ roles: [CONFIG.AUTO_ROLES[0]] });
        await quiet(() => load('memberLeave').execute(m));
        const e = only('left-membre'); assert.match(field(e, 'Roles'), /<@&/); assert.ok(field(e, 'Joined'));
    });

    test('خروج بعد kick لعضو آخر (audit قديم لا يخصه) → left-membre', async () => {
        const other = w.addMember(); audit(AuditLogEvent.MemberKick, other.id);
        const m = w.addMember();
        await quiet(() => load('memberLeave').execute(m));
        only('left-membre');
    });

    test('تغيير رتب → roles (Added/Removed + By)', async () => {
        const old = w.addMember({ roles: [CONFIG.AUTO_ROLES[0]] });
        const cur = old._clone(); cur._roles = [CONFIG.AUTO_ROLES[1]];
        audit(AuditLogEvent.MemberRoleUpdate, old.id);
        await quiet(() => load('memberUpdate').execute(old, cur));
        const e = only('roles');
        assert.ok(field(e, 'Added').includes(CONFIG.AUTO_ROLES[1])); assert.ok(field(e, 'Removed').includes(CONFIG.AUTO_ROLES[0]));
        assert.match(field(e, 'By'), /mod/);
    });

    test('تايم أوت → time・out ثم إزالته', async () => {
        const old = w.addMember();
        const timed = old._clone(); timed._patch({ communication_disabled_until: new Date(Date.now() + 3_600_000).toISOString() });
        audit(AuditLogEvent.MemberUpdate, old.id, { changes: [{ key: 'communication_disabled_until', new: 'x' }] });
        await quiet(() => load('memberUpdate').execute(old, timed));
        let e = only('time・out'); assert.match(e.title, /timed out/); assert.match(field(e, 'By'), /mod/); assert.match(field(e, 'Until'), /<t:\d+:F>/);

        w.api.reset(); audit(AuditLogEvent.MemberUpdate, old.id, { changes: [{ key: 'communication_disabled_until', old: 'x' }] });
        const cleared = timed._clone(); cleared._patch({ communication_disabled_until: null });
        await quiet(() => load('memberUpdate').execute(timed, cleared));
        e = only('time・out'); assert.match(e.title, /removed/);
    });

    test('تغيير لا علاقة له (لقب) → لا سجل', async () => {
        const old = w.addMember(); const cur = old._clone(); cur._patch({ nick: 'new nick' });
        await quiet(() => load('memberUpdate').execute(old, cur));
        assert.equal(w.api.posts.length, 0);
    });

    describe('الرسائل', () => {
        const mkMsg = (author, content = 'hello\nworld', extra = {}) => w.chan('welcome').messages._add({
            id: SnowflakeUtil.generate().toString(), channel_id: w.chan('welcome').id, guild_id: w.GUILD, type: 0,
            author: { id: author.id, username: author.user.username, discriminator: '0', avatar: null, bot: author.user.bot },
            content, timestamp: new Date().toISOString(), edited_timestamp: null, tts: false, mention_everyone: false,
            mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, flags: 0, ...extra
        });

        test('حذف رسالة → messages مع النص بصيغة اقتباس', async () => {
            const a = w.addMember(); const msg = mkMsg(a);
            await quiet(() => load('messageDelete').execute(msg));
            const e = only('messages'); assert.match(e.title, /deleted/); assert.match(e.description, /> hello\n> world/);
            assert.match(field(e, 'Deleted by'), /Author \/ unknown/);
        });

        test('حذف بواسطة مشرف (audit MESSAGE_DELETE) → يذكر المشرف', async () => {
            const a = w.addMember(); const msg = mkMsg(a);
            audit(AuditLogEvent.MessageDelete, a.id, { options: { channel_id: w.chan('welcome').id, count: '1' } });
            await quiet(() => load('messageDelete').execute(msg));
            assert.match(field(only('messages'), 'Deleted by'), /mod/);
        });

        test('رسالة بوت لا تُسجَّل', async () => {
            const b = w.addMember({ bot: true }); await quiet(() => load('messageDelete').execute(mkMsg(b)));
            assert.equal(w.api.posts.length, 0);
        });

        test('رسالة طويلة (4000 حرف) + مرفقات + رموز: embed يبقى صالحاً', async () => {
            const a = w.addMember();
            const msg = mkMsg(a, '@everyone ```' + 'ب'.repeat(4000) + '```', {
                attachments: [{ id: '1', filename: 'a.png', size: 1, url: 'https://cdn.discordapp.com/a.png', proxy_url: 'https://cdn.discordapp.com/a.png' }] });
            await quiet(() => load('messageDelete').execute(msg));
            only('messages');
        });

        test('تعديل رسالة → messages (قبل/بعد) ورابط', async () => {
            const a = w.addMember(); const old = mkMsg(a, 'before text'); const cur = old._clone(); cur._patch({ content: 'after text', edited_timestamp: new Date().toISOString() });
            await quiet(() => load('messageUpdate').execute(old, cur));
            const e = only('messages'); assert.equal(field(e, 'Before'), 'before text'); assert.equal(field(e, 'After'), 'after text');
            assert.match(e.description, /Jump to message/);
        });

        test('تعديل بلا تغيير نص (embed فقط) → لا سجل', async () => {
            const a = w.addMember(); const old = mkMsg(a, 'same'); const cur = old._clone(); cur._patch({ embeds: [{ title: 'preview' }] });
            await quiet(() => load('messageUpdate').execute(old, cur));
            assert.equal(w.api.posts.length, 0);
        });
    });

    describe('الصوت', () => {
        const vs = (member, channelId, extra = {}) => new VoiceState(w.guild, { user_id: member.id, channel_id: channelId, session_id: 's', deaf: false, mute: false, self_deaf: false, self_mute: false, suppress: false, ...extra });
        const A = '920000000000000001', B = '920000000000000002';

        test('دخول صوتي → rooms', async () => {
            const m = w.addMember(); await quiet(() => load('voice').execute(vs(m, null), vs(m, A)));
            const e = only('rooms'); assert.match(e.title, /Joined voice/); assert.match(e.description, /<#920000000000000001>/);
        });
        test('خروج صوتي → rooms', async () => {
            const m = w.addMember(); await quiet(() => load('voice').execute(vs(m, A), vs(m, null)));
            assert.match(only('rooms').title, /Left voice/);
        });
        test('انتقال → mouved (نقله مشرف)', async () => {
            const m = w.addMember(); audit(AuditLogEvent.MemberMove, m.id, { target_id: null, options: { channel_id: B, count: '1' } });
            await quiet(() => load('voice').execute(vs(m, A), vs(m, B)));
            const e = only('mouved'); assert.equal(field(e, 'From'), '<#920000000000000001>'); assert.equal(field(e, 'To'), '<#920000000000000002>');
            assert.match(field(e, 'Moved by'), /mod/);
        });
        test('انتقال ذاتي → mouved "Self / unknown"', async () => {
            const m = w.addMember(); await quiet(() => load('voice').execute(vs(m, A), vs(m, B)));
            assert.match(field(only('mouved'), 'Moved by'), /Self/);
        });
        test('كتم من الإدارة → muted・demute', async () => {
            const m = w.addMember(); audit(AuditLogEvent.MemberUpdate, m.id, { changes: [{ key: 'mute', new: true }] });
            await quiet(() => load('voice').execute(vs(m, A), vs(m, A, { mute: true })));
            const e = only('muted・demute'); assert.match(e.title, /Server muted/); assert.match(field(e, 'By'), /mod/);
        });
        test('كتم ذاتي (self mute) لا يُسجَّل', async () => {
            const m = w.addMember(); await quiet(() => load('voice').execute(vs(m, A), vs(m, A, { self_mute: true })));
            assert.equal(w.api.posts.length, 0);
        });
    });

    test('قناة السجل مفقودة/بلا صلاحية: لا انهيار', async () => {
        const w2 = await createWorld(CONFIG, { omit: ['banned'], staffAccess: false });
        try {
            const m = w2.addMember();
            const ban = new GuildBan(w2.client, { user: { id: m.id, username: 'x', discriminator: '0', avatar: null }, reason: null }, w2.guild);
            await quiet(() => load('banAdd').execute(ban));
            assert.equal(w2.api.posts.length, 0);
        } finally { await w2.close(); }
    });

    test('بلا صلاحية View Audit Log: يعمل بدون اسم المنفّذ', async () => {
        const w2 = await createWorld(CONFIG, { botPerms: 0n, staffAccess: true });
        try {
            const m = w2.addMember({ roles: [] });
            const ban = new GuildBan(w2.client, { user: { id: m.id, username: 'x', discriminator: '0', avatar: null }, reason: 'r' }, w2.guild);
            await quiet(() => load('banAdd').execute(ban));
            const p = w2.api.posts; assert.equal(p.length, 1);
            assert.match(p[0].payload.embeds[0].fields.find(f => f.name === 'Banned by').value, /Unknown/);
            assert.equal(p[0].payload.embeds[0].fields.find(f => f.name === 'Reason').value, 'r');
        } finally { await w2.close(); }
    });
});
