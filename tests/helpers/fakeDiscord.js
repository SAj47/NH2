// ════════════════════════════════════════════════════════════════════
//  ديسكورد وهمي للاختبار: خادم HTTP محلي + كائنات discord.js حقيقية
//  (Guild / Role / GuildMember / Channel) بدون اتصال بالإنترنت.
//  البوت يرسل طلبات REST حقيقية (بما فيها رفع الملفات multipart)
//  ونحن نسجّلها ونفحصها.
// ════════════════════════════════════════════════════════════════════
const http = require('http');
const {
    Client, ClientUser, GatewayIntentBits, SnowflakeUtil, PermissionFlagsBits: P
} = require('discord.js');

const IDS = {
    BOT: '900000000000000001',
    BOT_ROLE: '900000000000000010',
    HIGH_ROLE: '900000000000000099',     // رتبة أعلى من البوت
    STAFF_CAT: '900000000000000020',
    OWNER: '900000000000000002',
    MOD: '900000000000000003'
};

let nextUser = 800000000000000000n; // عداد عام حتى لا تتكرر IDs بين الاختبارات

const LOG_CHANNEL_NAMES = ['messages', 'time・out', 'roles', 'rooms', 'kicked', 'muted・demute',
    'mouved', 'unbanned', 'banned', 'join-membre', 'left-membre'];

// ───────────────────────── تحليل multipart ─────────────────────────
function splitBuffer(buf, sep) {
    const out = []; let start = 0; let idx;
    while ((idx = buf.indexOf(sep, start)) !== -1) { out.push(buf.subarray(start, idx)); start = idx + sep.length; }
    out.push(buf.subarray(start));
    return out;
}

function parseMultipart(contentType, body) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    const boundary = m[1] ?? m[2];
    const parts = [];
    for (let p of splitBuffer(body, Buffer.from(`--${boundary}`)).slice(1)) {
        if (p.subarray(0, 2).toString() === '--') continue;
        if (p.subarray(0, 2).toString() === '\r\n') p = p.subarray(2);
        const headerEnd = p.indexOf('\r\n\r\n');
        if (headerEnd < 0) continue;
        const headers = p.subarray(0, headerEnd).toString();
        parts.push({
            name: /name="([^"]+)"/.exec(headers)?.[1],
            filename: /filename="([^"]+)"/.exec(headers)?.[1],
            contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1],
            data: p.subarray(headerEnd + 4, p.length - 2)
        });
    }
    const jsonPart = parts.find(x => x.name === 'payload_json');
    return { parts, json: jsonPart ? JSON.parse(jsonPart.data.toString()) : null };
}

