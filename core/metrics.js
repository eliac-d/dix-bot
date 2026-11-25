import { promises as fs, writeFileSync } from 'fs';
import path from 'path';

const SAVE_INTERVAL_MS = 5000;
const MAX_DAYS = 4;
const RECENT_LIMIT = 12000;
const SAMPLE_CAP_MS = 60000;
const SAMPLE_HARD_MS = 600000;

class MetricsManager {
    constructor() {
        this.filePath = path.join(process.cwd(), 'database', 'metrics.json');
        this.timeZone = 'America/Tegucigalpa';
        this.cache = { days: {} };
        this.dirty = false;
        this.saveTimer = null;
        this.saving = false;
        this.ready = false;
        this._seen = new Set();
        this._seenOrder = [];

        this._readyPromise = this.init()
            .then(() => { this.ready = true; })
            .catch(() => { this.ready = true; });

        this._setupShutdown();
    }

    _setupShutdown() {
        const flush = () => {
            try {
                if (this.saveTimer) {
                    clearTimeout(this.saveTimer);
                    this.saveTimer = null;
                }
                if (this.cache) {
                    const json = JSON.stringify(this._serialize(this.cache), null, 2);
                    writeFileSync(this.filePath, json, 'utf-8');
                }
            } catch (_) {}
        };
        process.once('SIGINT', flush);
        process.once('SIGTERM', flush);
        process.once('exit', flush);
    }

    async flush() {
        try {
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
            await this._doSave();
        } catch (_) {}
    }

