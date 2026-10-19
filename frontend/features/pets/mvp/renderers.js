import { CATALOG } from './catalog.js';
const BASE = new URL('../../../assets/pets/mvp/', import.meta.url);
export class RivePet {
    constructor(canvas) { this.canvas = canvas; }
    async load() {
        // Script-free .riv: local builds work without signing or a cloud account.
        const { Rive, Layout, Fit, Alignment, RuntimeLoader } = window.rive;
        RuntimeLoader.setWasmUrl(new URL('../../../vendor/rive/rive.wasm', import.meta.url).href);
        RuntimeLoader.setWasmFallbackUrl?.(new URL('../../../vendor/rive/rive_fallback.wasm', import.meta.url).href);
        await new Promise((resolve, reject) => {
            this.rive = new Rive({ src: new URL('companion.riv', BASE).href, canvas: this.canvas,
                artboard: 'Companion', stateMachines: 'Care', autoplay: true, autoBind: true,
                layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
                onLoad: () => { this.vm = this.rive.viewModelInstance; this.rive.resizeDrawingSurfaceToCanvas(); resolve(); },
                onLoadError: e => reject(new Error(String(e.data || 'Rive 載入失敗'))),
            });
        });
        if (!this.vm) throw new Error('Rive 資料模型沒有成功連接');
        this.observer = new ResizeObserver(() => this.rive.resizeDrawingSurfaceToCanvas());
        this.observer.observe(this.canvas);
    }
    setEquipment(e) {
        this.vm.number('cat').value = e.character === 'cat' ? 1 : 0;
        this.vm.number('dog').value = e.character === 'dog' ? 1 : 0;
        const c = CATALOG.outfits[e.outfit].color;
        this.vm.color('shirtColor').rgb(...[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
    }
    setAction(action) { this.vm.number('action').value = { idle: 0, feed: 1, pet: 2, play: 2 }[action] ?? 0; }
    pause(paused) { paused ? this.rive.pause('Care') : this.rive.play('Care'); }
    still() { this.rive.pause('Care'); }
    dispose() { this.observer?.disconnect(); this.rive?.cleanup(); }
}
export class FramePet {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cache = new Map(); this.equipment = { character: 'dog', outfit: 'sage' }; this.action = 'idle'; this.token = 0; }
    async load() {
        const response = await fetch(new URL('frames.json', BASE));
        if (!response.ok) throw new Error('身體動畫檔案載入失敗');
        this.manifest = await response.json();
        this.canvas.width = this.manifest.width; this.canvas.height = this.manifest.height;
        await this.selectFrames();
        this.raf = requestAnimationFrame(t => this.draw(t));
    }
    async selectFrames() {
        const token = ++this.token;
        const key = `${this.equipment.character}-${this.equipment.outfit}-${this.action}`;
        const names = this.manifest.variants[key];
        if (!names?.length) throw new Error(`找不到身體動畫：${key}`);
        if (!this.cache.has(key)) this.cache.set(key, Promise.all(names.map(async name => {
            const img = new Image(); img.src = new URL(`frames/${name}`, BASE).href; await img.decode(); return img;
        })).catch(error => { this.cache.delete(key); throw error; }));
        const frames = await this.cache.get(key);
        if (token !== this.token || this.disposed) return;
        this.frames = frames; this.started = performance.now(); this.paint(0);
    }
    setEquipment(e) { this.equipment = { ...e }; return this.selectFrames(); }
    setAction(a) { this.action = a === 'play' ? 'pet' : a; return this.selectFrames(); }
    paint(i) { if (!this.frames?.[i]) return; this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.ctx.drawImage(this.frames[i], 0, 0); }
    draw(t) {
        if (!this.paused && !this.reduced && this.frames) this.paint(Math.floor((t - this.started) / 1000 * this.manifest.fps) % this.frames.length);
        if (!this.disposed) this.raf = requestAnimationFrame(time => this.draw(time));
    }
    pause(paused) { this.paused = paused; }
    still() { this.reduced = true; this.paint(0); }
    dispose() { this.disposed = true; ++this.token; cancelAnimationFrame(this.raf); this.frames = null; this.cache.clear(); }
}
