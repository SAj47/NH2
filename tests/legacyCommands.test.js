const { test, describe, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { createWorld, validateEmbed } = require('./helpers/fakeDiscord');
const { handleTypeCommand } = require('../features/typeCommand');
const { handleWelcmCommand, resendWelcomeToAll } = require('../features/welcomeAll');
const legacyEvent = require('../events/legacyCommands');
const quiet = async fn => { const o = { e: console.error, w: console.warn, l: console.log }; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { Object.assign(console, { error: o.e, warn: o.w, log: o.l }); } };

// message.channel يجب أن يكون قناة ديسكورد حقيقية (permissionsIn تحتاج قناة قابلة للحل)،
// لذا نستخدم قناة حقيقية من العالم الوهمي ونستبدل send فقط.
// القناة الافتراضية "general" (وليست "welcome") حتى لا يتصادم mock.method مع channel.send
// الحقيقي الذي يستخدمه sendWelcome() على نفس كائن قناة الترحيب المشترك في اختبارات !welcm.
function fakeMessage(w, { author, content, canDelete = true, channel } = {}) {
    const sent = []; const deletes = [];
    const realChannel = channel ?? w.chan('general');
    mock.method(realChannel, 'send', async o => { const m = typeof o === 'string' ? { content: o } : { ...o }; sent.push(m); return { edit: async patch => Object.assign(m, typeof patch === 'string' ? { content: patch } : patch), delete: async () => deletes.push('sent-msg') }; });
    return {
        sent, deletes, guild: w.guild, author: author.user, member: author, channel: realChannel, content,
        reply: async o => { const m = typeof o === 'string' ? { content: o } : { ...o }; sent.push(m); return { content: m.content, delete: async () => deletes.push('reply-msg') }; },
        delete: async () => { if (!canDelete) throw new Error('no perm'); deletes.push('trigger'); }
    };
}

describe('!type (رتبة typing فقط، رسالة مجهَّزة)', () => {
    let w;
    after(async () => { CONFIG.ROLES.TYPING_ROLE_ID = ''; if (w) await w.close(); });
    const TYPING_ID = '900000000000000301';
    async function fresh() { if (w) await w.close(); w = await createWorld(CONFIG); w.guild.roles._add({ id: TYPING_ID, name: 'typing', position: 1, permissions: '0', color: 0, hoist: false, managed: false, mentionable: false, flags: 0 }); CONFIG.ROLES.TYPING_ROLE_ID = TYPING_ID; }

    test('عضو مخوَّل: يُحذف الأصل وتُرسل بطاقة مجهزة', async () => {
        await fresh();
        const m = w.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: m, content: '!type Server maintenance at 10pm.' });
        const handled = await quiet(() => handleTypeCommand(msg));
        assert.equal(handled, true);
        assert.deepEqual(msg.deletes, ['trigger']);
        assert.equal(msg.sent.length, 1);
        const e = msg.sent[0].embeds[0].toJSON();
        assert.match(e.description, /Server maintenance at 10pm/); assert.match(e.author.name, /TRANSMISSION/);
        assert.deepEqual(validateEmbed(e), []);
        assert.deepEqual(msg.sent[0].allowedMentions, { parse: [] });
    });

    test('عضو غير مخوَّل: صامت تماماً (لا رد ولا حذف)', async () => {
        await fresh();
        const m = w.addMember();
        const msg = fakeMessage(w, { author: m, content: '!type hack the mainframe' });
        assert.equal(await handleTypeCommand(msg), true);
        assert.equal(msg.sent.length, 0); assert.equal(msg.deletes.length, 0);
    });

    test('رسالة عادية (لا تبدأ بـ !type): تُتجاهل بلا لمس', async () => {
        await fresh();
        const m = w.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: m, content: 'hello there' });
        assert.equal(await handleTypeCommand(msg), false);
        assert.equal(msg.sent.length, 0);
    });

    test('!type بلا نص: تحذير استخدام يُحذف تلقائياً', async () => {
        await fresh();
        CONFIG.TYPE_COMMAND.USAGE_WARNING_DELETE_MS = 15; // سريع في الاختبارات
        const m = w.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: m, content: '!type' });
        await handleTypeCommand(msg);
        assert.equal(msg.sent.length, 1); assert.match(msg.sent[0].content, /Usage/);
        await new Promise(r => setTimeout(r, 60));
        assert.deepEqual(msg.deletes, ['reply-msg']);
        CONFIG.TYPE_COMMAND.USAGE_WARNING_DELETE_MS = 5000;
    });

    test('رسالة بوت: تُتجاهل', async () => {
        await fresh();
        const b = w.addMember({ bot: true, roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: b, content: '!type spam' });
        assert.equal(await handleTypeCommand(msg), false);
    });

    test('بلا صلاحية Manage Messages: لا يُحذف الأصل لكن الإعلان يُرسل', async () => {
        await fresh();
        const w2 = await createWorld(CONFIG, { botPerms: 0n }); CONFIG.ROLES.TYPING_ROLE_ID = '';
        w2.guild.roles._add({ id: TYPING_ID, name: 'typing', position: 1, permissions: '0', color: 0, hoist: false, managed: false, mentionable: false, flags: 0 });
        const m = w2.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w2, { author: m, content: '!type no perms here', canDelete: false });
        await handleTypeCommand(msg);
        assert.equal(msg.sent.length, 1); assert.equal(msg.deletes.length, 0);
        await w2.close();
    });

    test('لا توجد رتبة typing مُعدّة: يُبلَّغ في الـ console ولا انهيار', async () => {
        await fresh(); CONFIG.ROLES.TYPING_ROLE_ID = ''; w.guild.roles.cache.delete(TYPING_ID);
        const m = w.addMember();
        const msg = fakeMessage(w, { author: m, content: '!type x' });
        const { logs } = await (async () => { const l = []; const o = console.error; console.error = (...a) => l.push(a.join(' ')); await handleTypeCommand(msg); console.error = o; return { logs: l }; })();
        assert.ok(logs.some(l => /no "typing" role/.test(l)));
    });

    test('حقن ماركداون/منشن في نص الرسالة: embed يبقى صالحاً بلا منشن', async () => {
        await fresh();
        const m = w.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: m, content: '!type @everyone <@123456789012345678> ```code``` ' + 'x'.repeat(4500) });
        await handleTypeCommand(msg);
        const e = msg.sent[0].embeds[0].toJSON();
        assert.deepEqual(validateEmbed(e), []);
        assert.deepEqual(msg.sent[0].allowedMentions, { parse: [] });
    });

    test('عبر events/legacyCommands.js: يوجّه الرسالة إلى !type', async () => {
        await fresh();
        const m = w.addMember({ roles: [TYPING_ID] });
        const msg = fakeMessage(w, { author: m, content: '!type routed ok' });
        await legacyEvent.execute(msg);
        assert.equal(msg.sent.length, 1); assert.match(msg.sent[0].embeds[0].toJSON().description, /routed ok/);
    });
});