// ───────────────────────── الخادم الوهمي ─────────────────────────
async function startFakeApi() {
    const api = {
        requests: [],
        messagePlans: [],       // خطة لكل رسالة: 'ok' | 'hang' | {status}
        auditEntries: [],       // تُرجَع من /audit-logs
        auditUsers: [],
        rolePutFails: new Set(),// role IDs التي يرفض ديسكورد إضافتها (403)
        get posts() { return this.requests.filter(r => r.method === 'POST' && /\/messages$/.test(r.url)); },
        get rolePuts() { return this.requests.filter(r => r.method === 'PUT' && /\/roles\//.test(r.url)); },
        get roleDeletes() { return this.requests.filter(r => r.method === 'DELETE' && /\/roles\//.test(r.url)); },
        reset() { this.requests.length = 0; this.messagePlans.length = 0; this.auditEntries = []; this.auditUsers = []; this.rolePutFails.clear(); }
    };

    const sockets = new Set();
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const rec = { method: req.method, url: req.url, headers: req.headers, body };
        api.requests.push(rec);

        const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

        let m;
        if (req.method === 'POST' && (m = /\/api\/v10\/channels\/(\d+)\/messages$/.exec(req.url))) {
            const ct = req.headers['content-type'] ?? '';
            rec.parsed = ct.startsWith('multipart/') ? parseMultipart(ct, body) : { parts: [], json: JSON.parse(body.toString() || '{}') };
            rec.payload = rec.parsed.json;
            rec.files = rec.parsed.parts.filter(p => p.filename);
            rec.channelId = m[1];

            const plan = api.messagePlans.shift() ?? 'ok';
            if (plan === 'hang') return;                       // لا رد أبداً → يحاكي This operation was aborted
            if (typeof plan === 'object') return json(plan.status, { message: plan.message ?? 'error', code: plan.code ?? 0 });

            return json(200, {
                id: SnowflakeUtil.generate().toString(), channel_id: m[1], type: 0,
                author: { id: IDS.BOT, username: 'NotHuman', discriminator: '0', avatar: null, bot: true },
                content: rec.payload.content ?? '', timestamp: new Date().toISOString(), edited_timestamp: null,
                tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [],
                embeds: rec.payload.embeds ?? [], pinned: false, flags: 0
            });
        }

        if (['PUT', 'DELETE'].includes(req.method) && (m = /\/api\/v10\/guilds\/(\d+)\/members\/(\d+)\/roles\/(\d+)$/.exec(req.url))) {
            rec.roleId = m[3]; rec.memberId = m[2];
            if (api.rolePutFails.has(m[3])) return json(403, { message: 'Missing Permissions', code: 50013 });
            res.writeHead(204); return res.end();
        }

        if (req.method === 'GET' && /\/api\/v10\/guilds\/\d+\/audit-logs/.test(req.url)) {
            return json(200, {
                audit_log_entries: api.auditEntries, users: api.auditUsers, webhooks: [], integrations: [],
                threads: [], guild_scheduled_events: [], application_commands: [], auto_moderation_rules: []
            });
        }

        json(404, { message: 'Unknown Route (fake)', code: 0 });
    });
    server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    api.url = `http://127.0.0.1:${server.address().port}`;
    api.close = async () => { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); };
    return api;
}

// ───────────────────────── العالم الوهمي ─────────────────────────
const ov = (id, allow, deny = 0n, type = 0) => ({ id, type, allow: String(allow), deny: String(deny) });

/**
 * config: ملف config.js الحقيقي (لأخذ الـ IDs منه)
 * opts.botPerms: صلاحيات رتبة البوت
 * opts.botRolePosition
 * opts.staffAccess: هل رتبة البوت مسموح لها بالقنوات داخل Staff؟
 * opts.welcomeAccess: 'full' | 'no-send' | 'hidden'
 * opts.omit: قنوات لوغ تُحذف (بالاسم)
 * opts.restTimeout
 */
async function createWorld(config, opts = {}) {
    const {
        botPerms = P.ManageRoles | P.ViewAuditLog | P.Connect,
        botRolePosition = 10,
        staffAccess = true,
        welcomeAccess = 'full',
        omit = [],
        restTimeout = 4000,
        guildIcon = null
    } = opts;

    const GUILD = config.GUILD_ID ?? '1066448701339484180';
    const api = await startFakeApi();

    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
        rest: { api: `${api.url}/api`, retries: 0, timeout: restTimeout }
    });
    client.rest.setToken('fake-token');
    client.user = new ClientUser(client, { id: IDS.BOT, username: 'NotHuman', discriminator: '0', avatar: null, bot: true });
    client.users.cache.set(IDS.BOT, client.user);

    const role = (id, name, position, permissions = 0n, extra = {}) => ({
        id, name, position, permissions: String(permissions), color: 0, hoist: false, managed: false, mentionable: false, flags: 0, ...extra
    });

    const allRoles = [
        role(GUILD, '@everyone', 0, P.ViewChannel | P.SendMessages),
        role(IDS.BOT_ROLE, 'Not Human Service', botRolePosition, botPerms),
        role(IDS.HIGH_ROLE, 'Admin', 20),
        ...config.AUTO_ROLES.map((id, i) => role(id, ['Member', 'Verified', 'Extra'][i] ?? `Auto${i}`, 5 - i)),
        ...Object.entries(config.SELF_ROLES).map(([key, id], i) => role(id, key[0].toUpperCase() + key.slice(1), 3 - i))
    ];
    // أول تعريف لكل ID يفوز (حتى لا تُكتب رتبة فوق رتبة بنفس الـ ID)
    const roles = allRoles.filter((r, i) => allRoles.findIndex(x => x.id === r.id) === i);

    const botAllow = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.AttachFiles | P.ManageMessages;
    const channel = (id, name, parent, overwrites, type = 0) => ({
        id, type, name, position: 0, parent_id: parent, permission_overwrites: overwrites,
        nsfw: false, topic: null, rate_limit_per_user: 0, last_message_id: null
    });

    const welcomeOverwrites =
        welcomeAccess === 'full' ? [ov(IDS.BOT_ROLE, botAllow)] :
        welcomeAccess === 'no-send' ? [ov(IDS.BOT_ROLE, P.ViewChannel | P.EmbedLinks | P.AttachFiles, P.SendMessages)] :
        [ov(GUILD, 0n, P.ViewChannel)]; // مخفية عن الجميع بما فيهم البوت

    const staffOverwrites = [ov(GUILD, 0n, P.ViewChannel), ...(staffAccess ? [ov(IDS.BOT_ROLE, botAllow)] : [])];

    const channels = [
        channel(IDS.STAFF_CAT, 'Staff', null, staffOverwrites, 4),
        channel(config.WELCOME_CHANNEL_ID, 'welcome', null, welcomeOverwrites),
        channel('920000000000000001', 'General VC', null, [], 2),
        channel('920000000000000002', 'Gaming VC', null, [], 2),
        channel('930000000000000001', 'general', null, [ov(IDS.BOT_ROLE, botAllow)]),
        ...LOG_CHANNEL_NAMES.filter(n => !omit.includes(n)).map((n, i) =>
            channel(`9100000000000000${String(10 + i)}`, n, IDS.STAFF_CAT, staffOverwrites))
    ];

    const now = new Date().toISOString();
    const guild = client.guilds._add({
        id: GUILD, name: "Test Server", icon: guildIcon, owner_id: IDS.OWNER, unavailable: false,
        member_count: 14, roles, channels, emojis: [], stickers: [], features: [], premium_tier: 0,
        members: [{
            user: { id: IDS.BOT, username: 'NotHuman', discriminator: '0', avatar: null, bot: true },
            roles: [IDS.BOT_ROLE], joined_at: now, deaf: false, mute: false, flags: 0
        }]
    });

    const addMember = ({ username = 'tester', bot = false, id, roles: r = [], global_name = null } = {}) => {
        const uid = id ?? String(nextUser++);
        return guild.members._add({
            user: { id: uid, username, discriminator: '0', global_name, avatar: null, bot },
            roles: r, joined_at: new Date().toISOString(), deaf: false, mute: false, flags: 0, pending: false
        });
    };

    const logChannels = () => guild.channels.cache.filter(c => c.parentId === IDS.STAFF_CAT);
    const chan = name => guild.channels.cache.find(c => c.name === name);

    return { api, client, guild, addMember, GUILD, IDS, logChannels, chan, close: async () => { client.destroy(); await api.close(); } };
}

