const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadModules, walk } = require('../utils/loader');

const ROOT = path.join(__dirname, '..');
const quiet = fn => { const o = { e: console.error, w: console.warn }; const logs = []; console.error = console.warn = (...a) => logs.push(a.join(' ')); try { return { r: fn(), logs }; } finally { Object.assign(console, { error: o.e, warn: o.w }); } };

describe('loader', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-'));
    after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const put = (rel, code) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, code); };
    put('cmds/a.js', "module.exports = { data: { name: 'a' }, execute() {} };");
    put('cmds/sub/b.js', "module.exports = { data: { name: 'b' }, execute() {} };");
    put('cmds/sub/deeper/c.js', "module.exports = { data: { name: 'c' }, execute() {} };");
    put('cmds/_template.js', "throw new Error('template must be ignored');");
    put('cmds/_private/x.js', "throw new Error('_ folder must be ignored');");
    put('cmds/.hidden.js', "throw new Error('dotfile must be ignored');");
    put('cmds/notes.txt', 'not js');
    put('cmds/broken.js', "throw new Error('boom');");
    put('cmds/syntax.js', "module.exports = {{{");
    put('cmds/noexec.js', "module.exports = { data: { name: 'nofn' } };");
    put('cmds/empty.js', "");

    test('يقرأ المجلدات الفرعية ويتجاهل _ و . والملفات غير js', () => {
        const names = walk(path.join(tmp, 'cmds')).map(f => path.relative(tmp, f).split(path.sep).join('/'));
        assert.ok(names.includes('cmds/sub/deeper/c.js')); assert.ok(!names.some(n => /_template|_private|\.hidden|notes\.txt/.test(n)));
    });
    test('ملف تالف أو ناقص يُتجاوز مع رسالة والباقي يُحمَّل', () => {
        const { r, logs } = quiet(() => loadModules('cmds', m => !m?.data?.name ? 'missing `data`' : typeof m.execute !== 'function' ? 'missing `execute`' : null, tmp));
        assert.deepEqual(r.map(x => x.mod.data.name).sort(), ['a', 'b', 'c']);
        assert.ok(logs.some(l => /broken\.js.*boom/.test(l))); assert.ok(logs.some(l => /syntax\.js/.test(l)));
        assert.ok(logs.some(l => /noexec\.js.*execute/.test(l))); assert.ok(logs.some(l => /empty\.js.*data/.test(l)));
    });
    test('مجلد غير موجود → مصفوفة فارغة', () => assert.deepEqual(loadModules('nope', () => null, tmp), []));
});

describe('تشغيل index.js فعلياً (عملية مستقلة)', () => {
    const run = env => spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'stubLogin.js'), 'index.js'], {
        cwd: ROOT, encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, ...env } });
    const good = { DISCORD_TOKEN: 'x', CLIENT_ID: '1', GEMINI_API_KEY: 'x' };

    test('يحمّل كل الأوامر والأحداث بلا أي تحذير أو خطأ', () => {
        const r = run(good); const out = r.stdout + r.stderr;
        assert.equal(r.status, 0, out);
        assert.match(out, /Loaded 7 command\(s\): .*\/aireset.*\/ask.*\/join.*\/leave.*\/ping.*\/role.*\/status/);
        assert.match(out, /Loaded 12 event handler\(s\)\. Intents: 6/);
        assert.ok(!/❌|⚠️/.test(out), 'يوجد تحذير/خطأ:\n' + out);
    });
    test('متغيرات .env ناقصة → رسالة واضحة وخروج', () => {
        const r = run({ DISCORD_TOKEN: 'x' }); assert.equal(r.status, 1); assert.match(r.stderr, /missing in \.env → CLIENT_ID, GEMINI_API_KEY/);
    });
    test('لا يوجد ملفان بنفس الاسم في مجلدات مختلفة (سبب لبس سابق)', () => {
        const seen = new Map();
        for (const d of ['commands', 'events', 'features', 'services', 'utils']) for (const f of walk(path.join(ROOT, d))) {
            const b = path.basename(f); (seen.get(b) ?? seen.set(b, []).get(b)).push(d + '/' + path.relative(path.join(ROOT, d), f));
        }
        const dups = [...seen].filter(([, v]) => v.length > 1); assert.deepEqual(dups, [], JSON.stringify(dups));
    });
});

describe('سيرفر الـ keep-alive (للاستضافة المجانية)', () => {
    const http = require('http');
    const get = port => new Promise((res, rej) => http.get(`http://127.0.0.1:${port}`, r => {
        let body = ''; r.on('data', c => body += c); r.on('end', () => res({ status: r.statusCode, body }));
    }).on('error', rej));

    test('PORT موجود: يرد OK على أي طلب', () => {
        const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'stubLogin.js'), 'index.js'], {
            cwd: ROOT, encoding: 'utf8', timeout: 15000,
            env: { PATH: process.env.PATH, DISCORD_TOKEN: 'x', CLIENT_ID: '1', GEMINI_API_KEY: 'x', PORT: '0' }
        });
        assert.match(r.stdout, /Keep-alive HTTP server listening/);
    });

    test('PORT غير موجود (تشغيل محلي عادي): لا سيرفر HTTP يُفتح', () => {
        const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'stubLogin.js'), 'index.js'], {
            cwd: ROOT, encoding: 'utf8', timeout: 15000,
            env: { PATH: process.env.PATH, DISCORD_TOKEN: 'x', CLIENT_ID: '1', GEMINI_API_KEY: 'x' }
        });
        assert.doesNotMatch(r.stdout, /Keep-alive/);
    });

    test('السيرفر يرد فعلياً 200 OK على طلب HTTP حقيقي', async () => {
        const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('OK'); });
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        try {
            const r = await get(srv.address().port);
            assert.equal(r.status, 200); assert.equal(r.body, 'OK');
        } finally { srv.close(); }
    });
});

describe('الصمود أمام خطأ متزامن غير متوقَّع (uncaughtException)', () => {
    test('لا يُسقط البوت، ويُسجَّل بوضوح، والعملية تبقى حيّة', () => {
        const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'stubLoginAndCrash.js'), 'index.js'], {
            cwd: ROOT, encoding: 'utf8', timeout: 15000,
            env: { PATH: process.env.PATH, DISCORD_TOKEN: 'x', CLIENT_ID: '1', GEMINI_API_KEY: 'x' }
        });
        assert.match(r.stderr, /Uncaught exception.*SIMULATED_CRASH_FOR_TEST/);
        assert.match(r.stdout, /STILL_ALIVE_AFTER_CRASH/);
        assert.equal(r.status, 0, 'يجب أن تخرج العملية بنفسها (exit 0) لا أن تُسقَط بالخطأ');
    });
});
