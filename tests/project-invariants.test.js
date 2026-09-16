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

test('pushes and pull requests verify automatically but deployment stays manual', () => {
    const workflow = read('.github/workflows/deploy.yml');
    assert.match(workflow, /pull_request:\s*\n\s+branches: \[main\]/);
    assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:/);
    assert.match(workflow, /deploy-frontend:[\s\S]*?github\.event_name == 'workflow_dispatch'/);
    assert.match(workflow, /deploy-backend:[\s\S]*?github\.event_name == 'workflow_dispatch'/);
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

test('created group pets keep a transparent background and persist the chosen body and name', () => {
  const backend = read('backend/main.py');
  const controller = read('frontend/features/groups/controller.js');
  const petSwap = read('frontend/views/pet-swap/pet-swap.js');
  assert.match(petSwap, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/);
  assert.match(petSwap, /canvas\.toBlob[\s\S]*?'image\/png'/);
  assert.match(controller, /formData\.append\('pet_name', petName\)/);
  assert.match(controller, /formData\.append\('pet_body_emoji', petBodyEmoji\)/);
  assert.match(backend, /"pet_name": clean_name/);
  assert.match(backend, /"pet_body_emoji": clean_body/);
});

test('camera capture freezes one frame and stops the live stream before confirmation', () => {
  const petSwap = read('frontend/views/pet-swap/pet-swap.js');
  const captureStart = petSwap.indexOf('async function capturePhoto');
  const captureEnd = petSwap.indexOf('\nasync function retakePhoto', captureStart);
  const capture = petSwap.slice(captureStart, captureEnd);
  assert.match(capture, /cancelVideoLoop\(\)/);
  assert.match(capture, /await createImageBitmap\(video\)/);
  assert.match(capture, /sourceMode = 'image'/);
  assert.match(capture, /stopLiveCamera\(\)/);
  assert.ok(capture.indexOf("sourceMode = 'image'") < capture.indexOf('stopLiveCamera()'));
  assert.match(capture, /setCapturedUi\(true\)/);
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

test('landing explains the shared gathering loop before secondary features', () => {
  const home = read('frontend/views/home/home.html');
  assert.match(home, /手機可以留在手上/);
  assert.match(home, /注意力留在彼此身上/);
  assert.match(home, /揪齊夥伴[\s\S]*一起定錨[\s\S]*專心相聚/);
  assert.match(home, /只要更了解彼此/);
});

test('scheduled gathering lives under the start gathering flow', () => {
  const home = read('frontend/views/home/home.html');
  const setupHtml = read('frontend/views/meeting-setup/meeting-setup.html');
  const setupJs = read('frontend/views/meeting-setup/meeting-setup.js');
  assert.doesNotMatch(home, /home-schedule-sheet|btn-home-schedule/);
  assert.match(setupHtml, /立即開始[\s\S]*預約聚會/);
  assert.match(setupHtml, /id="setup-schedule-panel"/);
  assert.match(setupJs, /function createScheduleIcs/);
  assert.match(setupJs, /PRODID:-\/\/phubbing\/\/meeting-setup\/\/TW/);
});

test('meeting setup follows the shared twenty-pixel page gutter', () => {
  const css = read('frontend/styles/redesign.css');
  assert.match(css, /#view-meeting-setup \.cp-start-mode \{[^}]*width: calc\(100% - 40px\)/);
  assert.match(css, /#view-meeting-setup \.cp-setup-panel \{[^}]*width: calc\(100% - 40px\)/);
  assert.match(css, /#view-meeting-setup \.cp-sticky-cta \{[^}]*padding: 2px 0 12px/);
});

test('meeting setup stays single-screen and derives enforcement from the selected scene', () => {
  const html = read('frontend/views/meeting-setup/meeting-setup.html');
  const js = read('frontend/views/meeting-setup/meeting-setup.js');
  const css = read('frontend/styles/redesign.css');
  assert.doesNotMatch(html, /手機管制強度|cp-level-btn|diff-btn/);
  assert.doesNotMatch(js, /bindDiffBtns|querySelectorAll\('\.diff-btn'\)/);
  assert.match(js, /state\.currentDifficulty = cfg\.difficulty/);
  assert.match(css, /#view-meeting-setup \{[^}]*overflow: hidden;[^}]*padding-bottom: 0/);
  assert.match(css, /#view-meeting-setup \.cp-sticky-cta \{[^}]*margin-top: auto/);
});

test('shared anchor exposes every member progress and tactile completion feedback', () => {
  const html = read('frontend/views/sync-ritual/sync-ritual.html');
  const frontend = read('frontend/views/sync-ritual/sync-ritual.js');
  const backend = read('backend/main.py');
  assert.match(html, /id="sync-member-grid"/);
  assert.match(html, /id="sync-complete-overlay"/);
  assert.match(frontend, /renderSyncMembers/);
  assert.match(frontend, /navigator\.vibrate/);
  assert.match(backend, /\[START_SYNC\] rejected:[\s\S]*?host_uid/);
  assert.match(backend, /all\(m\.get\("progress", 0\) == 100/);
});

test('unused Firebase Functions package is not part of the deploy surface', () => {
  const config = JSON.parse(read('firebase.json'));
  assert.equal(config.functions, undefined);
});

test('guest mode stays local and does not depend on Firebase anonymous auth', () => {
  const guest = read('frontend/core/guest.js');
  const firebase = read('frontend/core/firebase.js');
  const chrome = read('frontend/core/chrome.js');
  const ws = read('frontend/core/ws.js');
  const home = read('frontend/views/home/home.js');
  const setup = read('frontend/views/meeting-setup/meeting-setup.js');
  const backend = read('backend/main.py');
  assert.match(guest, /state\.userId = state\.guestUserId/);
  assert.match(guest, /phubbing_local_guest_active/);
  assert.doesNotMatch(firebase, /signInAnonymously\s*\(/);
  assert.match(chrome, /events\.on\('guest:continued', \(\) => renderAuthBar\(\)\)/);
  assert.match(chrome, /is-local-guest/);
  assert.match(ws, /token: idToken/);
  assert.match(ws, /nickname: nickname \|\| '訪客'/);
  assert.match(firebase, /headers\['X-Guest-Uid'\] = state\.guestUserId/);
  assert.match(home, /!state\.currentUser && !state\.localGuestActive/);
  assert.match(setup, /!state\.currentUser && !state\.localGuestActive/);
  assert.match(backend, /create_room\(body: CreateRoomRequest, decoded: dict = Depends\(verify_token_or_guest\)\)/);
  assert.match(backend, /if not _is_guest_user_id\(guest_uid\)/);
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
  for (const file of ['backend/requirements.txt', 'backend/requirements-core.txt', 'backend/requirements-media.txt']) {
    const requirements = read(file)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    assert.ok(requirements.length > 0, `${file} must list at least one dependency`);
    for (const requirement of requirements) {
      assert.match(requirement, /^[A-Za-z0-9_.-]+==[^=\s]+$/, `${file}: ${requirement}`);
    }
  }
});

test('frontend exemption display values mirror backend intent.py (no drift)', () => {
  // 前端 config 的暫離次數/時長是「顯示用」鏡像；真正 enforcement 在 backend/intent.py。
  // 這個測試鎖住兩邊必須一致，避免顯示「可暫離 3 次」但後端只給 2 次的鬼打牆。
  const py = read('backend/intent.py');
  const js = read('frontend/core/config.js');
  const parseIntMap = (src, name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(m, `${name} not found`);
    const map = {};
    for (const pair of m[1].matchAll(/["']?(\w+)["']?\s*:\s*(\d+)/g)) map[pair[1]] = Number(pair[2]);
    return map;
  };
  assert.deepEqual(
    parseIntMap(js, 'EXEMPT_BUDGET_BY_CONTEXT'),
    parseIntMap(py, 'EXEMPT_BUDGET_BY_CONTEXT'),
    'EXEMPT_BUDGET_BY_CONTEXT 前後端不一致',
  );
  assert.deepEqual(
    parseIntMap(js, 'EXEMPT_WINDOW_SEC'),
    parseIntMap(py, 'EXEMPT_WINDOW_SEC'),
    'EXEMPT_WINDOW_SEC 前後端不一致',
  );
});

test('js and css are served no-cache so a stale import cannot break the module graph', () => {
  // 只有 36 個 import 帶 ?v=N，250 個沒帶。Hosting 預設給 .js 的是 max-age=3600，
  // 所以 bump 版號時有版號的抓到新檔、沒版號的沿用舊快取 —— 兩邊對不起來，
  // 整個 module graph 會以 SyntaxError 收場，畫面全死。
  // （2026-09 實際發生過：firebase.js?v=64 import 無版號的 config.js，
  //  舊快取那份還沒有 FIREBASE_EMULATORS。）
  // no-cache 不等於不快取：ETag 仍然成立，回的是 304，只是每次都先問過伺服器。
  const config = JSON.parse(read('firebase.json'));
  const headers = config.hosting.headers || [];
  for (const source of ['**/*.js', '**/*.css']) {
    const rule = headers.find(h => h.source === source);
    assert.ok(rule, `firebase.json 缺少 ${source} 的 Cache-Control 設定`);
    const cacheControl = rule.headers.find(h => h.key === 'Cache-Control');
    assert.equal(cacheControl?.value, 'no-cache', `${source} 必須是 no-cache`);
  }
});
