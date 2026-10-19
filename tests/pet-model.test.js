import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Box3, Vector3 } from '../frontend/vendor/three/three.module.min.js';
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
