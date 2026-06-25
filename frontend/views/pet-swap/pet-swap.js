import { register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { storage } from '../../core/firebase.js';
import { state } from '../../core/state.js';

const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

// MediaPipe FACEMESH_FACE_OVAL — 臉部外輪廓（依序連成封閉路徑）
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

const ANIMALS = ['dog', 'cat', 'rabbit', 'fox'];
const animalImages = {};
let customImage = null;

// IMAGE / VIDEO 各一個獨立 MediaPipe task，避免 runningMode 熱切換造成偵測回空
let imageTaskPromise = null;
let videoTaskPromise = null;
let liveTask = null;

let sourceImage = null;
let sourceUrl = '';
let currentLandmarks = null;
let selectedAnimal = 'dog';
let sourceMode = null;        // 'image' | 'video' | null
let cameraStream = null;
let videoLoopId = null;
let facingMode = 'user';
let lastTapAt = 0;

export function init() {
    register('view-pet-swap', {
        element: document.getElementById('view-pet-swap'),
        onShow,
    });

    document.getElementById('btn-pet-swap-back').onclick = () => switchView('view-group-setup');
    document.getElementById('btn-pet-camera').onclick = startLiveCamera;
    document.getElementById('btn-pet-flip').onclick = flipCamera;

    const albumInput = document.getElementById('pet-album-input');
    document.getElementById('btn-pet-album').onclick = () => albumInput.click();
    albumInput.onchange = e => handleFile(e.target.files?.[0]);

    const customInput = document.getElementById('pet-custom-input');
    customInput.onchange = e => handleCustomFilter(e.target.files?.[0]);

    document.getElementById('btn-pet-fav').onclick = toggleFavorite;

    // 雙擊畫面翻轉鏡頭
    document.getElementById('pet-cam-stage').addEventListener('click', onStageTap);

    // 濾鏡輪盤
    setupCarousel(customInput);

    // 結果 sheet 動作
    document.getElementById('btn-pet-generate').onclick = detectAndRender;
    document.getElementById('btn-pet-reset').onclick = resetFilterControls;
    document.getElementById('btn-pet-download').onclick = downloadCanvas;
    document.getElementById('btn-pet-set-avatar').onclick = setAsGroupAvatar;
    document.getElementById('btn-pet-adopt').onclick = adoptPet;
    ['pet-control-scale', 'pet-control-x', 'pet-control-y', 'pet-control-rotation'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderFilter);
    });

    // 預約聚會 sheet
    document.getElementById('btn-pet-schedule').onclick = () => openSheet('pet-schedule-sheet');
    document.getElementById('btn-sch-cancel').onclick = () => closeSheet('pet-schedule-sheet');
    document.getElementById('btn-sch-ics').onclick = createScheduleIcs;

    // 預載動物素材，並把縮圖塞進輪盤
    ANIMALS.forEach(name => {
        const img = getAnimalImage(name);
        const dot = document.querySelector(`.pet-filter-dot img[data-asset="${name}"]`);
        if (dot) dot.src = img.src;
    });
}

function onShow() {
    if (window.lucide) window.lucide.createIcons();
    resetView();
}

// ── 濾鏡輪盤（滑動切換，中間放大=快門） ──
function setupCarousel(customInput) {
    const carousel = document.getElementById('pet-filter-carousel');
    carousel.querySelectorAll('.pet-filter-dot').forEach(dot => {
        dot.onclick = () => {
            const animal = dot.dataset.animal;
            if (animal === 'add') { customInput.click(); return; }
            if (dot.classList.contains('active')) {
                capturePhoto();             // 點中間=快門
            } else {
                scrollDotToCenter(dot);     // 點旁邊=滑到中間選它
            }
        };
    });
    let settle = null;
    carousel.addEventListener('scroll', () => {
        clearTimeout(settle);
        settle = setTimeout(updateActiveFromScroll, 90);
    });
}

function scrollDotToCenter(dot) {
    dot.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function updateActiveFromScroll() {
    const carousel = document.getElementById('pet-filter-carousel');
    const mid = carousel.scrollLeft + carousel.clientWidth / 2;
    let best = null, bestDist = Infinity;
    carousel.querySelectorAll('.pet-filter-dot').forEach(dot => {
        const center = dot.offsetLeft + dot.offsetWidth / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) { bestDist = d; best = dot; }
    });
    if (!best) return;
    carousel.querySelectorAll('.pet-filter-dot').forEach(d => d.classList.toggle('active', d === best));
    const animal = best.dataset.animal;
    if (animal !== 'add') {
        selectedAnimal = animal;
        renderFilter();
    }
}

