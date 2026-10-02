// يُحمَّل قبل index.js في اختبار التشغيل: يمنع الاتصال الحقيقي بديسكورد وينهي العملية بعد لحظة
const dj = require('discord.js');
dj.Client.prototype.login = async function () { setTimeout(() => process.exit(0), 300); return 'stub'; };
