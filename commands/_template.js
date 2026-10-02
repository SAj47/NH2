// ════════════════════════════════════════════════════════════
//  قالب لأمر جديد. الخطوات:
//  1) انسخ هذا الملف في نفس المجلد وسمّه مثلاً  hello.js  (بدون _ في البداية)
//  2) غيّر الاسم والوصف والمنطق
//  3) أعد تشغيل البوت — يُسجَّل الأمر تلقائياً. لا تعدّل index.js أبداً.
//  إذا احتاج الأمر Intent إضافي أضف داخل module.exports:  intents: [GatewayIntentBits.X]
// ════════════════════════════════════════════════════════════
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    // اسم الأمر: أحرف صغيرة بدون مسافات
    data: new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Say hello')
        .addUserOption(o => o.setName('user').setDescription('Who to greet').setRequired(false)),

    // interaction = التفاعل، client = البوت
    async execute(interaction, client) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        await interaction.reply({
            content: `👋 Hello ${target}!`,
            allowedMentions: { users: [target.id] }
            // flags: MessageFlags.Ephemeral   // ← أزل التعليق ليكون الرد خاصاً (استورد MessageFlags)
        });
    }

    // اختياري: للإكمال التلقائي (Autocomplete)
    // async autocomplete(interaction) { ... }
};