// ───────────────────────── فاحص الـ Embed (حدود ديسكورد) ─────────────────────────
function validateEmbed(e) {
    const errs = [];
    const chk = (cond, msg) => { if (!cond) errs.push(msg); };
    let total = 0;
    const add = s => { total += String(s ?? '').length; };

    if (e.title) { chk(e.title.length <= 256, `title ${e.title.length}>256`); add(e.title); }
    if (e.description) { chk(e.description.length <= 4096, `description ${e.description.length}>4096`); add(e.description); }
    chk((e.fields?.length ?? 0) <= 25, 'more than 25 fields');
    for (const f of e.fields ?? []) {
        chk(f.name && f.name.length >= 1 && f.name.length <= 256, `field name invalid (${f.name?.length})`);
        chk(f.value && f.value.length >= 1 && f.value.length <= 1024, `field value invalid (${f.value?.length}) in "${f.name}"`);
        add(f.name); add(f.value);
    }
    if (e.footer) { chk(e.footer.text.length <= 2048, 'footer>2048'); add(e.footer.text); }
    if (e.author) { chk(e.author.name.length <= 256, 'author>256'); add(e.author.name); }
    chk(total <= 6000, `embed total ${total}>6000`);
    for (const u of [e.image?.url, e.thumbnail?.url, e.author?.icon_url, e.footer?.icon_url].filter(Boolean)) {
        chk(/^(https?:\/\/|attachment:\/\/)/.test(u), `bad url ${u}`);
    }
    return errs;
}

module.exports = { IDS, LOG_CHANNEL_NAMES, createWorld, validateEmbed, startFakeApi };