    async init() {
        try {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            const raw = await fs.readFile(this.filePath, 'utf-8').catch(() => null);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object' && parsed.days) {
                        this.cache = this._restore(parsed);
                    }
                } catch (_) {}
            }
        } catch (_) {}

        if (!this.cache.days) this.cache.days = {};
        this.cleanOldDays();
        this._scheduleMidnight();
    }

    _hit(key) {
        if (!key) return false;
        if (this._seen.has(key)) return true;
        this._seen.add(key);
        this._seenOrder.push(key);
        if (this._seenOrder.length > RECENT_LIMIT) {
            const old = this._seenOrder.shift();
            this._seen.delete(old);
        }
        return false;
    }

    _afterReady(fn) {
        if (this.ready) return false;
        this._readyPromise.then(fn).catch(() => {});
        return true;
    }

    _num(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    _restore(data) {
        if (!data?.days) return { days: {} };
        for (const k of Object.keys(data.days)) {
            const d = data.days[k];
            if (!d || typeof d !== 'object') {
                delete data.days[k];
                continue;
            }
            if (Array.isArray(d.activeUsers)) d.activeUsers = new Set(d.activeUsers);
            else if (!(d.activeUsers instanceof Set)) d.activeUsers = new Set();
            if (Array.isArray(d.activeChats)) d.activeChats = new Set(d.activeChats);
            else if (!(d.activeChats instanceof Set)) d.activeChats = new Set();
            if (!Array.isArray(d.hourlyActivity) || d.hourlyActivity.length !== 24) d.hourlyActivity = new Array(24).fill(0);
            if (!d.commandsUsage || typeof d.commandsUsage !== 'object') d.commandsUsage = {};
            const hadProcessed = typeof d.processedMessages === 'number';
            d.totalMessages = this._num(d.totalMessages);
            d.processedMessages = this._num(d.processedMessages);
            d.totalCommands = this._num(d.totalCommands);
            d.uptimeMs = this._num(d.uptimeMs);
            d.errorsCount = this._num(d.errorsCount);
            d.rejectedCount = this._num(d.rejectedCount);
            d.slowCommands = this._num(d.slowCommands);
            d.avgResponseTimeMs = this._num(d.avgResponseTimeMs);
            d.totalResponseTimeMs = this._num(d.totalResponseTimeMs);
            d.totalResponseTimeCount = this._num(d.totalResponseTimeCount);
            d.maxResponseTimeMs = this._num(d.maxResponseTimeMs);
            if (!hadProcessed) {
                d.legacyMixed = true;
                if (k === this.getHondurasDate()) {
                    d.legacyMessages = this._num(d.legacyMessages) || d.totalMessages;
                    d.totalMessages = 0;
                }
            } else if (d.legacyMixed !== true) {
                d.legacyMixed = false;
            }
            d.legacyMessages = this._num(d.legacyMessages);
            d.responseReset = d.responseReset === true;
            if (d.totalResponseTimeCount > 0) {
                const avg = d.totalResponseTimeMs / d.totalResponseTimeCount;
                if (!Number.isFinite(avg) || avg > SAMPLE_CAP_MS || d.avgResponseTimeMs > SAMPLE_CAP_MS) {
                    d.totalResponseTimeMs = 0;
                    d.totalResponseTimeCount = 0;
                    d.avgResponseTimeMs = 0;
                    d.maxResponseTimeMs = 0;
                    d.responseReset = true;
                }
            }
        }
        return data;
    }

    _serialize(data) {
        const out = { days: {} };
        if (!data?.days) return out;
        for (const k of Object.keys(data.days)) {
            const d = data.days[k];
            if (!d) continue;
            out.days[k] = {
                totalMessages: d.totalMessages || 0,
                legacyMessages: d.legacyMessages || 0,
                processedMessages: d.processedMessages || 0,
                totalCommands: d.totalCommands || 0,
                activeUsers: Array.from(d.activeUsers || []),
                activeChats: Array.from(d.activeChats || []),
                uptimeMs: d.uptimeMs || 0,
                commandsUsage: { ...(d.commandsUsage || {}) },
                hourlyActivity: Array.isArray(d.hourlyActivity) ? [...d.hourlyActivity] : new Array(24).fill(0),
                errorsCount: d.errorsCount || 0,
                rejectedCount: d.rejectedCount || 0,
                slowCommands: d.slowCommands || 0,
                avgResponseTimeMs: d.avgResponseTimeMs || 0,
                totalResponseTimeMs: d.totalResponseTimeMs || 0,
                totalResponseTimeCount: d.totalResponseTimeCount || 0,
                maxResponseTimeMs: d.maxResponseTimeMs || 0,
                legacyMixed: d.legacyMixed === true,
                responseReset: d.responseReset === true
            };
        }
        return out;
    }

    getHondurasDate(date = new Date()) {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: this.timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(date);
            let y = '', m = '', d = '';
            for (const p of parts) {
                if (p.type === 'year') y = p.value;
                else if (p.type === 'month') m = p.value;
                else if (p.type === 'day') d = p.value;
            }
            if (y && m && d) return `${y}-${m}-${d}`;
        } catch (_) {}
        return date.toISOString().slice(0, 10);
    }

    getHondurasHour(date = new Date()) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: this.timeZone,
                hour: '2-digit',
                hourCycle: 'h23',
                hour12: false
            }).formatToParts(date);
            for (const p of parts) {
                if (p.type === 'hour') {
                    const h = parseInt(p.value, 10);
                    return isNaN(h) ? 0 : h % 24;
                }
            }
        } catch (_) {}
        return date.getHours() % 24;
    }

    _emptyDay() {
        return {
            totalMessages: 0,
            processedMessages: 0,
            totalCommands: 0,
            activeUsers: new Set(),
            activeChats: new Set(),
            uptimeMs: 0,
            commandsUsage: {},
            hourlyActivity: new Array(24).fill(0),
            errorsCount: 0,
            rejectedCount: 0,
            slowCommands: 0,
            avgResponseTimeMs: 0,
            totalResponseTimeMs: 0,
            totalResponseTimeCount: 0,
            maxResponseTimeMs: 0,
            legacyMixed: false,
            legacyMessages: 0,
            responseReset: false
        };
    }

    _normalizeDay(d) {
        if (!(d.activeUsers instanceof Set)) d.activeUsers = new Set(Array.isArray(d.activeUsers) ? d.activeUsers : []);
        if (!(d.activeChats instanceof Set)) d.activeChats = new Set(Array.isArray(d.activeChats) ? d.activeChats : []);
        if (!Array.isArray(d.hourlyActivity) || d.hourlyActivity.length !== 24) d.hourlyActivity = new Array(24).fill(0);
        if (!d.commandsUsage || typeof d.commandsUsage !== 'object') d.commandsUsage = {};
        return d;
    }

    _today() {
        const key = this.getHondurasDate();
        if (!this.cache.days[key]) this.cache.days[key] = this._emptyDay();
        return this._normalizeDay(this.cache.days[key]);
    }

    cleanOldDays() {
        if (!this.cache?.days) return;
        const valid = new Set();
        const now = Date.now();
        for (let i = 0; i < MAX_DAYS; i++) {
            valid.add(this.getHondurasDate(new Date(now - i * 86400000)));
        }
        for (const k of Object.keys(this.cache.days)) {
            if (!valid.has(k)) delete this.cache.days[k];
        }
    }

    _scheduleMidnight() {
        const ms = this._msUntilMidnight();
        setTimeout(() => {
            try {
                this.cleanOldDays();
                this.dirty = true;
                this._scheduleSave();
            } catch (_) {}
            this._scheduleMidnight();
        }, ms);
    }

    _msUntilMidnight() {
        try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: this.timeZone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23',
                hour12: false
            }).formatToParts(now);
            let h = 0, m = 0, s = 0;
            for (const p of parts) {
                if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
                else if (p.type === 'minute') m = parseInt(p.value, 10);
                else if (p.type === 'second') s = parseInt(p.value, 10);
            }
            const remaining = ((24 - h) * 3600 - m * 60 - s) * 1000;
            return Math.max(remaining, 60000);
        } catch (_) {
            return 3600000;
        }
    }

    _mark() {
        this.dirty = true;
        this._scheduleSave();
    }

    _countableChat(chat) {
        return typeof chat === 'string' && chat.length > 0 && !chat.endsWith('@broadcast');
    }

    _rememberUserChat(day, sender, chat) {
        if (typeof sender === 'string' && sender) day.activeUsers.add(sender);
        if (this._countableChat(chat)) day.activeChats.add(chat);
    }

    trackSeen(m, senderId) {
        if (this._afterReady(() => this.trackSeen(m, senderId))) return;
        try {
            if (!m || m.fromMe) return;
            const chat = m.chat;
            if (!this._countableChat(chat)) return;
            const id = m.key?.id;
            if (id && this._hit(`seen:${chat}:${id}`)) return;
            const day = this._today();
            day.totalMessages++;
            const hour = this.getHondurasHour();
            if (hour >= 0 && hour < 24) day.hourlyActivity[hour]++;
            const sender = typeof senderId === 'string' && senderId ? senderId : m.sender;
            this._rememberUserChat(day, sender, chat);
            this._mark();
        } catch (_) {}
    }

    trackMessage(m) {
        this.trackSeen(m, m?.sender);
    }

    trackProcessed(m, senderId) {
        if (this._afterReady(() => this.trackProcessed(m, senderId))) return;
        try {
            if (!m || m.fromMe) return;
            const chat = m.chat;
            if (!this._countableChat(chat)) return;
            const id = m.key?.id;
            if (id && this._hit(`proc:${chat}:${id}`)) return;
            const day = this._today();
            day.processedMessages++;
            const sender = typeof senderId === 'string' && senderId ? senderId : m.sender;
            this._rememberUserChat(day, sender, chat);
            this._mark();
        } catch (_) {}
    }

    trackCommandAttempt(name, sender, chat, messageId) {
        if (!name) return;
        if (this._afterReady(() => this.trackCommandAttempt(name, sender, chat, messageId))) return;
        try {
            if (messageId && this._hit(`cmd:${chat || ''}:${messageId}:${name}`)) return;
            const day = this._today();
            day.totalCommands++;
            day.commandsUsage[name] = (day.commandsUsage[name] || 0) + 1;
            this._rememberUserChat(day, sender, chat);
            this._mark();
        } catch (_) {}
    }

    trackCommandSuccess(name, timeMs, messageId) {
        if (this._afterReady(() => this.trackCommandSuccess(name, timeMs, messageId))) return;
        try {
            if (messageId && this._hit(`ok:${messageId}:${name || ''}`)) return;
            if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 0) return;
            const day = this._today();
            if (timeMs > SAMPLE_HARD_MS) {
                day.slowCommands++;
                this._mark();
                return;
            }
            if (timeMs > day.maxResponseTimeMs) day.maxResponseTimeMs = Math.round(timeMs);
            if (timeMs > SAMPLE_CAP_MS) {
                day.slowCommands++;
                this._mark();
                return;
            }
            day.totalResponseTimeMs += timeMs;
            day.totalResponseTimeCount++;
            day.avgResponseTimeMs = Math.round(day.totalResponseTimeMs / day.totalResponseTimeCount);
            this._mark();
        } catch (_) {}
    }

    trackCommandFailure(name, messageId) {
        if (this._afterReady(() => this.trackCommandFailure(name, messageId))) return;
        try {
            if (messageId && this._hit(`err:${messageId}:${name || ''}`)) return;
            const day = this._today();
            day.errorsCount++;
            this._mark();
        } catch (_) {}
    }

    trackRejection(name, messageId) {
        if (this._afterReady(() => this.trackRejection(name, messageId))) return;
        try {
            if (messageId && this._hit(`rej:${messageId}:${name || ''}`)) return;
            const day = this._today();
            day.rejectedCount++;
            this._mark();
        } catch (_) {}
    }

    trackCommand(name, sender, chat, success = true, timeMs = 0) {
        this.trackCommandAttempt(name, sender, chat);
        if (success) this.trackCommandSuccess(name, timeMs);
        else this.trackCommandFailure(name);
    }

    _scheduleSave() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this._doSave();
        }, SAVE_INTERVAL_MS);
    }

    async _doSave() {
        if (this.saving) return;
        if (!this.dirty || !this.cache) return;
        this.saving = true;
        this.dirty = false;
        try {
            const json = JSON.stringify(this._serialize(this.cache), null, 2);
            const tmp = this.filePath + '.tmp';
            await fs.writeFile(tmp, json, 'utf-8');
            await fs.rename(tmp, this.filePath);
        } catch (_) {
            this.dirty = true;
        } finally {
            this.saving = false;
            if (this.dirty) this._scheduleSave();
        }
    }

    getStats() {
        return this._serialize(this.cache);
    }
}

export const metricsManager = new MetricsManager();
