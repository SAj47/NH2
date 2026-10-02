const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const { createWorld, validateEmbed, IDS } = require('./helpers/fakeDiscord');
const welcome = require('../features/welcome');

const ORIGINAL_AUTO = [...CONFIG.AUTO_ROLES];
const IMG = path.join(__dirname, '..', 'assets', 'welcome.jpg');

// نلتقط console حتى نتحقق من رسائل التشخيص
function capture() {
    const logs = { error: [], warn: [], log: [] };
    const orig = { error: console.error, warn: console.warn, log: console.log };
    for (const k of Object.keys(logs)) console[k] = (...a) => logs[k].push(a.join(' '));
    return { logs, restore: () => Object.assign(console, orig) };
}
async function run(fn) { const c = capture(); try { return { result: await fn(), logs: c.logs }; } finally { c.restore(); } }

describe('الترحيب + الرتب التلقائية (ديسكورد وهمي)', () => {
    let w;
    beforeEach(() => { CONFIG.AUTO_ROLES = [...ORIGINAL_AUTO]; });
    after(async () => { CONFIG.AUTO_ROLES = ORIGINAL_AUTO; if (w) await w.close(); });

    const fresh = async (opts) => { if (w) await w.close(); w = await createWorld(CONFIG, opts); return w; };

    test('عضو عادي: رسالة واحدة + صورة مرفقة + الرتبتان', async () => {
        await fresh();
        const m = w.addMember({ username: 'tester' });
        await run(() => welcome.handleNewMember(m));

        assert.equal(w.api.posts.length, 1);
        const post = w.api.posts[0];
        assert.equal(post.channelId, CONFIG.WELCOME_CHANNEL_ID);
        assert.ok(post.payload.content.includes(`<@${m.id}>`));
        const embed = post.payload.embeds[0];
        assert.deepEqual(validateEmbed(embed), []);
        assert.match(embed.title, /SUBJECT DETECTED: TESTER/);
        assert.equal(post.files.length, 1, 'الصورة يجب أن تُرفع');
        assert.equal(post.files[0].data.length, fs.statSync(IMG).size, 'الملف المرفوع مطابق للأصل');
        assert.equal(embed.image.url, `attachment://${post.files[0].filename}`);
        assert.deepEqual(post.payload.allowed_mentions.users, [m.id]);
        assert.deepEqual(w.api.rolePuts.map(r => r.roleId), CONFIG.AUTO_ROLES);
        assert.ok(w.api.rolePuts.every(r => r.memberId === m.id));
    });

    test('رتبة أعلى من البوت: تُتخطى مع تشخيص واضح والباقي يُمنح', async () => {
        await fresh();
        CONFIG.AUTO_ROLES = [IDS.HIGH_ROLE, ORIGINAL_AUTO[0]];
        const m = w.addMember();
        const { logs } = await run(() => welcome.handleNewMember(m));
        assert.deepEqual(w.api.rolePuts.map(r => r.roleId), [ORIGINAL_AUTO[0]]);
        assert.ok(logs.error.some(l => /Admin/.test(l) && /(رتبة البوت|hierarchy|فوق)/.test(l)), logs.error.join('\n'));
        assert.equal(w.api.posts.length, 1, 'الترحيب لا يتأثر');
    });

    test('ID رتبة غير موجود: يُبلَّغ عنه والباقي يعمل', async () => {
        await fresh();
        CONFIG.AUTO_ROLES = ['123456789012345678', ORIGINAL_AUTO[1]];
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.deepEqual(w.api.rolePuts.map(r => r.roleId), [ORIGINAL_AUTO[1]]);
        assert.ok(logs.error.some(l => l.includes('123456789012345678')));
    });

    test('ديسكورد يرفض رتبة (403): تكمل الرتبة التالية', async () => {
        await fresh();
        w.api.rolePutFails.add(ORIGINAL_AUTO[0]);
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.deepEqual(w.api.rolePuts.map(r => r.roleId), ORIGINAL_AUTO, 'حاول الاثنتين');
        assert.ok(logs.error.length >= 1);
        assert.equal(w.api.posts.length, 1);
    });

    test('البوت بلا Manage Roles: لا محاولات رتب، والترحيب يُرسل', async () => {
        await fresh({ botPerms: 0n });
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.equal(w.api.rolePuts.length, 0);
        assert.equal(w.api.posts.length, 1);
        assert.ok(logs.error.some(l => /Manage Roles/i.test(l)));
    });

    test('قناة الترحيب ID خاطئ: لا انهيار والرتب تُمنح', async () => {
        await fresh();
        const old = CONFIG.WELCOME_CHANNEL_ID; CONFIG.WELCOME_CHANNEL_ID = '111111111111111111';
        try {
            const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
            assert.equal(w.api.posts.length, 0);
            assert.equal(w.api.rolePuts.length, 2);
            assert.ok(logs.error.some(l => l.includes('111111111111111111')));
        } finally { CONFIG.WELCOME_CHANNEL_ID = old; }
    });

    test('البوت لا يستطيع الكتابة في القناة: يُبلَّغ بالصلاحية الناقصة', async () => {
        await fresh({ welcomeAccess: 'no-send' });
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.equal(w.api.posts.length, 0);
        assert.equal(w.api.rolePuts.length, 2);
        assert.ok(logs.error.some(l => /SendMessages/.test(l)), logs.error.join('\n'));
    });

    test('قناة مخفية عن البوت: لا انهيار', async () => {
        await fresh({ welcomeAccess: 'hidden' });
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.equal(w.api.posts.length, 0);
        assert.equal(w.api.rolePuts.length, 2);
        assert.ok(logs.error.length >= 1);
    });

    test('رفع الصورة يعلق (This operation was aborted): يعيد الإرسال بدون صورة', async () => {
        await fresh({ restTimeout: 400 });
        w.api.messagePlans.push('hang');
        const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
        assert.equal(w.api.posts.length, 2, 'محاولتان');
        assert.equal(w.api.posts[0].files.length, 1);
        assert.equal(w.api.posts[1].files.length, 0, 'الثانية بدون ملفات');
        assert.equal(w.api.posts[1].payload.embeds[0].image, undefined);
        assert.deepEqual(validateEmbed(w.api.posts[1].payload.embeds[0]), []);
        assert.equal(w.api.rolePuts.length, 2);
        assert.ok(logs.warn.some(l => /without image|بدون صورة/i.test(l)), logs.warn.join('\n'));
    });

    test('فشل الإرسال مرتين: لا يرمي خطأ والرتب تُمنح', async () => {
        await fresh();
        w.api.messagePlans.push({ status: 500 }, { status: 500 });
        await run(() => welcome.handleNewMember(w.addMember()));
        assert.equal(w.api.rolePuts.length, 2);
    });

    test('حدث مكرر خلال 30 ثانية: يُعالج مرة واحدة فقط', async () => {
        await fresh();
        const m = w.addMember();
        await run(async () => { await welcome.handleNewMember(m); await welcome.handleNewMember(m); });
        assert.equal(w.api.posts.length, 1);
        assert.equal(w.api.rolePuts.length, 2);
    });

    test('نفس العضو يخرج ويدخل بعد دقيقة: يُرحَّب به ويأخذ رتبه من جديد', async () => {
        await fresh();
        const m = w.addMember();
        const t0 = Date.now();
        await run(() => welcome.handleNewMember(m));
        const clock = mock.method(Date, 'now', () => t0 + 60_000);
        try { await run(() => welcome.handleNewMember(m)); } finally { clock.mock.restore(); }
        assert.equal(w.api.posts.length, 2);
        assert.equal(w.api.rolePuts.length, 4);
    });

    test('بوت ينضم: بطاقة SYNTHETIC UNIT وبلا رتب تلقائية', async () => {
        await fresh();
        const b = w.addMember({ username: 'Ticket Tool', bot: true });
        await run(() => welcome.handleNewMember(b));
        assert.equal(w.api.posts.length, 1);
        assert.match(w.api.posts[0].payload.embeds[0].title, /SYNTHETIC UNIT/);
        assert.equal(w.api.rolePuts.length, 0);
    });

    test('البوت نفسه ينضم: يُتجاهل', async () => {
        await fresh();
        await run(() => welcome.handleNewMember(w.guild.members.me));
        assert.equal(w.api.posts.length, 0);
    });

    test('BOT_AUTO_ROLES: البوت ينضم ويأخذ الرتبة المخصصة للبوتات', async () => {
        await fresh(); const old = CONFIG.BOT_AUTO_ROLES; CONFIG.BOT_AUTO_ROLES = [ORIGINAL_AUTO[1]];
        try { await run(() => welcome.handleNewMember(w.addMember({ bot: true, username: 'SomeBot' })));
            assert.deepEqual(w.api.rolePuts.map(r => r.roleId), [ORIGINAL_AUTO[1]]);
        } finally { CONFIG.BOT_AUTO_ROLES = old; }
    });

    test('لا توجد صورة إطلاقاً: يُرسل الترحيب بدون صورة مع تحذير', async () => {
        await fresh(); const img = path.join(__dirname, '..', 'assets', 'welcome.jpg'); const tmp = img + '.bak';
        fs.renameSync(img, tmp);
        try {
            const { logs } = await run(() => welcome.handleNewMember(w.addMember()));
            assert.equal(w.api.posts.length, 1); assert.equal(w.api.posts[0].files.length, 0);
            assert.equal(w.api.posts[0].payload.embeds[0].image, undefined); assert.ok(logs.warn.some(l => /image not found/.test(l)));
        } finally { fs.renameSync(tmp, img); }
    });

    test('يقبل welcome.png إذا لا يوجد jpg (توافق مع مشروعك القديم)', async () => {
        await fresh(); const dir = path.join(__dirname, '..', 'assets'); const jpg = path.join(dir, 'welcome.jpg'); const png = path.join(dir, 'welcome.png');
        fs.renameSync(jpg, jpg + '.bak'); fs.copyFileSync(jpg + '.bak', png);
        try { await run(() => welcome.handleNewMember(w.addMember()));
            assert.equal(w.api.posts[0].files[0].filename, 'welcome.png'); assert.equal(w.api.posts[0].payload.embeds[0].image.url, 'attachment://welcome.png');
        } finally { fs.unlinkSync(png); fs.renameSync(jpg + '.bak', jpg); }
    });

    describe('أسماء مستخدمين غريبة', () => {
        const names = {
            emoji: '🔥🔥Ｆｉｒｅ🔥🔥', backticks: '``` yaml `x` ```', everyone: '@everyone @here',
            arabic: 'محمد ☪ الجزائري', long: 'ﷺ'.repeat(32), markdown: '**b** _i_ ~~s~~ ||spoiler|| [l](http://x.y)',
            rtl: '\u202Eevil\u202C', combining: 'Z̷̢̛a̸l̶g̵o̴', headings: '# big\n## bigger', pipes: 'a|b|c'
        };
        for (const [label, username] of Object.entries(names)) {
            test(label, async () => {
                await fresh();
                const m = w.addMember({ username });
                await run(() => welcome.handleNewMember(m));
                assert.equal(w.api.posts.length, 1, 'الرسالة أُرسلت');
                const e = w.api.posts[0].payload.embeds[0];
                assert.deepEqual(validateEmbed(e), []);
                // كتلة الكود يجب أن تبقى سليمة (فتح وإغلاق فقط)
                assert.equal((e.description.match(/```/g) || []).length, 2, 'code block مكسور: ' + e.description);
                // لا منشن يُطلق: المحتوى فيه منشن العضو فقط
                assert.equal(w.api.posts[0].payload.content.includes('@everyone'), false);
                assert.deepEqual(w.api.posts[0].payload.allowed_mentions.users, [m.id]);
                assert.equal(w.api.posts[0].payload.allowed_mentions.parse, undefined);
                // الحقل Tag: سطر واحد وinline code سليم (بلا backtick أو سطر جديد بداخله)
                const tagField = e.fields.find(f => /Identity/.test(f.name)).value;
                const lines = tagField.split('\n');
                assert.equal(lines.length, 3, 'Identity field كُسر إلى أسطر إضافية: ' + JSON.stringify(tagField));
                assert.match(lines[1], /^> \*\*Tag:\*\* `[^`]*`$/, 'Tag field مكسور: ' + lines[1]);
            });
        }
    });

    test('سيرفر بأيقونة: الرابط صالح', async () => {
        await fresh({ guildIcon: 'a_0123456789abcdef0123456789abcdef' });
        await run(() => welcome.handleNewMember(w.addMember()));
        const e = w.api.posts[0].payload.embeds[0];
        assert.match(e.author.icon_url, /^https:\/\/cdn\.discordapp\.com\/icons\//);
        assert.deepEqual(validateEmbed(e), []);
    });
});
