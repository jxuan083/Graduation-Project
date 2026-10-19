import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const MODEL_URL = new URL('../../assets/pets/puppy.glb', import.meta.url).href;

/** A local, photo-preserving player. No generative service sees the portrait. */
export class PetViewer {
    constructor(container, { onError = () => {} } = {}) {
        this.container = container;
        this.onError = onError;
        this.disposed = false;
        this.action = null;
        this.status = 'NORMAL';
        this.textures = new Set();
        this.photoVersion = 0;
        this.motion = matchMedia('(prefers-reduced-motion: reduce)');
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.renderer.domElement.className = 'pet-3d-canvas';
        // Buffer pixels scale with devicePixelRatio; CSS pixels must always fit
        // the host, including standalone previews without the app stylesheet.
        Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
        this.contextLost = event => {
            event.preventDefault();
            this.onError(new Error('3D 畫面暫時無法顯示'));
            this.dispose();
        };
        this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
        container.append(this.renderer.domElement);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(33, 1, .1, 20);
        this.camera.position.set(.12, 1.55, 4.9);
        this.camera.lookAt(0, 1.03, 0);
        this.scene.add(new THREE.HemisphereLight(0xfff5e3, 0x796b58, 2.5));
        const key = new THREE.DirectionalLight(0xffedce, 3.1);
        key.position.set(-3, 5, 4);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0xf0f6ff, 1.1);
        fill.position.set(3, 2, 1);
        this.scene.add(fill);
        this.addShadow();
        this.resize = () => {
            if (this.disposed) return;
            const { width, height } = container.getBoundingClientRect();
            if (!width || !height) return;
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            // Keep the full silhouette visible in both narrow phones and wide panels.
            this.camera.position.z = Math.max(4.9, 3.4 / this.camera.aspect);
            this.camera.lookAt(0, 1.03, 0);
            this.camera.updateProjectionMatrix();
            this.draw(performance.now());
        };
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.visibility = () => {
            if (document.hidden) this.stop();
            else this.start();
        };
        document.addEventListener('visibilitychange', this.visibility);
    }

    async load(portraitUrl) {
        const { scene } = await new GLTFLoader().loadAsync(MODEL_URL);
        if (this.disposed) {
            this.disposeObject(scene);
            return;
        }
        this.model = scene;
        this.scene.add(scene);
        this.parts = {};
        for (const name of ['Body', 'Head', 'EarL', 'EarR', 'Tail', 'PawL', 'PawR', 'FoodBowl', 'PlayBall', 'DefaultFace', 'FaceMount']) {
            const node = scene.getObjectByName(name);
            if (!node) throw new Error(`模型缺少 ${name}`);
            this.parts[name] = node;
        }
        this.parts.FoodBowl.visible = this.parts.PlayBall.visible = false;
        this.rest = new Map();
        scene.traverse(node => this.rest.set(node, { position: node.position.clone(), rotation: node.rotation.clone() }));
        this.addSurfaceDetail();
        if (portraitUrl) await this.setPortrait(portraitUrl);
        if (this.disposed) return;
        this.resize();
        this.start();
    }

    addSurfaceDetail() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const pixels = ctx.createImageData(128, 128);
        let seed = 41;
        for (let i = 0; i < pixels.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const value = 100 + (seed >>> 27);
            pixels.data.set([value, value, value, 255], i);
        }
        ctx.putImageData(pixels, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(5, 5);
        this.textures.add(texture);
        this.model.traverse(node => {
            if (!node.isMesh) return;
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
                if (/pile|fleece|cotton/i.test(material.name)) {
                    material.bumpMap = texture;
                    material.bumpScale = .012;
                    material.roughness = .96;
                    material.metalness = 0;
                    material.needsUpdate = true;
                }
                if (node.name.endsWith('_pile')) material.side = THREE.DoubleSide;
            }
        });
    }

    addShadow() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(54,35,17,.30)');
        gradient.addColorStop(.5, 'rgba(54,35,17,.13)');
        gradient.addColorStop(1, 'rgba(54,35,17,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        const texture = new THREE.CanvasTexture(canvas);
        this.textures.add(texture);
        this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.7), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = .009;
        this.scene.add(this.shadow);
    }

    async setPortrait(url) {
        const version = ++this.photoVersion;
        if (!url) {
            if (this.photo) this.photo.visible = false;
            if (this.parts) this.parts.DefaultFace.visible = true;
            return;
        }
        const texture = await new THREE.TextureLoader().loadAsync(url);
        if (this.disposed || version !== this.photoVersion) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        this.textures.add(texture);
        if (!this.photo) {
            // The flat plane keeps original photographic proportions and pixels.
            this.photo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
                transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide,
            }));
            this.parts.FaceMount.add(this.photo);
        }
        const ratio = texture.image.width / texture.image.height;
        const height = Math.min(.80, .70 / ratio);
        this.photo.scale.set(height * ratio, height, 1);
        const previous = this.photo.material.map;
        this.photo.material.map = texture;
        this.photo.material.needsUpdate = true;
        this.photo.visible = true;
        this.parts.DefaultFace.visible = false;
        if (previous) { this.textures.delete(previous); previous.dispose(); }
        this.draw(performance.now());
    }

    setStatus(status) { this.status = status || 'NORMAL'; }

    /** Care animations are called only after the API confirms success. */
    play(action) {
        if (this.disposed || !this.parts) return;
        this.action = { name: action, start: performance.now(), duration: action === 'feed' ? 1900 : 1400 };
        this.start();
    }

    draw(now) {
        if (this.disposed) return;
        if (this.parts) {
            const p = this.parts;
            for (const [node, rest] of this.rest) {
                node.position.copy(rest.position);
                node.rotation.copy(rest.rotation);
            }
            const t = now / 1000;
            const active = this.action && now - this.action.start < this.action.duration;
            const name = active ? this.action.name : null;
            const progress = active ? (now - this.action.start) / this.action.duration : 0;
            p.FoodBowl.visible = name === 'feed';
            p.PlayBall.visible = name === 'play';
            if (!this.motion.matches) {
                const envelope = Math.sin(progress * Math.PI);
                const subdued = ['CRITICAL', 'HUNGRY', 'RESCUE'].includes(this.status);
                p.Head.rotation.z += Math.sin(t * .8) * (subdued ? .015 : .035);
                p.Head.position.y += Math.sin(t * 1.6) * .008;
                p.Tail.rotation.y += Math.sin(t * (active ? 11 : 3.4)) * (subdued ? .04 : active ? .45 : .13);
                p.EarL.rotation.z += Math.sin(t * 1.7) * .025;
                p.EarR.rotation.z -= Math.sin(t * 1.7 + .6) * .025;
                if (subdued) p.Head.rotation.x += .09;
                if (name === 'feed') {
                    p.Head.rotation.x += envelope * (.25 + Math.sin(progress * Math.PI * 8) * .06);
                    p.Head.position.y -= envelope * .12;
                    p.Head.position.z += envelope * .035;
                } else if (name === 'wipe') {
                    p.Head.rotation.z += Math.sin(progress * Math.PI * 6) * envelope * .18;
                    p.EarL.rotation.z += envelope * .15;
                    p.EarR.rotation.z -= envelope * .15;
                } else if (name === 'play' || name === 'tap' || name === 'release') {
                    p.Body.position.y += Math.abs(Math.sin(progress * Math.PI * 2)) * envelope * .12;
                    p.PawR.rotation.x -= envelope * .40;
                    if (name === 'play') p.PlayBall.position.x += Math.sin(progress * Math.PI * 2) * .32;
                }
            }
            if (!active) this.action = null;
        }
        this.renderer.render(this.scene, this.camera);
    }

    start() {
        if (this.disposed || document.hidden || this.frame) return;
        let last = 0;
        const tick = now => {
            if (this.disposed) return;
            this.frame = requestAnimationFrame(tick);
            if (now - last < 1000 / 30) return;
            last = now;
            this.draw(now);
        };
        this.frame = requestAnimationFrame(tick);
    }

    stop() { cancelAnimationFrame(this.frame); this.frame = null; }

    disposeObject(root) {
        const materials = new Set();
        root.traverse(node => {
            node.geometry?.dispose();
            for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) materials.add(material);
        });
        for (const material of materials) material.dispose();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.photoVersion++;
        this.stop();
        this.observer.disconnect();
        document.removeEventListener('visibilitychange', this.visibility);
        this.disposeObject(this.scene);
        for (const texture of this.textures) texture.dispose();
        this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