function onStageTap(e) {
    if (e.target.closest('button') || e.target.closest('.pet-cam-top') || e.target.closest('.pet-cam-bottom')) return;
    const now = Date.now();
    if (now - lastTapAt < 300) flipCamera();
    lastTapAt = now;
}

function toggleFavorite() {
    const btn = document.getElementById('btn-pet-fav');
    const on = btn.classList.toggle('is-fav');
    btn.style.color = on ? 'var(--accent-fire, #ff6b35)' : '';
    setStatus(on ? '已加入最愛濾鏡。' : '已移除最愛。');
}

// ── 拍照：開啟結果 sheet（微調 / 下載 / 設頭像 / 養它） ──
function capturePhoto() {
    if (!sourceReady()) {
        setStatus('先開啟鏡頭或上傳照片，再拍照。');
        return;
    }
    renderFilter();
    syncResultButtons();
    openSheet('pet-result-sheet');
}

async function handleFile(file) {
    hideError();
    if (!file || !file.type.startsWith('image/')) {
        showError('請選擇圖片檔。');
        return;
    }
    stopLiveCamera();
    sourceMode = 'image';
    currentLandmarks = null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    sourceImage = await loadImage(sourceUrl);
    resetControlValues();
    fitCanvasToImage();
    document.getElementById('pet-upload-placeholder').style.display = 'none';
    renderFilter();
    detectAndRender();   // 載入即自動定位
}

async function handleCustomFilter(file) {
    hideError();
    if (!file || !file.type.startsWith('image/')) {
        showError('請選擇圖片檔。');
        return;
    }
    customImage = await loadImage(URL.createObjectURL(file));
    // 把「+」那顆換成自訂縮圖，並選它
    const addDot = document.querySelector('.pet-filter-dot[data-animal="add"]');
    if (addDot) {
        addDot.dataset.animal = 'custom';
        addDot.innerHTML = '';
        const img = document.createElement('img');
        img.src = customImage.src;
        addDot.appendChild(img);
        addDot.classList.remove('pet-filter-add');
        addDot.onclick = () => {
            if (addDot.classList.contains('active')) capturePhoto();
            else scrollDotToCenter(addDot);
        };
        scrollDotToCenter(addDot);
    }
    selectedAnimal = 'custom';
    renderFilter();
    setStatus('已套用你的自訂濾鏡。');
}

async function startLiveCamera() {
    hideError();
    stopLiveCamera();
    if (sourceUrl) { URL.revokeObjectURL(sourceUrl); sourceUrl = ''; }
    sourceImage = null;
    sourceMode = 'video';
    currentLandmarks = null;
    liveTask = null;
    resetControlValues();
    setLoading(true);
    setStatus('正在開啟鏡頭…');

    try {
        const video = getVideo();
        cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        video.srcObject = cameraStream;
        await video.play();
        await waitForVideoSize(video);
        fitCanvasToVideo();
        document.getElementById('pet-upload-placeholder').style.display = 'none';
        try {
            liveTask = await getVideoTask();
            setStatus('左右滑選濾鏡，點中間圓圈拍照。雙擊畫面翻轉鏡頭。');
        } catch (err) {
            liveTask = null;
            setStatus('鏡頭已啟動；模型載入失敗，動物會貼在畫面中央。');
            showError(err.message || String(err));
        }
        startVideoLoop();
    } catch (err) {
        sourceMode = null;
        stopLiveCamera();
        showError(err.message || String(err));
        setStatus('鏡頭無法開啟。可以改用左下角上傳照片。');
    } finally {
        setLoading(false);
        if (window.lucide) window.lucide.createIcons();
    }
}

async function flipCamera() {
    if (sourceMode !== 'video') { startLiveCamera(); return; }
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    await startLiveCamera();
}

function waitForVideoSize(video) {
    if (video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve) => { video.onloadedmetadata = () => resolve(); });
}

function fitCanvasToVideo() {
    const video = getVideo();
    const canvas = getCanvas();
    const maxSide = 1280;
    const sw = video.videoWidth || 1280;
    const sh = video.videoHeight || 720;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
}

