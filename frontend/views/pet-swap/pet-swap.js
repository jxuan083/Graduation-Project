import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';

const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

const LANDMARK = {
    leftEyeOuter: 33,
    rightEyeOuter: 263,
    noseTip: 1,
    forehead: 10,
    chin: 152,
    leftCheek: 234,
    rightCheek: 454,
};

let mediaPipeTaskPromise = null;
let activeMediaPipeMode = 'IMAGE';
let sourceImage = null;
let sourceUrl = '';
let currentAnchor = null;
let selectedAnimal = 'dog';
let sourceMode = null;
let cameraStream = null;
let videoLoopId = null;
let liveFaceLandmarker = null;

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

    ['pet-control-scale', 'pet-control-x', 'pet-control-y', 'pet-control-rotation'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderFilter);
    });
}

function onShow() {
    const target = state.petSwapTarget;
    const titleEl = document.querySelector('#view-pet-swap h2');
    const hintEl = document.querySelector('#view-pet-swap .pet-filter-subtitle');
    if (target?.nickname) {
        if (titleEl) titleEl.innerHTML = `<i data-lucide="paw-print"></i> ${escapeHtml(target.nickname)} 的寵物貼紙`;
        if (hintEl) hintEl.textContent = `幫 ${target.nickname} 套一張本機處理的貼紙濾鏡。`;
    } else {
        if (titleEl) titleEl.innerHTML = '<i data-lucide="paw-print"></i> 寵物貼紙濾鏡';
        if (hintEl) hintEl.textContent = '照片只在瀏覽器本機處理，不會上傳到後端。';
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
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    sourceImage = await loadImage(sourceUrl);
    resetControlValues();
    fitCanvasToImage();
    currentAnchor = makeFallbackAnchor();
    document.getElementById('pet-upload-placeholder').style.display = 'none';
    setFilterEnabled(true);
    setStatus('已載入照片。可直接下載，或按「自動定位」讓貼紙貼近臉部。');
    renderFilter();
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
    liveFaceLandmarker = null;
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
        currentAnchor = makeFallbackAnchor();
        document.getElementById('pet-upload-placeholder').style.display = 'none';
        document.getElementById('btn-pet-stop-camera').style.display = '';
        setFilterEnabled(true);

        try {
            liveFaceLandmarker = await getMediaPipeTask('VIDEO');
            setStatus('即時濾鏡啟動中。臉部定位在瀏覽器本機執行。');
        } catch (err) {
            liveFaceLandmarker = null;
            setStatus('鏡頭已啟動；模型載入失敗，已切到手動模式。');
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
    liveFaceLandmarker = null;
    document.getElementById('btn-pet-stop-camera').style.display = 'none';
    if (sourceMode === 'video') {
        sourceMode = null;
        sourceImage = null;
        currentAnchor = null;
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
        const faceLandmarker = await getMediaPipeTask('IMAGE');
        const result = faceLandmarker.detect(sourceImage);
        const landmarks = result.faceLandmarks?.[0];
        if (!landmarks) {
            currentAnchor = makeFallbackAnchor();
            setStatus('沒有偵測到臉。已切到手動模式，可用滑桿調整位置。');
        } else {
            currentAnchor = makeAnchorFromLandmarks(landmarks);
            resetControlValues();
            setStatus('已用 MediaPipe 完成本機臉部定位。');
        }
    } catch (err) {
        currentAnchor = currentAnchor || makeFallbackAnchor();
        setStatus('模型載入失敗，已切到手動模式。');
        showError(err.message || String(err));
    } finally {
        setLoading(false);
        renderFilter();
    }
}

async function getMediaPipeTask(mode) {
    const faceLandmarker = await loadMediaPipeTask();
    if (activeMediaPipeMode !== mode) {
        await faceLandmarker.setOptions({ runningMode: mode });
        activeMediaPipeMode = mode;
    }
    return faceLandmarker;
}

async function loadMediaPipeTask() {
    if (!mediaPipeTaskPromise) {
        mediaPipeTaskPromise = (async () => {
            const { FaceLandmarker, FilesetResolver } = await import(MEDIAPIPE_BUNDLE);
            const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
            const options = {
                baseOptions: {
                    modelAssetPath: FACE_MODEL,
                    delegate: 'GPU',
                },
                runningMode: 'IMAGE',
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
            };
            try {
                const task = await FaceLandmarker.createFromOptions(vision, options);
                activeMediaPipeMode = 'IMAGE';
                return task;
            } catch (err) {
                console.warn('[pet-filter] GPU delegate failed, retrying with CPU:', err);
                const task = await FaceLandmarker.createFromOptions(vision, {
                    ...options,
                    baseOptions: {
                        ...options.baseOptions,
                        delegate: 'CPU',
                    },
                });
                activeMediaPipeMode = 'IMAGE';
                return task;
            }
        })();
    }
    return mediaPipeTaskPromise;
}

function makeAnchorFromLandmarks(landmarks) {
    const canvas = getCanvas();
    const point = (idx) => {
        const x = landmarks[idx].x * canvas.width;
        return {
            x: sourceMode === 'video' ? canvas.width - x : x,
            y: landmarks[idx].y * canvas.height,
        };
    };

    const leftEye = point(LANDMARK.leftEyeOuter);
    const rightEye = point(LANDMARK.rightEyeOuter);
    const nose = point(LANDMARK.noseTip);
    const forehead = point(LANDMARK.forehead);
    const chin = point(LANDMARK.chin);
    const leftCheek = point(LANDMARK.leftCheek);
    const rightCheek = point(LANDMARK.rightCheek);
    const cheekWidth = distance(leftCheek, rightCheek);
    const faceHeight = distance(forehead, chin);

    return {
        x: nose.x,
        y: nose.y,
        angle: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
        size: Math.max(120, Math.max(cheekWidth, faceHeight * 0.72)),
    };
}

function makeFallbackAnchor() {
    const canvas = getCanvas();
    return {
        x: canvas.width * 0.5,
        y: canvas.height * 0.48,
        angle: 0,
        size: Math.max(120, Math.min(canvas.width, canvas.height) * 0.48),
    };
}

function renderFilter() {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!drawSourceFrame(ctx, canvas)) return;

    if (sourceMode === 'video' && liveFaceLandmarker) {
        try {
            const result = liveFaceLandmarker.detectForVideo(getVideo(), performance.now());
            const landmarks = result.faceLandmarks?.[0];
            if (landmarks) currentAnchor = makeAnchorFromLandmarks(landmarks);
        } catch (err) {
            console.warn('[pet-filter] live detection failed:', err);
            liveFaceLandmarker = null;
        }
    }

    const anchor = currentAnchor || makeFallbackAnchor();
    const controls = readControls();

    ctx.save();
    ctx.translate(anchor.x + controls.x, anchor.y + controls.y);
    ctx.rotate(anchor.angle + controls.rotation);
    ctx.scale(controls.scale, controls.scale);
    drawAnimal(ctx, selectedAnimal, anchor.size);
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

function drawAnimal(ctx, animal, size) {
    const drawers = {
        dog: drawDog,
        cat: drawCat,
        rabbit: drawRabbit,
        fox: drawFox,
    };
    (drawers[animal] || drawDog)(ctx, size);
}

function drawDog(ctx, s) {
    drawFloppyEar(ctx, -0.46 * s, -0.62 * s, -1, '#7a4a2f', '#d68b72', s);
    drawFloppyEar(ctx, 0.46 * s, -0.62 * s, 1, '#7a4a2f', '#d68b72', s);
    drawMuzzle(ctx, s, '#fff3df', '#2b1d18');
}

function drawCat(ctx, s) {
    drawTriangleEar(ctx, -0.38 * s, -0.7 * s, -1, '#222831', '#f8a5bc', s);
    drawTriangleEar(ctx, 0.38 * s, -0.7 * s, 1, '#222831', '#f8a5bc', s);
    drawWhiskers(ctx, s, '#f8fafc');
    drawNose(ctx, s, '#f59ab2');
}

function drawRabbit(ctx, s) {
    drawRabbitEar(ctx, -0.25 * s, -0.86 * s, -0.15, '#f8fafc', '#f9b4c9', s);
    drawRabbitEar(ctx, 0.25 * s, -0.86 * s, 0.15, '#f8fafc', '#f9b4c9', s);
    drawWhiskers(ctx, s, '#e2e8f0');
    drawNose(ctx, s, '#ff9bb6');
}

function drawFox(ctx, s) {
    drawTriangleEar(ctx, -0.4 * s, -0.68 * s, -1, '#d65f24', '#ffe1b5', s);
    drawTriangleEar(ctx, 0.4 * s, -0.68 * s, 1, '#d65f24', '#ffe1b5', s);
    drawFoxMask(ctx, s);
    drawNose(ctx, s, '#1f2937');
}

function drawFloppyEar(ctx, x, y, direction, outer, inner, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(direction * 0.25);
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(0, -0.08 * s);
    ctx.bezierCurveTo(direction * 0.3 * s, -0.12 * s, direction * 0.36 * s, 0.38 * s, direction * 0.08 * s, 0.55 * s);
    ctx.bezierCurveTo(direction * -0.2 * s, 0.42 * s, direction * -0.2 * s, 0.05 * s, 0, -0.08 * s);
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(direction * 0.05 * s, 0.2 * s, 0.1 * s, 0.28 * s, direction * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawTriangleEar(ctx, x, y, direction, outer, inner, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(0, -0.34 * s);
    ctx.lineTo(direction * 0.28 * s, 0.18 * s);
    ctx.lineTo(direction * -0.2 * s, 0.16 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.moveTo(direction * 0.01 * s, -0.18 * s);
    ctx.lineTo(direction * 0.15 * s, 0.08 * s);
    ctx.lineTo(direction * -0.09 * s, 0.08 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawRabbitEar(ctx, x, y, rotation, outer, inner, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.ellipse(0, -0.12 * s, 0.12 * s, 0.47 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.ellipse(0, -0.1 * s, 0.055 * s, 0.33 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawMuzzle(ctx, s, fill, noseFill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(-0.12 * s, 0.17 * s, 0.18 * s, 0.16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(0.12 * s, 0.17 * s, 0.18 * s, 0.16 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawNose(ctx, s, noseFill);
    ctx.strokeStyle = 'rgba(43,29,24,0.65)';
    ctx.lineWidth = Math.max(2, s * 0.018);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0.07 * s);
    ctx.quadraticCurveTo(0, 0.23 * s, -0.08 * s, 0.3 * s);
    ctx.moveTo(0, 0.23 * s);
    ctx.quadraticCurveTo(0.02 * s, 0.3 * s, 0.1 * s, 0.3 * s);
    ctx.stroke();
    ctx.restore();
}

function drawFoxMask(ctx, s) {
    ctx.save();
    ctx.fillStyle = 'rgba(214, 95, 36, 0.88)';
    ctx.beginPath();
    ctx.moveTo(-0.5 * s, -0.16 * s);
    ctx.quadraticCurveTo(-0.12 * s, -0.45 * s, 0, -0.02 * s);
    ctx.quadraticCurveTo(0.12 * s, -0.45 * s, 0.5 * s, -0.16 * s);
    ctx.quadraticCurveTo(0.22 * s, 0.2 * s, 0, 0.12 * s);
    ctx.quadraticCurveTo(-0.22 * s, 0.2 * s, -0.5 * s, -0.16 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 243, 224, 0.92)';
    ctx.beginPath();
    ctx.ellipse(0, 0.12 * s, 0.28 * s, 0.18 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawWhiskers(ctx, s, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.012);
    ctx.lineCap = 'round';
    const ys = [-0.01, 0.08, 0.17];
    for (const y of ys) {
        ctx.beginPath();
        ctx.moveTo(-0.08 * s, y * s);
        ctx.lineTo(-0.44 * s, (y - 0.08) * s);
        ctx.moveTo(0.08 * s, y * s);
        ctx.lineTo(0.44 * s, (y - 0.08) * s);
        ctx.stroke();
    }
    drawNose(ctx, s, '#f9a8d4');
    ctx.restore();
}

function drawNose(ctx, s, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.075 * s, 0.055 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    currentAnchor = currentAnchor || makeFallbackAnchor();
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
    a.download = 'pet-filter.jpg';
    a.click();
}

function resetView() {
    stopLiveCamera();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = '';
    sourceImage = null;
    currentAnchor = null;
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
    setStatus('請選擇一張正臉照片。');
    document.getElementById('pet-album-input').value = '';
}

function setFilterEnabled(enabled) {
    document.getElementById('btn-pet-generate').disabled = !enabled || sourceMode === 'video';
    document.getElementById('btn-pet-reset').disabled = !enabled;
    document.getElementById('btn-pet-download').disabled = !enabled;
    document.getElementById('pet-filter-controls').classList.toggle('is-disabled', !enabled);
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

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
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
