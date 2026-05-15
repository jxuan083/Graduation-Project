// core/events.js — 簡易 event bus,讓不同 module 可互相 publish/subscribe
// 用法:
//   events.on('user:login', (user) => { ... });
//   events.emit('user:login', user);

class EventBus {
    constructor() { this._handlers = new Map(); }

    on(eventName, handler) {
        if (!this._handlers.has(eventName)) this._handlers.set(eventName, new Set());
        this._handlers.get(eventName).add(handler);
        return () => this.off(eventName, handler);
    }

    off(eventName, handler) {
        this._handlers.get(eventName)?.delete(handler);
    }

    emit(eventName, payload) {
        const set = this._handlers.get(eventName);
        if (!set) return;
        for (const fn of set) {
            try { fn(payload); }
            catch (err) { console.error(`[events] handler for "${eventName}" threw:`, err); }
        }
    }
}

export const events = new EventBus();
