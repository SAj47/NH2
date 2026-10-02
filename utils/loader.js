const fs = require('fs');
const path = require('path');

// يمشي داخل المجلد وكل مجلداته الفرعية ويجمع ملفات .js
// - أي ملف/مجلد يبدأ بـ _ أو . يُتجاهل (مثل _template.js)
function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
    return files.sort();
}

// يحمّل كل ملفات مجلد (commands أو events) ويتحقق من شكلها.
// ملف فيه خطأ يُتجاوز مع رسالة واضحة ولا يوقف البوت.
function loadModules(dirName, validate, baseDir = path.join(__dirname, '..')) {
    const root = path.join(baseDir, dirName);
    if (!fs.existsSync(root)) return [];

    const loaded = [];
    for (const full of walk(root)) {
        const file = path.relative(root, full).split(path.sep).join('/');
        try {
            const mod = require(full);
            const problem = validate(mod);
            if (problem) {
                console.warn(`⚠️ [${dirName}/${file}] skipped: ${problem}`);
                continue;
            }
            loaded.push({ file, mod });
        } catch (err) {
            console.error(`❌ [${dirName}/${file}] failed to load: ${err.message}`);
        }
    }
    return loaded;
}

module.exports = { loadModules, walk };
