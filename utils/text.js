// اقتصاص نص مع علامة …
function clip(str, max) {
    const s = String(str ?? '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// تنظيف نص سيوضع داخل `backticks` أو code block: يمنع كسر التنسيق
function cleanInline(str) {
    return String(str ?? '').replace(/`/g, "'").replace(/[\r\n]+/g, ' ');
}

// تعطيل أي منشن قد يولّده الـ AI (@everyone / @here / <@id> / <@&role>)
function stripMentions(text) {
    return String(text ?? '')
        .replace(/@(everyone|here)/gi, '@\u200b$1')
        .replace(/<@[&!]?\d+>/g, '[mention]');
}

// تقسيم نص طويل إلى أجزاء ≤ max مع الحفاظ على كتل الكود (```)
// فإذا انقطع النص داخل كتلة كود، تُغلق في الجزء الحالي وتُعاد فتحها في التالي.
function splitText(text, max = 4000) {
    const chunks = [];
    let rest = String(text ?? '').trim();
    let openFence = null; // مثال: "```js"

    while (rest.length > 0) {
        const prefix = openFence ? openFence + '\n' : '';
        let slice;

        if (prefix.length + rest.length <= max) {
            slice = rest;
            rest = '';
        } else {
            const limit = max - prefix.length - 4; // مساحة لإغلاق "\n```"
            let cut = rest.lastIndexOf('\n', limit);
            if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
            if (cut < limit * 0.5) cut = limit;
            slice = rest.slice(0, cut);
            rest = rest.slice(cut).replace(/^[ \n]/, '');
        }

        let state = openFence;
        for (const m of slice.matchAll(/```([^\n`]*)/g)) {
            state = state ? null : '```' + m[1].trim();
        }

        let piece = prefix + slice;
        if (state && rest.length > 0) piece += '\n```';
        chunks.push(piece);
        openFence = rest.length > 0 ? state : null;
    }

    return chunks;
}

module.exports = { clip, cleanInline, stripMentions, splitText };
