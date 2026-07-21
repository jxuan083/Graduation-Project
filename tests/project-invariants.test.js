import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';


const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('non-active pet view is not forced visible by a high-specificity selector', () => {
    const css = read('frontend/styles/pet-tamagotchi.css');
    const block = css.match(/#view-pet-tamagotchi\s*\{([^}]*)\}/)?.[1] || '';
    assert.doesNotMatch(block, /display\s*:\s*flex/);
});

test('Cloud Run stays single-instance while WebSocket state is process-local', () => {
    const workflow = read('.github/workflows/deploy.yml');
    assert.match(workflow, /--max-instances 1/);
    assert.match(workflow, /deploy-backend:\s*\n\s+needs: verify/);
});

test('security rules are deployed together with Hosting', () => {
    const workflow = read('.github/workflows/deploy.yml');
    assert.match(workflow, /--only hosting,firestore:rules,storage/);
});

test('client cannot directly overwrite user system fields', () => {
    const rules = read('firestore.rules');
    const userBlock = rules.match(/match \/users\/\{uid\}\s*\{([\s\S]*?)match \/questions/)?.[1] || '';
    assert.match(userBlock, /allow write:\s*if false/);
    assert.doesNotMatch(userBlock, /allow create, update/);
});

test('pet feature is group-only', () => {
  const backend = read('backend/main.py');
  const tamagotchi = read('frontend/views/pet-tamagotchi/pet-tamagotchi.js');
  const petSwap = read('frontend/views/pet-swap/pet-swap.js');
  const storageRules = read('storage.rules');
  assert.match(backend, /@app\.get\("\/api\/group-pets"\)/);
  for (const source of [backend, tamagotchi, petSwap]) {
    assert.doesNotMatch(source, /\/api\/my-pet(?:s|\/|"|')/);
    assert.doesNotMatch(source, /my_pet_/);
  }
  assert.doesNotMatch(storageRules, /match \/pet-images\//);
});

test('group pet is included in linked meeting rooms without requiring a target user', () => {
  const backend = read('backend/main.py');
  const createRoomStart = backend.indexOf('async def create_room');
  const createRoomEnd = backend.indexOf('\n@app.', createRoomStart + 1);
  const createRoom = backend.slice(createRoomStart, createRoomEnd);
  assert.match(createRoom, /elif gd\.get\("pet_face_url"\):/);
  assert.doesNotMatch(createRoom, /gd\.get\("pet_target_uid"\).*pet_face_url/);
  assert.match(createRoom, /"group_pet_name": group_pet_name/);
  assert.match(createRoom, /"group_pet_level": group_pet_level/);
});

test('unused Firebase Functions package is not part of the deploy surface', () => {
  const config = JSON.parse(read('firebase.json'));
  assert.equal(config.functions, undefined);
});

test('view modules are always imported with the same cache-bust version', () => {
  // 同一個 view 模組若以不同 URL（有無 ?v=N）被 import,瀏覽器會建立兩個模組實例,
  // 模組內狀態會分裂（例:興趣標籤選了卻存出空陣列）。
  const root = fileURLToPath(new URL('../frontend', import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  })(root);
  const versions = new Set();
  const bare = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*(?:[\s\S]*?from\s*)?['"]([^'"]*\/views\/[^'"]+\.js[^'"]*)['"]/g)) {
      const spec = m[1];
      const v = spec.match(/\?v=(\d+)/);
      if (v) versions.add(v[1]);
      else bare.push(`${path.relative(root, f)} -> ${spec}`);
    }
  }
  assert.deepEqual(bare, [], `這些 import 少了 ?v= 版本（會造成模組實例分裂）:\n${bare.join('\n')}`);
  assert.ok(versions.size <= 1, `view 模組版本不一致: ${[...versions].join(', ')}`);
});

test('group chat media uploads require owner folder and group membership', () => {
  const rules = read('storage.rules');
  const start = rules.indexOf('match /group-chat/{groupId}/{uid}/{fileName}');
  assert.ok(start >= 0);
  const block = rules.slice(start, rules.indexOf('match /', start + 1));
  assert.match(block, /request\.auth\.uid == uid/);
  assert.match(block, /member_uids\.hasAny\(\[request\.auth\.uid\]\)/);
});

test('meeting photos are not made public during upload', () => {
  const backend = read('backend/main.py');
  const uploadStart = backend.indexOf('async def upload_meeting_photo');
  const uploadEnd = backend.indexOf('\n@app.', uploadStart + 1);
  assert.ok(uploadStart >= 0);
  assert.doesNotMatch(backend.slice(uploadStart, uploadEnd), /make_public\s*\(/);
});

test('backend direct dependencies are pinned', () => {
  const requirements = read('backend/requirements.txt')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.ok(requirements.length > 0);
  for (const requirement of requirements) assert.match(requirement, /^[A-Za-z0-9_.-]+==[^=\s]+$/);
});
