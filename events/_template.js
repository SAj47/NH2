// ════════════════════════════════════════════════════════════
//  قالب لحدث جديد (مثل: خروج عضو، إضافة تفاعل...)
//  انسخه وسمّه مثلاً  myEvent.js  ثم عدّل الاسم والمنطق. لا تعدّل index.js.
//  إذا احتاج الحدث Intent إضافي فاكتبه في السطر  intents:  أدناه.
// ════════════════════════════════════════════════════════════
const { Events, GatewayIntentBits } = require('discord.js');

module.exports = {
    name: Events.GuildMemberRemove, // اسم الحدث
    once: false,                    // true = مرة واحدة فقط
    intents: [GatewayIntentBits.GuildMembers], // الـ Intents التي يحتاجها هذا الحدث

    async execute(member) {
        console.log(`👋 ${member.user?.tag ?? member.id} left the server.`);
    }
};
