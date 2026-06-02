import { register, switchView } from '../../core/router.js';
import { apiBase } from '../../core/api.js';
import { getAuthHeaders } from '../../core/firebase.js';
import { state } from '../../core/state.js';

// 最近一次合成結果的原始 blob（供「設為群組頭像」上傳，免得重跑 face_swap）
let lastResultBlob = null;

export function init() {
    register('view-pet-swap', {
        element: document.getElementById('view-pet-swap'),
        onShow: onShow,
    });

    document.getElementById('btn-pet-swap-back').onclick = () => switchView('view-group-setup');

    const cameraInput = document.getElementById('pet-camera-input');
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

    document.getElementById('btn-pet-camera').onclick = () => cameraInput.click();
    document.getElementById('btn-pet-album').onclick  = () => albumInput.click();
    placeholder.onclick = () => albumInput.click();
    cameraInput.onchange = e => handleFile(e.target.files[0]);
    albumInput.onchange  = e => handleFile(e.target.files[0]);

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
        // 成功 → 自動跳回群組設定頁（onShow 會重新抓 detail 並換上新頭像）
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

function onShow() {
    const target = state.petSwapTarget;
    const titleEl = document.querySelector('#view-pet-swap h2');
    const hintEl  = document.querySelector('#view-pet-swap p.hint');
    if (target?.nickname) {
        if (titleEl) titleEl.textContent = `🐾 ${target.nickname} 的寵物臉`;
        if (hintEl)  hintEl.textContent  = `上傳 ${target.nickname} 的正臉照片，合成專屬動物臉！`;
    } else {
        if (titleEl) titleEl.textContent = '🐾 寵物臉生成器';
        if (hintEl)  hintEl.textContent  = '上傳一張正臉照片，合成專屬寵物臉！';
    }
    document.getElementById('pet-preview-wrap').style.display = 'none';
    document.getElementById('pet-upload-placeholder').style.display = 'flex';
    document.getElementById('btn-pet-generate').disabled = true;
    document.getElementById('pet-result-wrap').style.display = 'none';
    document.getElementById('pet-error').style.display = 'none';
    document.getElementById('pet-album-input').value = '';
    document.getElementById('pet-camera-input').value = '';
    lastResultBlob = null;
    const btnSetAvatar = document.getElementById('btn-pet-set-avatar');
    if (btnSetAvatar) btnSetAvatar.style.display = 'none';
}

async function generatePetFace() {
    const cameraInput = document.getElementById('pet-camera-input');
    const albumInput  = document.getElementById('pet-album-input');
    const file = cameraInput.files[0] || albumInput.files[0];
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
        const formData = new FormData();
        formData.append('image', file);
        formData.append('animal', animal);

        const headers = await getAuthHeaders();
        delete headers['Content-Type'];
        const response = await fetch(apiBase + '/api/pet-swap', {
            method: 'POST',
            headers,
            body: formData,
        });

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
