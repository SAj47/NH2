process.env.GEMINI_API_KEY = 'SECRET-KEY-123';
process.env.GEMINI_FALLBACK_MODELS = 'fallback-model';
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const CONFIG = require('../config');
const { createWorld, IDS } = require('./helpers/fakeDiscord');
const { runHealthCheck, formatReport } = require('../features/healthCheck');
const statusCmd = require('../commands/status');

const ORIG = { AUTO: [...CONFIG.AUTO_ROLES], GUILD: CONFIG.GUILD_ID, WC: CONFIG.WELCOME_CHANNEL_ID };
const has = (r, level, re) => r.items.some(i => i.level === level && re.test(i.text));
const okFetch = (methods = ['generateContent']) => async () => ({ ok: true, status: 200, json: async () => ({ supportedGenerationMethods: methods }) });

describe('فحص التشغيل الذاتي', () => {
    const worlds = [];
    const mk = async o => { const w = await createWorld(CONFIG, o); worlds.push(w); return w; };
    after(async () => { Object.assign(CONFIG, { AUTO_ROLES: ORIG.AUTO, GUILD_ID: ORIG.GUILD, WELCOME_CHANNEL_ID: ORIG.WC }); for (const w of worlds) await w.close(); });

    test('إعداد سليم: لا أخطاء (تحذير واحد فقط عن مثال beatmaker غير المُعدّ)', async () => {
        const w = await mk();
        const r = await runHealthCheck(w.client, { fetchFn: okFetch() });
        assert.equal(r.ok, true, r.lines.join('\n'));
        const nonOk = r.items.filter(i => i.level !== 'ok');
        assert.deepEqual(nonOk.map(i => i.level), ['warn']); assert.match(nonOk[0].text, /PUT_ROLE_ID_HERE/);
        assert.ok(has(r, 'ok', /Welcome channel #welcome/)); assert.ok(has(r, 'ok', /Log channels ready: 11\/11/));
        assert.ok(has(r, 'ok', /Auto role "Member"/)); assert.ok(has(r, 'ok', /Self role "Gamer"/));
        assert.ok(has(r, 'ok', /Welcome image assets\/welcome\.jpg/));
        assert.match(formatReport(r), /STARTUP CHECK/);
    });

    test('رتبة تلقائية أعلى من البوت → error بتعليمات الحل', async () => {
        const w = await mk(); CONFIG.AUTO_ROLES = [IDS.HIGH_ROLE, ORIG.AUTO[0]];
        const r = await runHealthCheck(w.client, { checkAIModel: false }); CONFIG.AUTO_ROLES = ORIG.AUTO;
        assert.equal(r.ok, false); assert.ok(has(r, 'error', /"Admin".*ABOVE it/), r.lines.join('\n'));
        assert.ok(has(r, 'ok', /Auto role "Member"/), 'الرتبة السليمة تظهر ok');
    });

    test('رتبة ID غير موجود، ورتبة قصيرة', async () => {
        const w = await mk(); CONFIG.AUTO_ROLES = ['123456789012345678', '12'];
        const r = await runHealthCheck(w.client, { checkAIModel: false }); CONFIG.AUTO_ROLES = ORIG.AUTO;
        assert.ok(has(r, 'error', /123456789012345678.*not found/)); assert.ok(has(r, 'warn', /invalid role ID "12"/));
    });

    test('البوت بلا Manage Roles و View Audit Log', async () => {
        const w = await mk({ botPerms: 0n });
        const r = await runHealthCheck(w.client, { checkAIModel: false });
        assert.ok(has(r, 'error', /Manage Roles/)); assert.ok(has(r, 'warn', /View Audit Log/));
    });

    test('قناة الترحيب مخفية أو ID خاطئ', async () => {
        let w = await mk({ welcomeAccess: 'hidden' });
        assert.ok(has(await runHealthCheck(w.client, { checkAIModel: false }), 'error', /Welcome channel #welcome: bot is missing/));
        w = await mk(); CONFIG.WELCOME_CHANNEL_ID = '111111111111111111';
        const r = await runHealthCheck(w.client, { checkAIModel: false }); CONFIG.WELCOME_CHANNEL_ID = ORIG.WC;
        assert.ok(has(r, 'error', /Welcome channel 111111111111111111 not found/));
    });

    test('قنوات Logs ناقصة → warn بأسمائها، وبلا صلاحية → error', async () => {
        let w = await mk({ omit: ['banned', 'rooms'] });
        let r = await runHealthCheck(w.client, { checkAIModel: false });
        assert.ok(has(r, 'warn', /Log channels ready: 9\/11/)); assert.ok(has(r, 'warn', /banned → "banned".*rooms → "rooms"|rooms → "rooms".*banned → "banned"/));
        w = await mk({ staffAccess: false });
        r = await runHealthCheck(w.client, { checkAIModel: false });
        assert.ok(has(r, 'error', /Bot cannot write in: .*#messages/), r.lines.join('\n'));
    });

    test('GUILD_ID خاطئ → يذكر السيرفرات التي فيها البوت', async () => {
        const w = await mk(); CONFIG.GUILD_ID = '222222222222222222';
        const r = await runHealthCheck(w.client, { checkAIModel: false }); CONFIG.GUILD_ID = ORIG.GUILD;
        assert.ok(has(r, 'error', /not in server 222222222222222222.*Test Server/));
    });

    test('ملف قديم متبقٍ → تحذير', async () => {
        const w = await mk(); const f = path.join(__dirname, '..', 'features', 'ask.js');
        fs.writeFileSync(f, '// old');
        try { assert.ok(has(await runHealthCheck(w.client, { checkAIModel: false }), 'warn', /Old files.*features\/ask\.js/)); }
        finally { fs.unlinkSync(f); }
    });

    describe('فحص نموذج Gemini', () => {
        const run = async fetchFn => runHealthCheck((await mk()).client, { fetchFn });
        test('يعمل ولا يسرّب المفتاح في الرابط', async () => {
            const seen = []; const r = await run(async (url, opts) => { seen.push({ url, opts }); return okFetch()(); });
            assert.ok(has(r, 'ok', /gemini-3\.6-flash" is available/)); assert.ok(has(r, 'ok', /fallback-model" is available/));
            assert.ok(seen.every(s => !s.url.includes('SECRET-KEY-123') && s.opts.headers['x-goog-api-key'] === 'SECRET-KEY-123'));
            assert.ok(r.lines.every(l => !l.includes('SECRET-KEY-123')), 'المفتاح لا يظهر في التقرير');
        });
        test('404: الأساسي error والبديل warn', async () => {
            const r = await run(async () => ({ ok: false, status: 404 }));
            assert.ok(has(r, 'error', /"gemini-3\.6-flash" NOT FOUND/)); assert.ok(has(r, 'warn', /"fallback-model" NOT FOUND/));
        });
        test('400/403: المفتاح مرفوض', async () => {
            for (const status of [400, 403]) assert.ok(has(await run(async () => ({ ok: false, status })), 'error', /API key was rejected/));
        });
        test('429 و 500 وانقطاع الشبكة: تحذير فقط', async () => {
            assert.ok(has(await run(async () => ({ ok: false, status: 429 })), 'warn', /rate limited/));
            assert.ok(has(await run(async () => ({ ok: false, status: 500 })), 'warn', /HTTP 500/));
            const r = await run(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
            assert.ok(has(r, 'warn', /Could not reach the Gemini API/)); assert.equal(r.items.filter(i => i.level === 'error').length, 0);
        });
        test('نموذج لا يدعم generateContent', async () => assert.ok(has(await run(okFetch(['embedContent'])), 'error', /does not support generateContent/)));
    });

    describe('/status', () => {
        const ix = (isAdmin, client) => { const out = []; return { out, memberPermissions: { has: () => isAdmin }, deferReply: async o => out.push(['defer', o]), editReply: async o => out.push(['edit', o]), reply: async o => out.push(['reply', o]) }; };
        test('أدمن: تقرير خاص (ephemeral) بملخص', async () => {
            const w = await mk(); const i = ix(true);
            const realFetch = globalThis.fetch; globalThis.fetch = okFetch();
            try { await statusCmd.execute(i, w.client); } finally { globalThis.fetch = realFetch; }
            assert.equal(i.out[0][1].flags, MessageFlags.Ephemeral);
            const e = i.out[1][1].embeds[0].toJSON(); assert.match(e.footer.text, /\d+ ok/); assert.ok(e.description.length > 50);
        });
        test('غير أدمن: مرفوض', async () => {
            const w = await mk(); const i = ix(false); await statusCmd.execute(i, w.client);
            assert.match(i.out[0][1].content, /Admins only/); assert.equal(i.out.length, 1);
        });
        test('الأمر مقيّد بصلاحية Administrator افتراضياً', () => assert.equal(statusCmd.data.toJSON().default_member_permissions, '8'));
    });
});