describe('!welcm (رتبة staff فقط، إعادة ترحيب الجميع)', () => {
    let w;
    const STAFF_ID = '900000000000000401';
    after(async () => { CONFIG.ROLES.STAFF_ROLE_ID = ''; CONFIG.WELCM.DELAY_MS = 2000; if (w) await w.close(); });
    async function fresh(memberCount = 3) {
        if (w) await w.close(); w = await createWorld(CONFIG);
        w.guild.roles._add({ id: STAFF_ID, name: 'staff', position: 8, permissions: '0', color: 0, hoist: false, managed: false, mentionable: false, flags: 0 });
        CONFIG.ROLES.STAFF_ROLE_ID = STAFF_ID; CONFIG.WELCM.DELAY_MS = 5; // سريع في الاختبارات
        for (let i = 0; i < memberCount; i++) w.addMember({ username: 'm' + i });
    }

    test('staff: يعيد ترحيب كل الأعضاء البشر (لا البوت نفسه)', async () => {
        await fresh(4);
        const staff = w.addMember({ roles: [STAFF_ID] });
        w.api.reset();
        const msg = fakeMessage(w, { author: staff, content: '!welcm' });
        await handleWelcmCommand(msg);
        // 4 أعضاء + staff نفسه = 5 بشر، البوت نفسه مُستثنى دائماً
        assert.equal(w.api.posts.length, 5);
        assert.ok(w.api.posts.every(p => p.channelId === CONFIG.WELCOME_CHANNEL_ID));
        // status.edit() يعدّل نفس الكائن، فبنهاية التنفيذ نرى الحالة النهائية (Done!)
        assert.match(msg.sent[0].content, /Done!.*5\/5/s);
    });

    test('غير staff: صامت تماماً', async () => {
        await fresh(2); w.api.reset();
        const m = w.addMember();
        const msg = fakeMessage(w, { author: m, content: '!welcm' });
        await handleWelcmCommand(msg);
        assert.equal(w.api.posts.length, 0); assert.equal(msg.sent.length, 0);
    });

    test('تشغيل متزامن: الثاني يُرفض بلطف', async () => {
        await fresh(3); const staff = w.addMember({ roles: [STAFF_ID] }); w.api.reset();
        const p1 = handleWelcmCommand(fakeMessage(w, { author: staff, content: '!welcm' }));
        await new Promise(r => setTimeout(r, 1));
        const msg2 = fakeMessage(w, { author: staff, content: '!welcm' });
        await handleWelcmCommand(msg2);
        await p1;
        assert.match(msg2.sent[0].content, /already running/);
    });

    test('فشل إرسال لعضو واحد لا يوقف الباقي', async () => {
        await fresh(3); const staff = w.addMember({ roles: [STAFF_ID] }); w.api.reset();
        w.api.messagePlans.push({ status: 500 });
        await quiet(() => handleWelcmCommand(fakeMessage(w, { author: staff, content: '!welcm' })));
        // 4 أعضاء (m0,m1,m2 + staff). العضو الأول يفشل مرة (500) ثم sendWelcome يعيد المحاولة بلا صورة وينجح،
        // فذلك العضو يترك طلبين (فشل+نجاح) والباقون طلباً واحداً لكل منهم = 4 + 1 = 5 طلبات مسجّلة، وكلهم رُحِّب بهم فعلياً
        assert.equal(w.api.posts.length, 5);
    });

    test('لا يُعيد تعيين الرتب التلقائية (العضو يملكها أصلاً، لا PUT جديد)', async () => {
        await fresh(0); const staff = w.addMember({ roles: [STAFF_ID, ...CONFIG.AUTO_ROLES] }); w.api.reset();
        await handleWelcmCommand(fakeMessage(w, { author: staff, content: '!welcm' }));
        assert.equal(w.api.rolePuts.length, 0);
    });

    test('WELCM.INCLUDE_BOTS=false (الافتراضي): بوت آخر لا يُرحَّب به', async () => {
        await fresh(1); const staff = w.addMember({ roles: [STAFF_ID] }); w.addMember({ bot: true, username: 'OtherBot' }); w.api.reset();
        await handleWelcmCommand(fakeMessage(w, { author: staff, content: '!welcm' }));
        assert.equal(w.api.posts.length, 2); // العضو + staff فقط، بدون البوت الآخر
    });

    test('resendWelcomeToAll مباشرة: تقرير صحيح', async () => {
        await fresh(3); w.api.reset();
        const progress = [];
        const result = await resendWelcomeToAll(w.guild, { onProgress: p => progress.push({ ...p }) });
        assert.equal(result.started, true); assert.equal(result.total, 3); assert.equal(result.failed, 0);
        assert.equal(progress.at(-1).done, 3);
    });
});
