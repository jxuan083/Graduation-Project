// Script-free native Rive rig. Image layers keep the approved painted artwork.
const ASSET = new URL('../../assets/pets/illustrated/puppy-v1.riv', import.meta.url);
ASSET.searchParams.set('v', 'care-inventory-20261020-4');
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
            clearTimeout(this.completionTimer);
            const interrupted = this.currentAction;
            this.rive.reset({ artboard: 'Puppy', stateMachine: 'Care', autoBind: true, autoplay: true });
            this.vm = this.rive.viewModelInstance; this._applyCareItems();
            this.currentAction = null;
            this._finishAction?.(false);
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
            const action = ['feed', 'pet', 'wipe', 'play'].find(action => name.startsWith(action));
            if (action && action !== this.currentAction) return;
            if (name.endsWith('Complete')) {
                // Native completion is at animation end; the return-to-Idle
                // transition still blends for 120ms. Keep triggers locked until
                // it settles, otherwise a quick next action can be consumed.
                clearTimeout(this.completionTimer);
                this.completionTimer = setTimeout(() => {
                    if (this.disposed || !this.currentAction) return;
                    this.currentAction = null; this._finishAction?.(true);
                    this.onEvent({name,reducedMotion:false});
                },160);
                return;
            }
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
            this.vm = this.rive.viewModelInstance; this._applyCareItems();
            if (!['feed', 'pet', 'wipe', 'play'].every(action => this.vm?.trigger(action))) throw new Error('狗狗互動資料沒有載入完成');
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
    setStatus(status) { this.container.dataset.petStatus = status || 'NORMAL'; }
    setCareItem(item) {
        if (item?.kind === 'food') this.foodItem = item;
        if (item?.kind === 'toy') this.toyItem = item;
        this._applyCareItems();
    }
    _applyCareItems() {
        if (!this.vm) return;
        const food = this.foodItem?.visual?.index ?? 0;
        const toy = this.toyItem?.visual?.sheet === 'toy' ? this.toyItem.visual.index + 1 : 0;
        for (let i = 0; i < 9; i++) { const p = this.vm.number(`food${i}`); if (p) p.value = i === food ? 1 : 0; }
        for (let i = 0; i < 7; i++) { const p = this.vm.number(`toy${i}`); if (p) p.value = i === toy ? 1 : 0; }
    }
    playAndWait(action, item) {
        if (item && !this.busy) this.setCareItem(item);
        if (!this.loaded || this.disposed || this.busy) return Promise.resolve(false);
        return new Promise(resolve => {
            const finish = completed => {
                clearTimeout(timer); this._finishAction = null; resolve(completed);
            };
            const timer = setTimeout(() => {
                if (!this.disposed) {
                    clearTimeout(this.completionTimer);
                    this.currentAction = null;
                    this.rive.reset({ artboard: 'Puppy', stateMachine: 'Care', autoBind: true, autoplay: true });
                    this.vm = this.rive.viewModelInstance; this._applyCareItems(); this.syncMotion();
                }
                finish(false);
            }, 9000);
            this._finishAction = finish;
            if (!this.play(action)) finish(false);
        });
    }
    play(action) {
        if (!this.loaded || this.disposed || this.busy || !['feed', 'pet', 'wipe', 'play'].includes(action)) return false;
        this.vm.boolean('nearFood').value = false;
        this.vm.number('attention').value = 0;
        this.currentAction = action;
        if (this.motion.matches) {
            // With reduced motion, keep the animal still and confirm via text.
            // The renderer never writes care stats; its caller owns API confirmation.
            this.onEvent({ name: `${action}Start`, reducedMotion: true });
            queueMicrotask(() => {
                if (this.disposed || this.currentAction !== action) return;
                this.currentAction = null;
                this._finishAction?.(true);
                this.onEvent({ name: `${action}Complete`, reducedMotion: true });
            });
        } else {
            const variant = { tug: 'playTug', bounce: 'playBounce', toss: 'playToss' }[this.toyItem?.motion];
            this.vm.trigger(action === 'play' && variant ? variant : action).trigger();
        }
        return true;
    }
    dispose() {
        if (this.disposed) return;
        clearTimeout(this.completionTimer);
        this.disposed = true; this.loaded = false; this.currentAction = null;
        this._finishAction?.(false);
        cancelAnimationFrame(this.motionFrame);
        this.resizeObserver?.disconnect();
        document.removeEventListener('visibilitychange', this._visibility);
        this.motion.removeEventListener('change', this._motion);
        this.rive?.cleanup(); this.canvas.remove();
    }
}
