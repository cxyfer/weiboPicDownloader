
const MAX_LOGS = 1000;
const STORAGE_KEY = 'debug_logs';

class Logger {
    constructor() {
        this.logs = [];
        this.listeners = new Set();
        this.buffer = [];
        this.flushTimer = null;
    }

    async init() {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
            this.logs = data[STORAGE_KEY];
        }
    }

    log(level, ...args) {
        const msg = args.map(a =>
            typeof a === 'object' ? JSON.stringify(a, Object.getOwnPropertyNames(a)) : String(a)
        ).join(' ');

        const entry = {
            ts: Date.now(),
            level,
            msg
        };

        console.log(`[WPD:${level}]`, ...args);

        this.logs.unshift(entry);
        if (this.logs.length > MAX_LOGS) {
            this.logs.length = MAX_LOGS;
        }

        this.notify(entry);
        this.scheduleFlush();
    }

    info(...args) { this.log('INFO', ...args); }
    warn(...args) { this.log('WARN', ...args); }
    error(...args) { this.log('ERROR', ...args); }

    scheduleFlush() {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            chrome.storage.local.set({ [STORAGE_KEY]: this.logs });
        }, 1000); // Debounce writes
    }

    getLogs() {
        return this.logs;
    }

    clear() {
        this.logs = [];
        chrome.storage.local.remove(STORAGE_KEY);
        this.notify({ type: 'CLEAR' });
    }

    addListener(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    notify(data) {
        // Determine if we should send to popup (if open)
        // We can use runtime.sendMessage, popup will pick it up if registered
        chrome.runtime.sendMessage({ type: 'LOG_ENTRY', entry: data }).catch(() => { });
    }
}

export const logger = new Logger();
