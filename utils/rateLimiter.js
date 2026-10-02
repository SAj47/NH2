// محدد معدل الطلبات لكل عضو: فترة انتظار + حد يومي (UTC)
// الهدف: حماية حصة Gemini المجانية من العبث والـ spam
class RateLimiter {
    constructor({ cooldownMs = 15_000, dailyLimit = 25 } = {}) {
        this.cooldownMs = cooldownMs;
        this.dailyLimit = dailyLimit;
        this.users = new Map(); // userId -> { last, day, count }
    }

    static today(now = Date.now()) {
        return new Date(now).toISOString().slice(0, 10);
    }

    consume(userId) {
        const now = Date.now();
        const day = RateLimiter.today(now);

        if (this.users.size > 5000) this._sweep(day);

        const entry = this.users.get(userId) ?? { last: 0, day, count: 0 };
        if (entry.day !== day) {
            entry.day = day;
            entry.count = 0;
        }

        const wait = entry.last + this.cooldownMs - now;
        if (wait > 0) {
            return {
                ok: false,
                reason: 'cooldown',
                message: `⏳ Cooling down — try again in ${Math.ceil(wait / 1000)}s.`
            };
        }

        if (this.dailyLimit > 0 && entry.count >= this.dailyLimit) {
            return {
                ok: false,
                reason: 'daily',
                message: `🚫 You've used all ${this.dailyLimit} of today's AI requests. The limit resets at 00:00 UTC.`
            };
        }

        entry.last = now;
        entry.count += 1;
        this.users.set(userId, entry);
        return { ok: true };
    }

    // إرجاع الطلب للعضو إذا فشلت الخدمة بسببنا (وليس بسببه)
    refund(userId) {
        const entry = this.users.get(userId);
        if (!entry) return;
        entry.count = Math.max(0, entry.count - 1);
        entry.last = 0;
    }

    _sweep(today) {
        for (const [id, e] of this.users) {
            if (e.day !== today) this.users.delete(id);
        }
    }
}

module.exports = { RateLimiter };