function startVideoLoop() {
    cancelVideoLoop();
    const tick = () => {
        if (sourceMode !== 'video') return;
        renderFilter();
        videoLoopId = requestAnimationFrame(tick);
    };
    tick();
}

function cancelVideoLoop() {
    if (videoLoopId) { cancelAnimationFrame(videoLoopId); videoLoopId = null; }
}

function stopLiveCamera() {
    cancelVideoLoop();
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    const video = getVideo();
    video.pause();
    video.srcObject = null;
    liveTask = null;
    if (sourceMode === 'video') {
        sourceMode = null;
        sourceImage = null;
        currentLandmarks = null;
        const canvas = getCanvas();
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('pet-upload-placeholder').style.display = 'flex';
    }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('圖片讀取失敗'));
        img.src = url;
    });
}

function fitCanvasToImage() {
    if (!sourceImage) return;
    const canvas = getCanvas();
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
}

async function detectAndRender() {
    if (!sourceImage || sourceMode !== 'image') return;
    setLoading(true);
    hideError();
    try {
        const task = await getImageTask();
        const result = task.detect(sourceImage);
        currentLandmarks = result.faceLandmarks?.[0] || null;
        setStatus(currentLandmarks ? '已定位臉部。' : '沒偵測到臉，請換一張更正面的照片或用滑桿手動對齊。');
    } catch (err) {
        setStatus('模型載入失敗，可用滑桿手動對齊。');
        showError(err.message || String(err));
    } finally {
        setLoading(false);
        renderFilter();
    }
}

function getImageTask() {
    if (!imageTaskPromise) imageTaskPromise = createTask('IMAGE');
    return imageTaskPromise;
}
function getVideoTask() {
    if (!videoTaskPromise) videoTaskPromise = createTask('VIDEO');
    return videoTaskPromise;
}
async function createTask(runningMode) {
    const { FaceLandmarker, FilesetResolver } = await import(MEDIAPIPE_BUNDLE);
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const base = {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode, numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
    };
    try {
        return await FaceLandmarker.createFromOptions(vision, base);
    } catch {
        return await FaceLandmarker.createFromOptions(vision, {
            ...base, baseOptions: { ...base.baseOptions, delegate: 'CPU' },
        });
    }
}

function getAnimalImage(name) {
    if (name === 'custom') return customImage;
    if (!animalImages[name]) {
        const img = new Image();
        img.src = new URL(`./assets/${name}.png`, import.meta.url).href;
        animalImages[name] = img;
    }
    return animalImages[name];
}

function isMirrored() {
    return sourceMode === 'video' && facingMode === 'user';
}

function landmarkPoints(landmarks) {
    const canvas = getCanvas();
    const mirror = isMirrored();
    return landmarks.map(p => ({
        x: mirror ? canvas.width - p.x * canvas.width : p.x * canvas.width,
        y: p.y * canvas.height,
    }));
}

function anchorFromPoints(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of FACE_OVAL) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const le = pts[LEFT_EYE_OUTER];
    const re = pts[RIGHT_EYE_OUTER];
    return {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        w: maxX - minX,
        h: maxY - minY,
        angle: Math.atan2(re.y - le.y, re.x - le.x),
    };
}

// ── 主繪製 ──
function renderFilter() {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');

    if (sourceMode === 'video' && liveTask) {
        try {
            const result = liveTask.detectForVideo(getVideo(), performance.now());
            currentLandmarks = result.faceLandmarks?.[0] || currentLandmarks;
        } catch { liveTask = null; }
    }

    if (!sourceReady()) {
        ctx.fillStyle = '#0b0b0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // 無濾鏡：純畫面直通
    if (selectedAnimal === 'none') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSourceFrame(ctx, canvas);
        return;
    }

    // 動物濾鏡：白底 → 動物身體（錨定臉、跟著動）→ 臉去背蓋上
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pts = currentLandmarks ? landmarkPoints(currentLandmarks) : null;
    if (!pts) { drawSourceFrame(ctx, canvas); return; }

    const anchor = anchorFromPoints(pts);
    const controls = readControls();
    drawAnimalBody(ctx, selectedAnimal, anchor, controls);
    drawFaceCutout(ctx, pts);
}

function sourceReady() {
    if (sourceMode === 'image') return !!sourceImage;
    if (sourceMode === 'video') {
        const v = getVideo();
        return !!(v.videoWidth && v.videoHeight);
    }
    return false;
}

