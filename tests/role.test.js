const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { createWorld, validateEmbed, IDS } = require('./helpers/fakeDiscord');
const { findSelfRole } = require('../features/selfRoles');
const roleCmd = require('../commands/role');

const ORIG = { SELF_ROLES: { ...CONFIG.SELF_ROLES }, ALIASES: { ...CONFIG.ROLE_ALIASES } };
const ID = { gamer: CONFIG.SELF_ROLES.gamer, artist: '900000000000000101', gamedev: '900000000000000102' };

function quiet(fn) { const o = { e: console.error, w: console.warn, l: console.log }; console.error = console.warn = console.log = () => {}; return Promise.resolve(fn()).finally(() => Object.assign(console, { error: o.e, warn: o.w, log: o.l })); }

function fakeGuild(names) { // guild بسيط للاختبارات الوحدوية
    return { roles: { cache: new Map(Object.entries(names).map(([id, name]) => [id, { id, name }])) } };
}

// ═════════════════════════ المطابقة (بدون شبكة) ═════════════════════════
describe('مطابقة اسم الرتبة', () => {
    beforeEach(() => {
        CONFIG.SELF_ROLES = { gamer: ID.gamer, artist: ID.artist, gamedev: ID.gamedev };
        CONFIG.ROLE_ALIASES = { gamer: ['gaming', 'game', 'player', 'لاعب'], artist: ['drawing', 'رسام'] };
    });
    after(() => { CONFIG.SELF_ROLES = ORIG.SELF_ROLES; CONFIG.ROLE_ALIASES = ORIG.ALIASES; });
    const g = fakeGuild({ [ID.gamer]: 'Gamer 🎮', [ID.artist]: 'Artist', [ID.gamedev]: 'Game Dev' });
    const key = q => { const r = findSelfRole(g, q); return r.entry?.key ?? r.status; };

    for (const q of ['gamer', 'GAMER', '  Gamer  ', 'Gamer 🎮', 'g-a-m-e-r', 'gamer!!!']) {
        test(`تطابق تام: "${q}"`, () => assert.equal(key(q), 'gamer'));
    }
    for (const q of ['gamr', 'gammer', 'gamerr', 'gamers', 'gamre']) {
        test(`خطأ إملائي: "${q}" → gamer`, () => { const r = findSelfRole(g, q); assert.equal(r.entry?.key, 'gamer'); });
    }
    for (const q of ['gaming', 'player', 'لاعب', 'game']) {
        test(`اسم بديل: "${q}" → gamer`, () => assert.equal(key(q), 'gamer'));
    }
    test('جملة تحتوي الاسم', () => assert.equal(key('i want the gamer role please'), 'gamer'));
    test('رسام بالعربية', () => assert.equal(key('رسام'), 'artist'));
    test('اسم الرتبة الحقيقي مع مسافة: "game dev"', () => assert.equal(key('game dev'), 'gamedev'));
    test('"gam" يطابق أكثر من رتبة → ambiguous', () => {
        const r = findSelfRole(g, 'gam'); assert.equal(r.status, 'ambiguous'); assert.equal(r.options.length, 2);
    });
    for (const q of ['streamer', 'xbox', 'admin', 'vip', 'moderator', '', '   ', '🎮🎮🎮', 'ab', 'x', '123456', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        test(`لا يوجد شبيه: "${q}"`, () => assert.equal(key(q), 'none'));
    }
    test('نص طويل جداً لا يسبب مشكلة', () => {
        const t0 = Date.now(); findSelfRole(g, 'x'.repeat(5000)); assert.ok(Date.now() - t0 < 200);
    });
    test('لا رتب مُعدّة إطلاقاً', () => {
        CONFIG.SELF_ROLES = {}; assert.equal(findSelfRole(g, 'gamer').status, 'none');
    });
});

// ═════════════════════════ الأمر الكامل (ديسكورد وهمي) ═════════════════════════
describe('/role على ديسكورد وهمي', () => {
    let w;
    after(async () => { CONFIG.SELF_ROLES = ORIG.SELF_ROLES; CONFIG.ROLE_ALIASES = ORIG.ALIASES; if (w) await w.close(); });

    async function fresh(selfRoles = { gamer: ID.gamer, artist: ID.artist }, opts) {
        CONFIG.SELF_ROLES = selfRoles; CONFIG.ROLE_ALIASES = ORIG.ALIASES;
        if (w) await w.close();
        w = await createWorld(CONFIG, opts);
        return w;
    }
    function ix(member, { sub, name, focused }) {
        const replies = [];
        return { replies, inGuild: () => true, guild: w.guild, member, user: member.user,
            options: { getSubcommand: () => sub, getString: () => name, getFocused: () => focused ?? '' },
            deferReply: async o => replies.push({ type: 'defer', o }), editReply: async o => replies.push({ type: 'edit', o }),
            reply: async o => replies.push({ type: 'reply', o }), respond: async c => replies.push({ type: 'respond', c }) };
    }
    const run = async (member, args) => { const i = ix(member, args); await quiet(() => roleCmd.execute(i)); return i; };
    const embedOf = i => i.replies.find(r => r.type === 'edit').o.embeds[0].toJSON();

    test('add gamer: يمنح الرتبة برد خاص (ephemeral)', async () => {
        await fresh();
        const m = w.addMember(); const i = await run(m, { sub: 'add', name: 'gamer' });
        assert.deepEqual(w.api.rolePuts.map(r => [r.roleId, r.memberId]), [[ID.gamer, m.id]]);
        assert.ok(i.replies[0].o.flags, 'defer ephemeral');
        const e = embedOf(i); assert.match(e.title, /Role added/); assert.match(e.description, /Gamer/);
        assert.deepEqual(validateEmbed(e), []);
    });

    test('add بخطأ إملائي "gamr": يمنح ويذكر المطابقة', async () => {
        await fresh();
        const i = await run(w.addMember(), { sub: 'add', name: 'gamr' });
        assert.equal(w.api.rolePuts.length, 1);
        assert.match(embedOf(i).description, /I matched/);
    });

    test('add رتبة غير موجودة: اعتذار + "قريباً" ولا رتبة تُمنح', async () => {
        await fresh();
        const i = await run(w.addMember(), { sub: 'add', name: 'streamer' });
        assert.equal(w.api.rolePuts.length, 0);
        const e = embedOf(i);
        assert.match(e.title, /not available yet/);
        assert.match(e.description, /Sorry/); assert.match(e.description, /coming soon/); assert.match(e.description, /قريباً/);
        assert.match(e.fields[0].value, /Gamer/); assert.match(e.fields[0].value, /Artist/);
        assert.deepEqual(validateEmbed(e), []);
    });

    test('add وهو يملكها: لا طلب إلى ديسكورد', async () => {
        await fresh();
        const i = await run(w.addMember({ roles: [ID.gamer] }), { sub: 'add', name: 'gamer' });
        assert.equal(w.api.rolePuts.length, 0);
        assert.match(embedOf(i).description, /already have/);
    });

    test('add "gam" غامض: يسأل ولا يمنح', async () => {
        await fresh({ gamer: ID.gamer, gamedev: ID.gamedev });
        const i = await run(w.addMember(), { sub: 'add', name: 'gam' });
        assert.equal(w.api.rolePuts.length, 0); assert.match(embedOf(i).title, /Which one/);
    });

    test('add رتبة أعلى من البوت: رسالة واضحة', async () => {
        await fresh({ boss: IDS.HIGH_ROLE });
        const i = await run(w.addMember(), { sub: 'add', name: 'boss' });
        assert.equal(w.api.rolePuts.length, 0); assert.match(embedOf(i).description, /my role must be above/);
    });

    test('ديسكورد يرفض (403): لا انهيار', async () => {
        await fresh(); w.api.rolePutFails.add(ID.gamer);
        const i = await run(w.addMember(), { sub: 'add', name: 'gamer' });
        assert.match(embedOf(i).title, /Could not add/);
    });

    test('remove gamer وهو يملكها: يسحبها', async () => {
        await fresh();
        const m = w.addMember({ roles: [ID.gamer] }); const i = await run(m, { sub: 'remove', name: 'gamer' });
        assert.deepEqual(w.api.roleDeletes.map(r => [r.roleId, r.memberId]), [[ID.gamer, m.id]]);
        assert.match(embedOf(i).title, /Role removed/);
    });

    test('remove وهو لا يملكها: لا طلب', async () => {
        await fresh();
        const i = await run(w.addMember(), { sub: 'remove', name: 'gamer' });
        assert.equal(w.api.roleDeletes.length, 0); assert.match(embedOf(i).description, /don't have/);
    });

    test('remove admin: يُرفض دائماً (رتبة محمية) حتى لو يملكها', async () => {
        await fresh();
        const admin = w.guild.roles.cache.get(IDS.HIGH_ROLE);
        const i = await run(w.addMember({ roles: [IDS.HIGH_ROLE] }), { sub: 'remove', name: admin.name });
        assert.equal(w.api.roleDeletes.length, 0);
        const e = embedOf(i); assert.match(e.title, /Not allowed/); assert.match(e.description, /can't be removed/);
    });
    const addRole = (id, name, position = 1) => w.guild.roles._add({ id, name, position, permissions: '0', color: 0, hoist: false, managed: false, mentionable: false, flags: 0 });
    test('remove boy/girl/gay: تُرفض دائماً حتى لو العضو لا يملكها', async () => {
        await fresh();
        for (const [i2, name] of ['Boy', 'girl', 'GAY'].entries()) {
            addRole(`90000000000000020${i2}`, name);
            const i = await run(w.addMember(), { sub: 'remove', name }); // عضو جديد كل مرة (لا يصطدم بـ cooldown)
            assert.equal(w.api.roleDeletes.length, 0, name);
            assert.match(embedOf(i).title, /Not allowed/, name);
        }
    });
    test('remove رتبة عادية ليست في SELF_ROLES: تُزال طالما ليست محمية', async () => {
        await fresh();
        const extraId = '900000000000000210';
        addRole(extraId, 'Regular');
        const m = w.addMember({ roles: [extraId] });
        const i = await run(m, { sub: 'remove', name: 'Regular' });
        assert.deepEqual(w.api.roleDeletes.map(r => r.roleId), [extraId]);
        assert.match(embedOf(i).title, /Role removed/);
    });
    test('remove رتبة لا يملكها ولا هي محمية: "don\'t have"', async () => {
        await fresh();
        const i = await run(w.addMember(), { sub: 'remove', name: 'nonexistentrole' });
        assert.equal(w.api.roleDeletes.length, 0); assert.match(embedOf(i).description, /don't have/);
    });

    test('list: ✅ لما يملك و ▫️ لما لا يملك + "قريباً"', async () => {
        await fresh();
        const i = await run(w.addMember({ roles: [ID.gamer] }), { sub: 'list' });
        const e = embedOf(i);
        assert.match(e.description, /✅ \*\*Gamer\*\*/); assert.match(e.description, /▫️ \*\*Artist\*\*/); assert.match(e.description, /coming soon/);
    });

    test('لا رتب مُعدّة: add و list يقولان قريباً', async () => {
        await fresh({});
        assert.match(embedOf(await run(w.addMember(), { sub: 'add', name: 'gamer' })).fields[0].value, /none yet/);
        assert.match(embedOf(await run(w.addMember(), { sub: 'list' })).description, /coming soon/);
    });

    test('مدخلات خبيثة (منشن/ماركداون/مفاتيح prototype): آمنة وصالحة', async () => {
        await fresh();
        for (const name of ['@everyone', '**bold** <@123456789012345678> [x](http://e.vil)', 'constructor', '__proto__', '`'.repeat(50), 'a'.repeat(60)]) {
            const i = await run(w.addMember(), { sub: 'add', name });
            assert.equal(w.api.rolePuts.length, 0, name);
            const e = embedOf(i); assert.deepEqual(validateEmbed(e), [], name);
            assert.deepEqual(i.replies.find(r => r.type === 'edit').o.allowedMentions, { parse: [] });
        }
    });

    test('استخدام سريع متتابع: الثاني يُرفض (cooldown)', async () => {
        await fresh();
        const m = w.addMember();
        await run(m, { sub: 'list' });
        const i2 = await run(m, { sub: 'add', name: 'gamer' });
        assert.equal(w.api.rolePuts.length, 0);
        assert.match(i2.replies[0].o.content, /Cooling down/);
    });

    describe('الإكمال التلقائي', () => {
        const auto = async (member, sub, focused) => { const i = ix(member, { sub, focused }); await roleCmd.autocomplete(i); return i.replies[0].c; };
        test('add: يقترح فقط الرتب التي لا يملكها', async () => {
            await fresh();
            const c = await auto(w.addMember({ roles: [ID.gamer] }), 'add', '');
            assert.deepEqual(c, [{ name: 'Artist', value: 'artist' }]);
        });
        test('remove: يقترح فقط الرتب التي يملكها فعلياً (بالاسم)', async () => {
            await fresh();
            const c = await auto(w.addMember({ roles: [ID.gamer] }), 'remove', '');
            assert.deepEqual(c, [{ name: 'Gamer', value: 'Gamer' }]);
        });
        test('remove: لا يقترح رتبة محمية حتى لو يملكها', async () => {
            await fresh();
            const i = await run(w.addMember({ roles: [IDS.HIGH_ROLE] }), { sub: 'remove', name: 'Admin' });
            const c = await auto(w.addMember({ roles: [IDS.HIGH_ROLE] }), 'remove', '');
            assert.ok(!c.some(x => /admin/i.test(x.name)), JSON.stringify(c));
        });
        test('فلترة بما يكتبه', async () => {
            await fresh();
            assert.deepEqual((await auto(w.addMember(), 'add', 'gam')).map(x => x.value), ['gamer']);
            assert.deepEqual(await auto(w.addMember(), 'add', 'zzz'), []);
        });
        test('لا يتجاوز 25 اقتراحاً ولا 100 حرف', async () => {
            const many = {}; for (let n = 0; n < 40; n++) many['role' + n] = '9000000000000002' + String(10 + n);
            await fresh(many);
            const c = await auto(w.addMember(), 'add', '');
            assert.equal(c.length, 25); assert.ok(c.every(x => x.name.length <= 100 && x.value.length <= 100));
        });
    });

    test('تعريف الأمر صالح ويمكن تسجيله', () => {
        const j = roleCmd.data.toJSON();
        assert.equal(j.name, 'role'); assert.deepEqual(j.options.map(o => o.name), ['add', 'remove', 'list']);
        assert.ok(j.options[0].options[0].autocomplete);
    });
});
