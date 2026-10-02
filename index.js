require('dotenv').config();
const http = require('http');
const {
    Client, GatewayIntentBits, Events, REST, Routes, Collection, MessageFlags, ActivityType
} = require('discord.js');

const CONFIG = require('./config');
const { loadModules } = require('./utils/loader');

// ─────────────────────────────────────────────────────────────
// -1) سيرفر HTTP صغير (لا علاقة له بديسكورد إطلاقاً)
//     سبب وجوده: على منصات مثل Render، الفئة المجانية هي لـ "Web Service" فقط
//     (التي تتطلب فتح منفذ HTTP)، وبدونها لن يقبل Render تشغيل المشروع في خطته المجانية.
//     هذا السيرفر لا يفعل شيئاً سوى الرد "OK" حتى تستطيع خدمة "تنشيط" خارجية (مثل
//     UptimeRobot) زيارته كل 10-14 دقيقة فتمنع Render من تنويم الخدمة. راجع دليل
//     الاستضافة في README.md للتفاصيل الكاملة.
// ─────────────────────────────────────────────────────────────
if (process.env.PORT) {
    http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('OK'); })
        .listen(process.env.PORT, () => console.log(`🌐 Keep-alive HTTP server listening on port ${process.env.PORT}`));
}

// ─────────────────────────────────────────────────────────────
// 0) التحقق من المتغيرات الأساسية في .env
// ─────────────────────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID', 'GEMINI_API_KEY'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
    console.error(`❌ Critical Error: missing in .env → ${missingEnv.join(', ')}`);
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// 1) تحميل الأوامر من commands/ والأحداث من events/  (ملف = ميزة)
// ─────────────────────────────────────────────────────────────
const commandModules = loadModules('commands', m =>
    !m?.data?.name ? 'missing `data` (SlashCommandBuilder)'
    : typeof m.execute !== 'function' ? 'missing `execute` function'
    : null
);

const eventModules = loadModules('events', m =>
    !m?.name ? 'missing `name` (Events.X)'
    : typeof m.execute !== 'function' ? 'missing `execute` function'
    : null
);

// ─────────────────────────────────────────────────────────────
// 2) الـ Intents تُجمع تلقائياً: أي ملف يحتاج intent يعلنه بنفسه
//    مثال داخل ملف:  intents: [GatewayIntentBits.GuildMessages]
//    (Privileged مثل MessageContent / GuildMembers يجب تفعيلها أيضاً
//     من Developer Portal > Bot > Privileged Gateway Intents)
// ─────────────────────────────────────────────────────────────
const intents = new Set([
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers // للترحيب (مضمون حتى لو نسيت إعلانه)
]);
for (const { mod } of [...commandModules, ...eventModules]) {
    for (const i of mod.intents ?? []) intents.add(i);
}

const client = new Client({
    intents: [...intents],
    rest: { timeout: 60_000 } // المهلة الافتراضية 15 ثانية قصيرة لرفع الصور على انترنت بطيء
});

// ─────────────────────────────────────────────────────────────
// 3) تسجيل الأوامر والأحداث في البوت
// ─────────────────────────────────────────────────────────────
client.commands = new Collection();

for (const { file, mod } of commandModules) {
    if (client.commands.has(mod.data.name)) {
        console.warn(`⚠️ [commands/${file}] duplicate command name "${mod.data.name}" — skipped.`);
        continue;
    }
    client.commands.set(mod.data.name, mod);
}

for (const { file, mod } of eventModules) {
    const handler = async (...args) => {
        try {
            await mod.execute(...args);
        } catch (err) {
            console.error(`❌ Event handler events/${file} crashed:`, err);
        }
    };
    if (mod.once) client.once(mod.name, handler);
    else client.on(mod.name, handler);
}

console.log(`📦 Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].map(n => '/' + n).join(', ')}`);
console.log(`📦 Loaded ${eventModules.length} event handler(s). Intents: ${intents.size}`);

// ─────────────────────────────────────────────────────────────
// 4) تسجيل أوامر الـ Slash لدى ديسكورد + حالة البوت
// ─────────────────────────────────────────────────────────────
const rest = new REST({ version: '10', timeout: 60_000 }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
    try {
        console.log('🔄 Registering guild-specific slash commands...');
        const body = [...client.commands.values()].map(c => c.data.toJSON());
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, CONFIG.GUILD_ID), { body });
        console.log('✅ Guild slash commands registered instantly!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`🤖 Bot is online as: ${client.user.tag}`);
    client.user.setActivity(CONFIG.BOT.STATUS_TEXT, { type: ActivityType.Watching });
    await registerCommands();
});

// ─────────────────────────────────────────────────────────────
// 5) توجيه التفاعلات إلى الأمر المناسب
// ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
    // Autocomplete (اختياري: يعمل إذا عرّف الأمر دالة autocomplete)
    if (interaction.isAutocomplete()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd?.autocomplete) {
            await cmd.autocomplete(interaction).catch(err =>
                console.error(`❌ Autocomplete /${interaction.commandName} failed:`, err));
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    try {
        await cmd.execute(interaction, client);
    } catch (err) {
        console.error(`❌ Command /${interaction.commandName} crashed:`, err);
        const msg = { content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(msg).catch(() => {});
        } else {
            await interaction.reply(msg).catch(() => {});
        }
    }
});

// ─────────────────────────────────────────────────────────────
// 6) أخطاء عامة + إيقاف نظيف + تسجيل الدخول
// ─────────────────────────────────────────────────────────────
client.on(Events.Error, err => console.error('❌ Client error:', err));
process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err));
// أي خطأ متزامن (synchronous) يهرب من كل محاولات try/catch يصل هنا بدل أن يُسقط البوت بصمت.
// نسجّله بالتفصيل ونُبقي العملية شغّالة، لأن اتصال البوت بديسكورد غالباً سليم رغم الخطأ.
process.on('uncaughtException', (err, origin) => console.error(`❌ Uncaught exception (${origin}):`, err));

function shutdown(signal) {
    console.log(`\n👋 ${signal} received — shutting down...`);
    client.destroy();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error(`❌ Login failed: ${err.message}`);
    if (err.code === 'DisallowedIntents') {
        console.error('   → Developer Portal > your app > Bot > enable "Server Members Intent" and "Message Content Intent".');
    } else if (err.code === 'TokenInvalid') {
        console.error('   → DISCORD_TOKEN in .env is invalid. Reset it in the Developer Portal and paste the new one.');
    }
    process.exit(1);
});