function drawAnimalBody(ctx, animal, anchor, controls) {
    const img = getAnimalImage(animal);
    if (!img || !img.complete || !img.naturalWidth) return;
    const base = Math.max(anchor.w, anchor.h) * 2.2;
    const size = base * controls.scale;
    ctx.save();
    ctx.translate(anchor.cx + controls.x, anchor.cy + controls.y);
    ctx.rotate(anchor.angle + controls.rotation);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
}

function drawFaceCutout(ctx, pts) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[FACE_OVAL[0]].x, pts[FACE_OVAL[0]].y);
    for (let i = 1; i < FACE_OVAL.length; i++) {
        ctx.lineTo(pts[FACE_OVAL[i]].x, pts[FACE_OVAL[i]].y);
    }
    ctx.closePath();
    ctx.clip();
    drawSourceFrame(ctx, getCanvas());
    ctx.restore();
}

function drawSourceFrame(ctx, canvas) {
    if (sourceMode === 'image' && sourceImage) {
        ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
        return true;
    }
    if (sourceMode === 'video') {
        const video = getVideo();
        if (!video.videoWidth || !video.videoHeight) return false;
        ctx.save();
        if (isMirrored()) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        return true;
    }
    return false;
}

function readControls() {
    return {
        scale: Number(document.getElementById('pet-control-scale').value) / 100,
        x: Number(document.getElementById('pet-control-x').value),
        y: Number(document.getElementById('pet-control-y').value),
        rotation: Number(document.getElementById('pet-control-rotation').value) * Math.PI / 180,
    };
}

function resetFilterControls() {
    resetControlValues();
    renderFilter();
    setStatus('已重設微調值。');
}

function resetControlValues() {
    document.getElementById('pet-control-scale').value = '100';
    document.getElementById('pet-control-x').value = '0';
    document.getElementById('pet-control-y').value = '0';
    document.getElementById('pet-control-rotation').value = '0';
}

function downloadCanvas() {
    if (!sourceMode) return;
    renderFilter();
    const a = document.createElement('a');
    a.href = getCanvas().toDataURL('image/jpeg', 0.92);
    a.download = 'pet-face.jpg';
    a.click();
}

async function getRenderedBlob() {
    if (!sourceMode) throw new Error('請先載入照片或啟動鏡頭');
    renderFilter();
    const canvas = getCanvas();
    return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error('無法輸出圖片'));
            else resolve(blob);
        }, 'image/jpeg', 0.92);
    });
}

async function setAsGroupAvatar() {
    const groupId = state.currentGroupDetail?.group_id;
    if (!groupId) { showError('目前不是從群組頁進來，不能設為群組頭像。'); return; }
    try {
        hideError();
        const btn = document.getElementById('btn-pet-set-avatar');
        btn.disabled = true;
        btn.innerHTML = '設定中…';
        const blob = await getRenderedBlob();
        const { setGroupPetFace } = await import('../../features/groups/controller.js');
        const { res, data } = await setGroupPetFace(groupId, blob, state.petSwapTarget?.uid);
        if (!res.ok || data?.status !== 'success') throw new Error(data?.detail || `HTTP ${res.status}`);
        setStatus('已設成群組頭像。');
        closeSheet('pet-result-sheet');
        switchView('view-group-setup');
    } catch (err) {
        const btn = document.getElementById('btn-pet-set-avatar');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="image-up"></i> 設為群組頭像';
        if (window.lucide) window.lucide.createIcons();
        showError(err.message || String(err));
    }
}

async function adoptPet() {
    if (!state.currentUser) { showError('請先登入才能養寵物。'); return; }
    const adoptBtn = document.getElementById('btn-pet-adopt');
    const adoptLoad = document.getElementById('pet-adopt-loading');
    adoptBtn.disabled = true;
    adoptLoad.style.display = 'block';
    hideError();
    try {
        const blob = await getRenderedBlob();
        const uid = state.currentUser.uid;
        const file = new File([blob], 'pet.jpg', { type: 'image/jpeg' });
        const toUpload = await compressImage(file, 512, 0.85);
        const ref = storage.ref().child(`pet-images/${uid}/pet.jpg`);
        const snap = await ref.put(toUpload, { contentType: 'image/jpeg' });
        const imageUrl = await snap.ref.getDownloadURL();
        const animal = ANIMALS.includes(selectedAnimal) ? selectedAnimal : 'dog';
        await apiFetch('/api/my-pet/setup', {
            method: 'POST',
            body: JSON.stringify({ image_url: imageUrl, animal, name: '' }),
        });
        setStatus('已成功建立你的寵物。');
        closeSheet('pet-result-sheet');
        switchView('view-pet-tamagotchi');
    } catch (err) {
        showError(err.message || String(err));
    } finally {
        adoptBtn.disabled = false;
        adoptLoad.style.display = 'none';
    }
}

