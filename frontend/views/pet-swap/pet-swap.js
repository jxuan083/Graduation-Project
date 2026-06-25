import { register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { storage } from '../../core/firebase.js';
import { state } from '../../core/state.js';

const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

// MediaPipe FACEMESH_FACE_OVAL — 臉部外輪廓那一圈（依序連成封閉路徑）
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

// 動物身體素材（自 host 的透明 PNG），跟 .pet-template-btn 的 data-animal 對應
const ANIMALS = ['dog', 'cat', 'rabbit', 'fox'];
const animalImages = {};

// 兩個獨立的 MediaPipe task：IMAGE / VIDEO 不共用同一個 instance，
// 避免 runningMode 熱切換造成第一次偵測回空（傳圖抓不到臉的根因）。
let imageTaskPromise = null;
let videoTaskPromise = null;
let liveTask = null;

let sourceImage = null;
let sourceUrl = '';
let currentLandmarks = null;   // 最近一次偵測到的 478 點（normalized）
let selectedAnimal = 'dog';
let sourceMode = null;         // 'image' | 'video' | null
let cameraStream = null;
let videoLoopId = null;

export function init() {
    register('view-pet-swap', {
        element: document.getElementById('view-pet-swap'),
        onShow,
    });

    document.getElementById('btn-pet-swap-back').onclick = () => switchView('view-group-setup');

    const albumInput = document.getElementById('pet-album-input');
    const placeholder = document.getElementById('pet-upload-placeholder');

    document.getElementById('btn-pet-camera').onclick = startLiveCamera;
    document.getElementById('btn-pet-stop-camera').onclick = stopLiveCamera;
    document.getElementById('btn-pet-album').onclick = () => albumInput.click();
    placeholder.onclick = () => albumInput.click();
    albumInput.onchange = e => handleFile(e.target.files?.[0]);

    document.querySelectorAll('.pet-template-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.pet-template-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedAnimal = btn.dataset.animal || 'dog';
            renderFilter();
        };
    });

    document.getElementById('btn-pet-generate').onclick = detectAndRender;
    document.getElementById('btn-pet-reset').onclick = resetFilterControls;
    document.getElementById('btn-pet-download').onclick = downloadCanvas;
    document.getElementById('btn-pet-set-avatar').onclick = setAsGroupAvatar;
    document.getElementById('btn-pet-adopt').onclick = adoptPet;

    ['pet-control-scale', 'pet-control-x', 'pet-control-y', 'pet-control-rotation'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderFilter);
    });

    // 預載動物素材
    ANIMALS.forEach(getAnimalImage);
}

function onShow() {
    const target = state.petSwapTarget;
    const titleEl = document.querySelector('#view-pet-swap h2');
    const hintEl = document.querySelector('#view-pet-swap .pet-filter-subtitle');
    if (target?.nickname) {
        if (titleEl) titleEl.innerHTML = `<i data-lucide="paw-print"></i> ${escapeHtml(target.nickname)} 的寵物貼紙`;
        if (hintEl) hintEl.textContent = `定位臉部 → 接到動物身體上。全程在本機處理，你決定後才上傳。`;
    } else {
        if (titleEl) titleEl.innerHTML = '<i data-lucide="paw-print"></i> 寵物臉合成';
        if (hintEl) hintEl.textContent = '上傳照片或開鏡頭，把你的臉接到動物身體上。照片只在瀏覽器本機處理。';
    }
    if (window.lucide) window.lucide.createIcons();
    resetView();
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
    setFilterEnabled(true);
    renderFilter();
    // 載入即自動定位，不用使用者再按一次
    detectAndRender();
}

async function startLiveCamera() {
    hideError();
    stopLiveCamera();
    if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
        sourceUrl = '';
    }
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
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        });
        video.srcObject = cameraStream;
        await video.play();
        await waitForVideoSize(video);
        fitCanvasToVideo();
        document.getElementById('pet-upload-placeholder').style.display = 'none';
        document.getElementById('btn-pet-stop-camera').style.display = '';
        setFilterEnabled(true);

        try {
            liveTask = await getVideoTask();
            setStatus('即時合成啟動中。臉部定位在瀏覽器本機執行。');
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
        setStatus('鏡頭無法開啟。可以改用相簿照片模式。');
    } finally {
        setLoading(false);
        if (window.lucide) window.lucide.createIcons();
    }
}

