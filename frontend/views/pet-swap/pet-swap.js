import { register, switchView } from '../../core/router.js';
import { apiBase, apiFetch } from '../../core/api.js';
import { getAuthHeaders, storage } from '../../core/firebase.js';
import { state } from '../../core/state.js';

// 最近一次合成結果的原始 blob（供「設為群組頭像」上傳，免得重跑 face_swap）
let lastResultBlob = null;

// 相機狀態
let _cameraStream = null;
let _facingMode   = 'user';  // 預設前鏡頭（拍臉用）

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function init() {
    register('view-pet-swap', {
        element: document.getElementById('view-pet-swap'),
        onShow: onShow,
        onHide: closeCamera,
    });

    document.getElementById('btn-pet-swap-back').onclick = () => switchView('view-group-setup');

    const albumInput  = document.getElementById('pet-album-input');
    const previewImg  = document.getElementById('pet-preview-img');
    const previewWrap = document.getElementById('pet-preview-wrap');
    const placeholder = document.getElementById('pet-upload-placeholder');
    const btnGenerate = document.getElementById('btn-pet-generate');

    function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        const url = URL.createObjectURL(file);
        previewImg.src = url;
        previewWrap.style.display = 'block';
        placeholder.style.display = 'none';
        btnGenerate.disabled = false;
        document.getElementById('pet-result-wrap').style.display = 'none';
        document.getElementById('pet-error').style.display = 'none';
    }

    document.getElementById('btn-pet-camera').onclick = openCamera;
    document.getElementById('btn-pet-album').onclick  = () => albumInput.click();
    placeholder.onclick = () => albumInput.click();
    albumInput.onchange = e => handleFile(e.target.files[0]);
    const cameraInput = document.getElementById('pet-camera-input');
    if (cameraInput) cameraInput.onchange = e => handleFile(e.target.files[0]);

    // 相機 Modal 按鈕
    document.getElementById('btn-camera-close').onclick = closeCamera;
    document.getElementById('btn-camera-flip').onclick  = flipCamera;
    document.getElementById('btn-camera-snap').onclick  = snapPhoto;

    document.querySelectorAll('.pet-template-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.pet-template-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });

    btnGenerate.onclick = generatePetFace;

    document.getElementById('btn-pet-download').onclick = () => {
        const img = document.getElementById('pet-result-img');
        if (!img.src) return;
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'pet_face.jpg';
        a.click();
    };

    const btnSetAvatar = document.getElementById('btn-pet-set-avatar');
    if (btnSetAvatar) btnSetAvatar.onclick = setAsGroupAvatar;

    document.getElementById('btn-pet-adopt').onclick = adoptPet;
}

// ── 相機 Modal ──
let _selectedDeviceId = null;

async function openCamera() {
    const modal = document.getElementById('pet-camera-modal');
    modal.style.display = 'flex';
    await startStream();
    await populateCameraSelect();
}

async function startStream() {
    stopStream();
    try {
        const constraint = _selectedDeviceId
            ? { deviceId: { exact: _selectedDeviceId } }
            : { facingMode: _facingMode };
        _cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { ...constraint, width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false,
        });
        const video = document.getElementById('pet-camera-video');
        video.srcObject = _cameraStream;
        video.style.transform = _facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
    } catch (err) {
        closeCamera();
        // getUserMedia 不可用（HTTP 環境）→ fallback 到 capture input
        const camInput = document.getElementById('pet-camera-input');
        if (camInput) { camInput.click(); return; }
        alert('無法開啟相機：' + (err.message || err) + '\n\n請改用相簿上傳照片。');
    }
}

async function populateCameraSelect() {
    const sel = document.getElementById('pet-camera-select');
    if (!sel) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        if (cameras.length <= 1 || isMobile) { sel.style.display = 'none'; return; }
        sel.innerHTML = cameras.map((d, i) =>
            `<option value="${d.deviceId}">${d.label || '相機 ' + (i + 1)}</option>`
        ).join('');
        // 預設選目前正在用的設備
        const activeId = _cameraStream?.getVideoTracks()[0]?.getSettings()?.deviceId;
        if (activeId) sel.value = activeId;
        sel.style.display = 'block';
        sel.onchange = async () => {
            _selectedDeviceId = sel.value;
            _facingMode = 'user';
            await startStream();
        };
    } catch (_) { sel.style.display = 'none'; }
}