function compressImage(file, maxPx, quality) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxPx || height > maxPx) {
                if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
                else { width = Math.round(width * maxPx / height); height = maxPx; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

// ── 預約聚會：產生 .ics 邀請檔 ──
function createScheduleIcs() {
    const title = (document.getElementById('pet-sch-title').value || '放下手機聚一聚').trim();
    const timeVal = document.getElementById('pet-sch-time').value;
    const place = (document.getElementById('pet-sch-place').value || '').trim();
    if (!timeVal) { showError('請先選聚會時間。'); return; }
    const start = new Date(timeVal);
    if (isNaN(start.getTime())) { showError('時間格式不正確。'); return; }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phubbing//pet-swap//TW', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@phubbing`,
        `DTSTAMP:${toIcsUtc(new Date())}`,
        `DTSTART:${toIcsUtc(start)}`,
        `DTEND:${toIcsUtc(end)}`,
        `SUMMARY:${icsEscape(title)}`,
        place ? `LOCATION:${icsEscape(place)}` : '',
        'DESCRIPTION:來自 Phubbing：放下手機，好好相聚 🐾',
        'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    closeSheet('pet-schedule-sheet');
    setStatus('已產生聚會邀請（.ics），可加進行事曆或傳給朋友。');
}

function toIcsUtc(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsEscape(s) {
    return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

// ── sheet 開關 ──
function openSheet(id) {
    document.getElementById(id).hidden = false;
    if (window.lucide) window.lucide.createIcons();
}
function closeSheet(id) {
    document.getElementById(id).hidden = true;
}

function syncResultButtons() {
    const ready = sourceReady();
    document.getElementById('btn-pet-generate').disabled = !ready || sourceMode === 'video';
    document.getElementById('btn-pet-reset').disabled = !ready;
    document.getElementById('btn-pet-download').disabled = !ready;
    document.getElementById('btn-pet-adopt').disabled = !ready;
    const avatarBtn = document.getElementById('btn-pet-set-avatar');
    avatarBtn.style.display = state.currentGroupDetail?.group_id ? '' : 'none';
    avatarBtn.disabled = !ready;
    document.getElementById('pet-filter-controls').classList.toggle('is-disabled', !ready);
}

function resetView() {
    stopLiveCamera();
    closeSheet('pet-result-sheet');
    closeSheet('pet-schedule-sheet');
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = '';
    sourceImage = null;
    currentLandmarks = null;
    sourceMode = null;
    selectedAnimal = 'dog';
    resetControlValues();
    const canvas = getCanvas();
    canvas.width = 1; canvas.height = 1;
    canvas.getContext('2d').clearRect(0, 0, 1, 1);
    document.getElementById('pet-upload-placeholder').style.display = 'flex';
    setLoading(false);
    hideError();
    setStatus('開啟鏡頭，左右滑選濾鏡，點中間圓圈拍照。');
    document.getElementById('pet-adopt-loading').style.display = 'none';
    document.getElementById('pet-album-input').value = '';
    // 預設時間填 1 小時後，方便預約
    const t = new Date(Date.now() + 60 * 60 * 1000);
    t.setSeconds(0, 0);
    const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const timeInput = document.getElementById('pet-sch-time');
    if (timeInput) timeInput.value = local;
}

function setLoading(loading) {
    document.getElementById('pet-loading').style.display = loading ? 'flex' : 'none';
}
function setStatus(message) {
    document.getElementById('pet-status').textContent = message;
}
function showError(message) {
    const el = document.getElementById('pet-error');
    el.textContent = `錯誤：${message}`;
    el.style.display = 'block';
}
function hideError() {
    const el = document.getElementById('pet-error');
    el.textContent = '';
    el.style.display = 'none';
}
function getCanvas() { return document.getElementById('pet-filter-canvas'); }
function getVideo() { return document.getElementById('pet-camera-video'); }
