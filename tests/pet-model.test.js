import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AnimationMixer, Box3, Vector3 } from '../frontend/vendor/three/three.module.min.js';
import { GLTFLoader } from '../frontend/vendor/three/GLTFLoader.js';

test('shipped puppy loads offline with independent pivots, front-facing photo mount and a bounded geometry budget', async () => {
    const bytes = await readFile(new URL('../frontend/assets/pets/puppy.glb', import.meta.url));
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    for (const name of ['Body', 'Head', 'EarL', 'EarR', 'PawL', 'PawR', 'Tail', 'FaceMount', 'DefaultFace', 'FoodBowl', 'PlayBall']) {
        assert.ok(scene.getObjectByName(name), `missing player pivot ${name}`);
    }
    const head = scene.getObjectByName('Head');
    const face = scene.getObjectByName('FaceMount');
    assert.equal(face.parent, head);
    const bounds = new Box3().setFromObject(scene);
    assert.ok(bounds.min.y > -.1 && bounds.max.y < 2.3, 'asset stays grounded and fits the camera');
    const faceWorld = face.getWorldPosition(new Vector3());
    const headWorld = head.getWorldPosition(new Vector3());
    assert.ok(faceWorld.z > headWorld.z + .4, 'original photo sits in front of the head');
    let triangles = 0;
    scene.traverse(node => {
        if (!node.isMesh) return;
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        assert.ok(!node.material.map, 'base puppy must not require external image downloads');
    });
    assert.ok(triangles < 130_000, `unexpected geometry growth: ${triangles} triangles`);
    assert.ok(bytes.length < 5 * 1024 * 1024, 'asset must stay below 5 MiB');
});

test('Autumn ships five usable skinning clips, follows its head photo mount and stays in the web budget', async () => {
    // Node has no image decoder. Stub only bitmap decoding; the actual embedded
    // GLB buffers, textures, joints, inverse binds and animations are all parsed.
    const saved = { self: globalThis.self, bitmap: globalThis.createImageBitmap, progress: globalThis.ProgressEvent };
    globalThis.self = globalThis;
    globalThis.createImageBitmap = async () => ({ width: 128, height: 256, close() {} });
    globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, values) { this.type = type; Object.assign(this, values); } };
    try {
        const bytes = await readFile(new URL('../frontend/assets/pets/autumn.glb', import.meta.url));
        const { scene, animations } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        assert.deepEqual(animations.map(clip => clip.name).sort(), ['Feed', 'Idle', 'Play', 'Tap', 'Wipe']);
        for (const name of ['Head', 'Body', 'EarL', 'EarR', 'PawL', 'PawR', 'Tail', 'FaceMount', 'DefaultFace', 'FoodBowl', 'PlayBall']) assert.ok(scene.getObjectByName(name), name);
        let triangles = 0, skinned = 0;
        scene.traverse(node => {
            if (!node.isMesh) return;
            triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
            if (node.isSkinnedMesh) {
                skinned++;
                assert.equal(node.skeleton.bones.length, 22);
                const weights = node.geometry.attributes.skinWeight;
                for (let i = 0; i < weights.count; i++) {
                    const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
                    assert.ok(Math.abs(sum - 1) < .002, `unnormalized skin ${node.name} ${i}: ${sum}`);
                }
            }
        });
        assert.ok(skinned >= 2, 'the body and fur both follow the skeleton');
        assert.ok(triangles < 125_000, `geometry regression: ${triangles}`);
        assert.ok(bytes.length < 8 * 1024 * 1024);
        const bounds = new Box3().setFromObject(scene);
        assert.ok(bounds.max.y < 2.4 && bounds.min.y > -.15, 'asset is grounded and fits the care scene');
        const mount = scene.getObjectByName('FaceMount');
        const start = mount.getWorldPosition(new Vector3());
        const mixer = new AnimationMixer(scene);
        mixer.clipAction(animations.find(clip => clip.name === 'Feed')).play();
        mixer.update(1.2);
        scene.updateMatrixWorld(true);
        const moved = mount.getWorldPosition(new Vector3());
        assert.ok(moved.distanceTo(start) > .03, 'the real head motion carries the original photo');
        assert.ok(Number.isFinite(moved.x + moved.y + moved.z));
    } finally {
        globalThis.self = saved.self;
        globalThis.createImageBitmap = saved.bitmap;
        globalThis.ProgressEvent = saved.progress;
    }
});