function stopStream() {
    if (_cameraStream) {
        _cameraStream.getTracks().forEach(t => t.stop());
        _cameraStream = null;
    }
}

function closeCamera() {
    stopStream();
    document.getElementById('pet-camera-modal').style.display = 'none';
    document.getElementById('pet-camera-video').srcObject = null;
}

async function flipCamera() {
    _selectedDeviceId = null;   // 清掉 deviceId，改回用 facingMode
    _facingMode = _facingMode === 'user' ? 'environment' : 'user';
    await startStream();
}

function snapPhoto() {
    const video  = document.getElementById('pet-camera-video');
    const canvas = document.getElementById('pet-camera-canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // 前鏡頭要水平翻回來再存（顯示時是鏡像，儲存要正確方向）
    if (_facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
        if (!blob) return;
        closeCamera();
        // 把 blob 當作選好的檔案處理
        const file = new File([blob], 'camera.jpg', { type: 'image/jpeg' });
        const url = URL.createObjectURL(file);
        document.getElementById('pet-preview-img').src = url;
        document.getElementById('pet-preview-wrap').style.display = 'block';
        document.getElementById('pet-upload-placeholder').style.display = 'none';
        document.getElementById('btn-pet-generate').disabled = false;
        document.getElementById('pet-result-wrap').style.display = 'none';
        document.getElementById('pet-error').style.display = 'none';
        // 把 file 暫存到 album input，讓 generatePetFace 可以取到
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById('pet-album-input').files = dt.files;
    }, 'image/jpeg', 0.92);
}

async function setAsGroupAvatar() {
    const groupId = state.currentGroupDetail?.group_id;
    if (!groupId || !lastResultBlob) return;
    const btn = document.getElementById('btn-pet-set-avatar');
    const errorEl = document.getElementById('pet-error');
    btn.disabled = true;
    btn.innerHTML = '設定中…';
    errorEl.style.display = 'none';
    try {
        const { setGroupPetFace } = await import('../../features/groups/controller.js');
        const { res, data } = await setGroupPetFace(groupId, lastResultBlob, state.petSwapTarget?.uid);
        if (!res.ok || data?.status !== 'success') {
            throw new Error(data?.detail || `HTTP ${res.status}`);
        }
        switchView('view-group-setup');
    } catch (err) {
        errorEl.textContent = '設定頭像失敗：' + (err.message || err);
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="image-up"></i> 設為群組頭像';
        if (window.lucide?.createIcons) window.lucide.createIcons();
    }
}

async function adoptPet() {
    if (!state.currentUser) {
        alert('請先登入才能養寵物');
        return;
    }
    if (!lastResultBlob) {
        alert('請先生成寵物臉再養它！');
        return;
    }

    const adoptBtn  = document.getElementById('btn-pet-adopt');
    const adoptLoad = document.getElementById('pet-adopt-loading');
    adoptBtn.disabled = true;
    adoptLoad.style.display = 'block';

    try {
        const uid = state.currentUser.uid;
        const toUpload = await compressImage(
            new File([lastResultBlob], 'pet.jpg', { type: 'image/jpeg' }), 512, 0.85
        );
        const ref = storage.ref().child(`pet-images/${uid}/pet.jpg`);
        const snap = await ref.put(toUpload, { contentType: 'image/jpeg' });
        const imageUrl = await snap.ref.getDownloadURL();

        const animal = document.querySelector('.pet-template-btn.active')?.dataset.animal || 'dog';
        await apiFetch('/api/my-pet/setup', {
            method: 'POST',
            body: JSON.stringify({ image_url: imageUrl, animal, name: '' }),
        });

        switchView('view-pet-tamagotchi');
    } catch (err) {
        alert('上傳失敗：' + (err.message || err));
    } finally {
        adoptBtn.disabled = false;
        adoptLoad.style.display = 'none';
    }
}

