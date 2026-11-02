import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const MODEL_URL = new URL('../../assets/pets/autumn.glb', import.meta.url).href;

/** A local, photo-preserving player. No generative service sees the portrait. */
export class PetViewer {
    constructor(container, { onError = () => {} } = {}) {
        this.container = container;
        this.onError = onError;
        this.disposed = false;
        this.action = null;
        this.attention = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
        this.status = 'NORMAL';
        this.textures = new Set();
        this.photoVersion = 0;
        this.motion = matchMedia('(prefers-reduced-motion: reduce)');
        this.onMotionChange = () => {
            this.lastTime = 0;
            this.action = null;
            this.setClip('Idle');
            for (const side of ['L', 'R']) {
                const eye = this.model?.getObjectByName(`Eye${side}`);
                if (eye) eye.scale.y = 1;
            }
            this.draw(performance.now());
        };
        this.motion.addEventListener('change', this.onMotionChange);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
        this.camera.position.set(.50, 1.65, 5.6);
        this.camera.lookAt(0, 1.03, 0);
        this.scene.add(new THREE.HemisphereLight(0xfff5e3, 0x796b58, 2.5));
        const key = new THREE.DirectionalLight(0xffedce, 3.1);
        key.position.set(-3, 5, 4);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { near: .5, far: 12, left: -2, right: 2, top: 3, bottom: -2 });
        key.shadow.normalBias = .025;
        key.shadow.bias = -.0003;
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
            this.camera.position.z = Math.max(5.6, 3.5 / this.camera.aspect);
            this.camera.lookAt(0, 1.03, 0);
            this.camera.updateProjectionMatrix();
            this.draw(performance.now());
        };
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.visibility = () => {
            if (document.hidden) {
                this.stop();
                this.action = null;
                this.setClip('Idle');
            }
            else this.start();
        };
        document.addEventListener('visibilitychange', this.visibility);
    }

    async load(portraitUrl) {
        const { scene, animations } = await new GLTFLoader().loadAsync(MODEL_URL);
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
        this.kibble = [];
        this.parts.FoodBowl.traverse(node => { if (node.name.startsWith('Kibble')) this.kibble.push(node); });
        scene.traverse(node => {
            if (!node.isMesh) return;
            node.castShadow = !/groomed[ _]fur/i.test(node.name);
            node.receiveShadow = true;
            for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                if (material.name === 'Autumn groomed hair cards') {
                    material.transparent = false;
                    material.alphaTest = .22;
                    material.alphaToCoverage = true;
                    material.depthWrite = true;
                    material.side = THREE.DoubleSide;
                    material.needsUpdate = true;
                }
            }
        });
        this.rest = new Map();
        scene.traverse(node => this.rest.set(node, { position: node.position.clone(), rotation: node.rotation.clone() }));
        if (animations.length) {
            this.mixer = new THREE.AnimationMixer(scene);
            this.clips = {};
            for (const clip of animations) {
                const name = ['Idle', 'Feed', 'Wipe', 'Play', 'Tap'].find(name => clip.name.endsWith(name));
                if (name) this.clips[name] = this.mixer.clipAction(clip);
            }
            this.finished = event => {
                if (event.action === this.currentClip) this.setClip('Idle');
            };
            this.mixer.addEventListener('finished', this.finished);
            this.setClip('Idle');
        } else this.addSurfaceDetail();
        this.addCareEffects();
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
        const contact = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: .26 }));
        contact.rotation.x = -Math.PI / 2;
        contact.position.y = .006;
        contact.receiveShadow = true;
        this.scene.add(contact);
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
        const mount = this.parts.FaceMount.userData;
        const height = Math.min(mount.photo_height || .94, (mount.photo_width || .83) / ratio);
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

    setAttention(x = 0, y = 0) {
        this.attention.tx = THREE.MathUtils.clamp(x, -1, 1);
        this.attention.ty = THREE.MathUtils.clamp(y, -1, 1);
    }

    setClip(name) {
        const next = this.clips?.[name];
        if (!next) return;
        const previous = this.currentClip;
        next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
        next.setLoop(name === 'Idle' ? THREE.LoopRepeat : THREE.LoopOnce, name === 'Idle' ? Infinity : 1);
        next.clampWhenFinished = name !== 'Idle';
        next.play();
        if (previous && previous !== next) previous.crossFadeTo(next, .20, false);
        this.currentClip = next;
    }

    addCareEffects() {
        this.bubbles = new THREE.Group();
        const geometry = new THREE.SphereGeometry(1, 12, 8);
        const material = new THREE.MeshPhysicalMaterial({ color: 0xdbe8d9, roughness: .18, transparent: true, opacity: .45, metalness: 0, depthWrite: false });
        for (let i = 0; i < 12; i++) {
            const bubble = new THREE.Mesh(geometry, material);
            bubble.scale.setScalar(.025 + (i % 4) * .012);
            this.bubbles.add(bubble);
        }
        this.bubbles.visible = false;
        this.scene.add(this.bubbles);
    }

    /** Care animations are called only after the API confirms success. */
    play(action) {
        if (this.disposed || !this.parts) return;
        const name = ({ feed: 'Feed', wipe: 'Wipe', play: 'Play', tap: 'Tap', release: 'Play' })[action];
        // Repeated taps should not keep snapping an already-running gesture back.
        if (this.action?.name === action && this.currentClip?.isRunning()) return;
        for (const side of ['L', 'R']) {
            const eye = this.model.getObjectByName(`Eye${side}`);
            if (eye) eye.scale.y = 1;
        }
        if (name) this.setClip(name);
        const duration = this.clips?.[name]?.getClip().duration * 1000;
        this.action = { name: action, start: performance.now(), duration: duration || (action === 'feed' ? 1900 : 1400) };
        this.start();
    }

    draw(now) {
        if (this.disposed) return;
        if (this.parts) {
            const p = this.parts;
            const t = now / 1000;
            const active = this.action && now - this.action.start < this.action.duration;
            const name = active ? this.action.name : null;
            const progress = active ? (now - this.action.start) / this.action.duration : 0;
            p.FoodBowl.visible = name === 'feed';
            p.PlayBall.visible = name === 'play';
            this.kibble?.forEach((piece, i) => {
                piece.visible = name !== 'feed' || progress < .3 + (i + 1) / this.kibble.length * .5;
            });
            const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, .08) : 0;
            this.lastTime = now;
            if (this.mixer && !this.motion.matches) this.mixer.update(delta);
            if (this.mixer && !this.motion.matches && !active) {
                const attention = this.attention;
                const step = Math.min(delta, .04);
                // A mass=1, stiffness=100, damping=10 spring lets a small gaze
                // movement settle rather than snapping at every pointer event.
                attention.vx += ((attention.tx - attention.x) * 100 - attention.vx * 10) * step;
                attention.vy += ((attention.ty - attention.y) * 100 - attention.vy * 10) * step;
                attention.x += attention.vx * step;
                attention.y += attention.vy * step;
                p.Head.rotateZ(-attention.x * .07);
                p.Head.rotateX(attention.y * .045);
                if (['CRITICAL', 'HUNGRY', 'RESCUE'].includes(this.status)) p.Head.rotateX(.07);
                const phase = t % 5.3;
                const blink = phase < .18 ? Math.sin(phase / .18 * Math.PI) : 0;
                for (const side of ['L', 'R']) {
                    const eye = this.model.getObjectByName(`Eye${side}`);
                    if (eye) eye.scale.y = 1 - blink * .92;
                }
            }
            if (!this.mixer || this.motion.matches) {
                for (const [node, rest] of this.rest) {
                    node.position.copy(rest.position);
                    node.rotation.copy(rest.rotation);
                }
            }
            if (this.bubbles) {
                this.bubbles.visible = name === 'wipe';
                this.bubbles.children.forEach((bubble, i) => {
                    const phase = this.motion.matches ? i / 12 : (progress + i / 12) % 1;
                    bubble.position.set(Math.sin(i * 2.4) * .5, .35 + phase * 1.3, .6 + Math.cos(i * 2.4) * .30);
                });
            }
            if (this.mixer && !this.motion.matches) {
                const bowlRest = this.rest.get(p.FoodBowl).position;
                p.FoodBowl.position.copy(bowlRest);
                if (name === 'feed') {
                    p.FoodBowl.position.z += Math.max(0, 1 - progress * 6) * .35;
                    p.FoodBowl.position.y += Math.sin(progress * Math.PI) * .35;
                }
                const ballRest = this.rest.get(p.PlayBall).position;
                p.PlayBall.position.copy(ballRest);
                if (name === 'play') {
                    p.PlayBall.position.x += Math.sin(progress * Math.PI * 2) * .50;
                    p.PlayBall.rotation.z = progress * Math.PI * 4;
                }
            } else if (!this.motion.matches) {
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
            if (this.motion.matches && !this.action) return;
            this.draw(now);
        };
        this.frame = requestAnimationFrame(tick);
    }

    stop() { cancelAnimationFrame(this.frame); this.frame = null; this.lastTime = 0; }

    disposeObject(root) {
        const materials = new Set();
        const textures = new Set();
        const skeletons = new Set();
        root.traverse(node => {
            node.geometry?.dispose();
            if (node.skeleton) skeletons.add(node.skeleton);
            for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) materials.add(material);
        });
        for (const material of materials) {
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            material.dispose();
        }
        for (const texture of textures) if (!this.textures.has(texture)) texture.dispose();
        for (const skeleton of skeletons) skeleton.dispose();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.photoVersion++;
        this.stop();
        this.observer.disconnect();
        document.removeEventListener('visibilitychange', this.visibility);
        this.motion.removeEventListener('change', this.onMotionChange);
        if (this.mixer) {
            this.mixer.removeEventListener('finished', this.finished);
            this.mixer.stopAllAction();
            this.mixer.uncacheRoot(this.model);
        }
        this.disposeObject(this.scene);
        for (const texture of this.textures) texture.dispose();
        this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