function waitForVideoSize(video) {
    if (video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
    });
}

function fitCanvasToVideo() {
    const video = getVideo();
    const canvas = getCanvas();
    const maxSide = 1280;
    const sourceW = video.videoWidth || 1280;
    const sourceH = video.videoHeight || 720;
    const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
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
    if (videoLoopId) {
        cancelAnimationFrame(videoLoopId);
        videoLoopId = null;
    }
}

function stopLiveCamera() {
    cancelVideoLoop();
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const video = getVideo();
    video.pause();
    video.srcObject = null;
    liveTask = null;
    document.getElementById('btn-pet-stop-camera').style.display = 'none';
    if (sourceMode === 'video') {
        sourceMode = null;
        sourceImage = null;
        currentLandmarks = null;
        const canvas = getCanvas();
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('pet-upload-placeholder').style.display = 'flex';
        setFilterEnabled(false);
        setStatus('鏡頭已停止。可重新開啟即時鏡頭或選擇照片。');
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
        if (currentLandmarks) {
            setStatus('已定位臉部，動物身體已對齊。可用滑桿微調。');
        } else {
            setStatus('沒偵測到臉。請換一張更正面、清楚的照片，或用滑桿手動對齊。');
        }
    } catch (err) {
        setStatus('模型載入失敗，可用滑桿手動對齊。');
        showError(err.message || String(err));
    } finally {
        setLoading(false);
        renderFilter();
    }
}

// ── MediaPipe task：IMAGE / VIDEO 各一個獨立 instance ──
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
        runningMode,
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
    };
    try {
        return await FaceLandmarker.createFromOptions(vision, base);
    } catch {
        // GPU delegate 在部分瀏覽器會靜默失敗 → fallback CPU
        return await FaceLandmarker.createFromOptions(vision, {
            ...base,
            baseOptions: { ...base.baseOptions, delegate: 'CPU' },
        });
    }
}

// ── 影像素材 ──
function getAnimalImage(name) {
    if (!animalImages[name]) {
        const img = new Image();
        img.src = new URL(`./assets/${name}.png`, import.meta.url).href;
        animalImages[name] = img;
    }
    return animalImages[name];
}