function onShow() {
    const target = state.petSwapTarget;
    const titleEl = document.querySelector('#view-pet-swap h2');
    const hintEl  = document.querySelector('#view-pet-swap p.hint');
    if (target?.nickname) {
        if (titleEl) titleEl.innerHTML = `<i data-lucide="paw-print"></i> ${escHtml(target.nickname)} 的寵物臉`;
        if (hintEl)  hintEl.textContent  = `上傳 ${target.nickname} 的正臉照片，合成專屬動物臉！`;
    } else {
        if (titleEl) titleEl.innerHTML = '<i data-lucide="paw-print"></i> 寵物臉生成器';
        if (hintEl)  hintEl.textContent  = '上傳一張正臉照片，合成專屬寵物臉！';
    }
    document.getElementById('pet-preview-wrap').style.display = 'none';
    document.getElementById('pet-upload-placeholder').style.display = 'flex';
    document.getElementById('btn-pet-generate').disabled = true;
    document.getElementById('pet-result-wrap').style.display = 'none';
    document.getElementById('pet-error').style.display = 'none';
    document.getElementById('pet-album-input').value = '';
    const _ci = document.getElementById('pet-camera-input');
    if (_ci) _ci.value = '';
    lastResultBlob = null;
    const btnSetAvatar = document.getElementById('btn-pet-set-avatar');
    if (btnSetAvatar) btnSetAvatar.style.display = 'none';
    document.getElementById('btn-pet-adopt').disabled = false;
    document.getElementById('pet-adopt-loading').style.display = 'none';
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
                else                { width  = Math.round(width  * maxPx / height); height = maxPx; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

async function generatePetFace() {
    const albumInput  = document.getElementById('pet-album-input');
    const camInput    = document.getElementById('pet-camera-input');
    const file = albumInput.files[0] || camInput?.files[0];
    if (!file) return;

    const animal = document.querySelector('.pet-template-btn.active')?.dataset.animal || 'dog';
    const loading    = document.getElementById('pet-loading');
    const resultWrap = document.getElementById('pet-result-wrap');
    const errorEl    = document.getElementById('pet-error');
    const btnGenerate = document.getElementById('btn-pet-generate');

    loading.style.display = 'block';
    resultWrap.style.display = 'none';
    errorEl.style.display = 'none';
    btnGenerate.disabled = true;

    try {
        // 壓縮圖片到最大 1024px，避免 iOS 大檔導致 fetch 失敗
        let compressed;
        try {
            compressed = await compressImage(file, 1024, 0.88);
        } catch (compErr) {
            throw new Error(`壓縮圖片失敗: ${compErr.message}`);
        }

        const formData = new FormData();
        formData.append('image', compressed, 'face.jpg');
        formData.append('animal', animal);

        const headers = await getAuthHeaders();
        delete headers['Content-Type'];

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        let response;
        try {
            response = await fetch(apiBase + '/api/pet-swap', {
                method: 'POST',
                headers,
                body: formData,
                signal: controller.signal,
            });
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') throw new Error('合成超時（90秒），請再試一次');
            throw new Error(`網路錯誤 [${fetchErr.name}] ${fetchErr.message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const json = await response.json().catch(() => ({}));
            const detail = Array.isArray(json.detail)
                ? json.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
                : (json.detail || '合成失敗');
            throw new Error(detail);
        }

        const blob = await response.blob();
        lastResultBlob = blob;
        const url = URL.createObjectURL(blob);
        document.getElementById('pet-result-img').src = url;
        resultWrap.style.display = 'block';
        // 有群組情境才顯示「設為群組頭像」
        const btnSetAvatar = document.getElementById('btn-pet-set-avatar');
        if (btnSetAvatar) btnSetAvatar.style.display = state.currentGroupDetail?.group_id ? '' : 'none';
        resultWrap.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        errorEl.textContent = '錯誤：' + (err.message || err);
        errorEl.style.display = 'block';
    } finally {
        loading.style.display = 'none';
        btnGenerate.disabled = false;
    }
}
