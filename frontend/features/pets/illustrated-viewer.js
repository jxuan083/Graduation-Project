// Script-free native Rive rig. Image layers keep the approved painted artwork.
const ASSET = new URL('../../assets/pets/illustrated/puppy-v1.riv', import.meta.url);
ASSET.searchParams.set('v', 'stationary-paws-20261020-2');
const RUNTIME = new URL('../../vendor/rive/rive.js', import.meta.url);
let runtimePromise;
function loadRuntime() {
    if (window.rive?.Rive) return Promise.resolve(window.rive);
    return runtimePromise ||= new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = RUNTIME.href;
        script.onload = () => window.rive?.Rive ? resolve(window.rive) : reject(new Error('動畫程式沒有載入完成'));
        script.onerror = () => { script.remove(); reject(new Error('動畫程式載入失敗')); };
        document.head.append(script);
    }).catch(error => { runtimePromise = null; throw error; });
}
export class IllustratedPetViewer {
    constructor(container, { onEvent = () => {}, onError = () => {}, onProgress = () => {} } = {}) {
        this.container = container; this.onEvent = onEvent; this.onError = onError; this.onProgress = onProgress;
        this.canvas = document.createElement('canvas');
        this.canvas.setAttribute('aria-label', '手繪狗狗動畫');
        Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block' });
        container.append(this.canvas);
        this.motion = matchMedia('(prefers-reduced-motion: reduce)');
        this._visibility = () => this.syncMotion();
        this._motion = () => {
            if (this.disposed || !this.loaded) return;
            const interrupted = this.currentAction;
            this.rive.reset({ artboard: 'Puppy', stateMachine: 'Care', autoBind: true, autoplay: true });
            this.vm = this.rive.viewModelInstance;
            this.currentAction = null;
            if (interrupted) this.onEvent({ name: 'actionCancelled', action: interrupted });
            this.syncMotion();
        };
        this._riveEvent = event => {
            if (this.disposed || !this.loaded) return;
            const name = event.data?.name;
            if (!name) return;
            // Public actions own their lifetime, so stale/duplicate events cannot
            // complete an unrelated action or cause a second food consumption.
            if (!this.currentAction) return;
            if (name === 'feedComplete' && this.currentAction !== 'feed') return;
            if (name === 'petComplete' && this.currentAction !== 'pet') return;
            if (name.endsWith('Complete')) this.currentAction = null;
            this.onEvent({ name, reducedMotion: false });
        };
    }
    get busy() { return Boolean(this.currentAction); }
    async load() {
        try {
            this.onProgress('準備互動畫面…');
            const runtime = await loadRuntime();
            if (this.disposed) return;
            const { RuntimeLoader, Rive, Layout, Fit, Alignment, EventType } = runtime;
            RuntimeLoader.setWasmUrl(new URL('../../vendor/rive/rive.wasm', import.meta.url).href);
            RuntimeLoader.setWasmFallbackUrl?.(new URL('../../vendor/rive/rive_fallback.wasm', import.meta.url).href);
            this.onProgress('狗狗正在過來…');
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('載入有點久，請重新試一次')), 20000);
                this.rive = new Rive({ src: ASSET.href, canvas: this.canvas,
                    artboard: 'Puppy', stateMachine: 'Care', autoBind: true, autoplay: true,
                    shouldDisableRiveListeners: true,
                    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
                    onLoad: () => { clearTimeout(timer); resolve(); },
                    onLoadError: () => { clearTimeout(timer); reject(new Error('狗狗動畫載入失敗')); },
                });
            });
            if (this.disposed) { this.rive.cleanup(); return; }
            this.vm = this.rive.viewModelInstance;
            if (!this.vm?.trigger('feed') || !this.vm?.trigger('pet')) throw new Error('狗狗互動資料沒有載入完成');
            this.loaded = true;
            this.rive.on(EventType.RiveEvent, this._riveEvent);
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container);
            document.addEventListener('visibilitychange', this._visibility);
            this.motion.addEventListener('change', this._motion);
            this.resize(); this.syncMotion();
        } catch (error) {
            if (!this.disposed) { this.onError(error); this.dispose(); }
            throw error;
        }
    }
    resize() { if (this.loaded && !this.disposed) this.rive.resizeDrawingSurfaceToCanvas(Math.min(devicePixelRatio || 1, 2)); }
    syncMotion() {
        if (!this.loaded || this.disposed) return;
        cancelAnimationFrame(this.motionFrame);
        if (document.hidden) this.rive.pause('Care');
        else if (this.motion.matches) {
            // Initialize the reset state machine and paint once before pausing.
            // Pausing first leaves the new artboard unadvanced and invisible.
            this.rive.play('Care');
            this.motionFrame = requestAnimationFrame(() => {
                this.motionFrame = requestAnimationFrame(() => {
                    if (!this.disposed && this.motion.matches) this.rive.pause('Care');
                });
            });
        } else this.rive.play('Care');
    }
    noticeFood(near) { if (this.loaded && !this.disposed && !this.busy && !this.motion.matches) this.vm.boolean('nearFood').value = Boolean(near); }
    setAttention(x = 0) {
        if (this.loaded && !this.disposed && !this.busy && !this.motion.matches) this.vm.number('attention').value = Math.max(-1, Math.min(1, x)) * .025;
    }
    play(action) {
        if (!this.loaded || this.disposed || this.busy || !['feed', 'pet'].includes(action)) return false;
        this.vm.boolean('nearFood').value = false;
        this.vm.number('attention').value = 0;
        this.currentAction = action;
        if (this.motion.matches) {
            // With reduced motion, keep the animal still and confirm via text.
            // This preview has no server-side care, inventory or reward writes.
            this.onEvent({ name: action === 'feed' ? 'feedStart' : 'petStart', reducedMotion: true });
            queueMicrotask(() => {
                if (this.disposed || this.currentAction !== action) return;
                this.currentAction = null;
                this.onEvent({ name: action === 'feed' ? 'feedComplete' : 'petComplete', reducedMotion: true });
            });
        } else this.vm.trigger(action).trigger();
        return true;
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.loaded = false; this.currentAction = null;
        cancelAnimationFrame(this.motionFrame);
        this.resizeObserver?.disconnect();
        document.removeEventListener('visibilitychange', this._visibility);
        this.motion.removeEventListener('change', this._motion);
        this.rive?.cleanup(); this.canvas.remove();
    }
}
