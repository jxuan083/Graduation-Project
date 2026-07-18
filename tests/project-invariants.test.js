import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('personal pet upload path has an explicit owner-only Storage rule', () => {
    const rules = read('storage.rules');
    assert.match(rules, /match \/pet-images\/\{uid\}\/\{fileName\}/);
    assert.match(rules, /request\.auth\.uid == uid/);
});

test('unused Firebase Functions package is not part of the deploy surface', () => {
  const config = JSON.parse(read('firebase.json'));
  assert.equal(config.functions, undefined);
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