// ── 座標換算：normalized landmark → canvas 像素（video 為鏡像）──
function landmarkPoints(landmarks) {
    const canvas = getCanvas();
    return landmarks.map(p => ({
        x: sourceMode === 'video' ? canvas.width - p.x * canvas.width : p.x * canvas.width,
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

function fallbackAnchor() {
    const canvas = getCanvas();
    const size = Math.min(canvas.width, canvas.height) * 0.5;
    return { cx: canvas.width * 0.5, cy: canvas.height * 0.5, w: size, h: size, angle: 0 };
}

// ── 主繪製：白底 → 動物身體（錨定臉、跟著動）→ 臉部去背蓋上 ──
function renderFilter() {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // video 模式：每幀即時偵測，臉跑哪動物貼哪
    if (sourceMode === 'video' && liveTask) {
        try {
            const result = liveTask.detectForVideo(getVideo(), performance.now());
            currentLandmarks = result.faceLandmarks?.[0] || currentLandmarks;
        } catch {
            liveTask = null;
        }
    }

    if (!sourceReady()) return;

    const pts = currentLandmarks ? landmarkPoints(currentLandmarks) : null;

    // 還沒定位到臉：先把來源畫面整張顯示，讓使用者看得到、可按「自動定位」
    if (!pts) {
        drawSourceFrame(ctx, canvas);
        return;
    }

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

// 把動物身體 PNG 依臉的位置/大小/傾角貼上（畫在臉下方一層，臉會蓋住動物的臉）
function drawAnimalBody(ctx, animal, anchor, controls) {
    const img = getAnimalImage(animal);
    if (!img.complete || !img.naturalWidth) return;
    const base = Math.max(anchor.w, anchor.h) * 2.2;
    const size = base * controls.scale;
    ctx.save();
    ctx.translate(anchor.cx + controls.x, anchor.cy + controls.y);
    ctx.rotate(anchor.angle + controls.rotation);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
}

// 用 FACE_OVAL 把臉橢圓去背，畫在動物身體之上
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
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
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
    const canvas = getCanvas();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.92);
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
    if (!groupId) {
        showError('目前不是從群組頁進來，不能設為群組頭像。');
        return;
    }
    try {
        hideError();
        const btn = document.getElementById('btn-pet-set-avatar');
        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '設定中…';
        const blob = await getRenderedBlob();
        const { setGroupPetFace } = await import('../../features/groups/controller.js');
        const { res, data } = await setGroupPetFace(groupId, blob, state.petSwapTarget?.uid);
        if (!res.ok || data?.status !== 'success') throw new Error(data?.detail || `HTTP ${res.status}`);
        setStatus('已設成群組頭像。');
        switchView('view-group-setup');
        btn.innerHTML = old;
    } catch (err) {
        document.getElementById('btn-pet-set-avatar').disabled = false;
        document.getElementById('btn-pet-set-avatar').innerHTML = '<i data-lucide="image-up"></i> 設為群組頭像';
        if (window.lucide) window.lucide.createIcons();
        showError(err.message || String(err));
    }
}

async function adoptPet() {
    if (!state.currentUser) {
        showError('請先登入才能養寵物。');
        return;
    }

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
        await apiFetch('/api/my-pet/setup', {
            method: 'POST',
            body: JSON.stringify({ image_url: imageUrl, animal: selectedAnimal, name: '' }),
        });
        setStatus('已成功建立你的寵物。');
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
                if (width > height) {
                    height = Math.round(height * maxPx / width);
                    width = maxPx;
                } else {
                    width = Math.round(width * maxPx / height);
                    height = maxPx;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file);
        };
        img.src = url;
    });
}

function resetView() {
    stopLiveCamera();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = '';
    sourceImage = null;
    currentLandmarks = null;
    sourceMode = null;
    selectedAnimal = 'dog';
    resetControlValues();
    document.querySelectorAll('.pet-template-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.animal === 'dog');
    });
    const canvas = getCanvas();
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext('2d').clearRect(0, 0, 1, 1);
    document.getElementById('pet-upload-placeholder').style.display = 'flex';
    setFilterEnabled(false);
    setLoading(false);
    hideError();
    setStatus('請選擇一張正臉照片，或開啟即時鏡頭。');
    document.getElementById('pet-adopt-loading').style.display = 'none';
    document.getElementById('pet-album-input').value = '';
    const avatarBtn = document.getElementById('btn-pet-set-avatar');
    avatarBtn.style.display = state.currentGroupDetail?.group_id ? '' : 'none';
    avatarBtn.disabled = true;
}

function setFilterEnabled(enabled) {
    const canUse = Boolean(enabled);
    document.getElementById('btn-pet-generate').disabled = !canUse || sourceMode === 'video';
    document.getElementById('btn-pet-reset').disabled = !canUse;
    document.getElementById('btn-pet-download').disabled = !canUse;
    document.getElementById('btn-pet-adopt').disabled = !canUse;
    const avatarBtn = document.getElementById('btn-pet-set-avatar');
    avatarBtn.style.display = state.currentGroupDetail?.group_id ? '' : 'none';
    avatarBtn.disabled = !canUse;
    document.getElementById('pet-filter-controls').classList.toggle('is-disabled', !canUse);
}

function setLoading(loading) {
    document.getElementById('pet-loading').style.display = loading ? 'flex' : 'none';
    document.getElementById('btn-pet-generate').disabled = loading || !sourceImage || sourceMode === 'video';
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

function getCanvas() {
    return document.getElementById('pet-filter-canvas');
}

function getVideo() {
    return document.getElementById('pet-camera-video');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}
