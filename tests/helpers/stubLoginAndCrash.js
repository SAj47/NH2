// يُحمَّل قبل index.js: يمنع الاتصال الحقيقي، وبعد الإقلاع يفتعل انهياراً متزامناً
// للتأكد أن process.on('uncaughtException') يلتقطه ويُبقي العملية حيّة.
const dj = require('discord.js');
dj.Client.prototype.login = async function () {
    setTimeout(() => {
        setImmediate(() => { throw new Error('SIMULATED_CRASH_FOR_TEST'); });
        setTimeout(() => { console.log('STILL_ALIVE_AFTER_CRASH'); process.exit(0); }, 300);
    }, 300);
    return 'stub';
};
