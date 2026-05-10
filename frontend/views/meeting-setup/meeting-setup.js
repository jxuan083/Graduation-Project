// views/meeting-setup/meeting-setup.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { CONTEXT_CONFIGS, DIFFICULTY_LABELS } from '../../core/config.js';
import { getDisplayNickname, getAuthHeaders, doSignOut } from '../../core/firebase.js';
import { apiBase } from '../../core/api.js';
import { joinRoom } from '../../core/session.js';

const DIFF_HINTS = {
    L: '寬鬆模式：較長的緩衝時間，適合輕鬆聚會',
    M: '標準模式：平衡體驗，多數場合適用',
    H: '嚴格模式：短緩衝、高懲罰，適合上課或正式會議',
};

export function init() {
    register('view-meeting-setup', {
        element: document.getElementById('view-meeting-setup'),
        onShow: onSetupShow,
    });

    buildContextGrid();
    bindDiffBtns();

    const btnConfirm = document.getElementById('btn-confirm-setup');
    if (btnConfirm) btnConfirm.onclick = handleConfirm;
    const btnCancel = document.getElementById('btn-cancel-setup');
    if (btnCancel) btnCancel.onclick = () => switchView('view-home');
}

function buildContextGrid() {
    const grid = document.getElementById('context-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(CONTEXT_CONFIGS).forEach(([key, cfg]) => {
        const card = document.createElement('button');
        card.className = 'context-card' + (key === 'general' ? ' active-context' : '');
        card.dataset.context = key;
        card.innerHTML = `<span class="ctx-icon">${cfg.icon}</span><span class="ctx-label">${cfg.label}</span>`;
        card.onclick = () => selectContext(key, card);
        grid.appendChild(card);
    });
}

function selectContext(key, card) {
    document.querySelectorAll('.context-card').forEach(c => c.classList.remove('active-context'));
    card.classList.add('active-context');
    state.currentContext = key;

    const cfg = CONTEXT_CONFIGS[key];
    state.currentDifficulty = cfg.difficulty;
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.toggle('active-diff', b.dataset.diff === cfg.difficulty);
    });
    updateDiffHint(cfg.difficulty);

    const durInput = document.getElementById('duration-input');
    if (durInput) durInput.value = cfg.duration;
    state.currentExpectedDuration = cfg.duration;
}

function bindDiffBtns() {
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active-diff'));
            btn.classList.add('active-diff');
            state.currentDifficulty = btn.dataset.diff;
            updateDiffHint(btn.dataset.diff);
        };
    });
    updateDiffHint(state.currentDifficulty || 'M');
}

function updateDiffHint(diff) {
    const el = document.getElementById('difficulty-hint');
    if (el) el.textContent = DIFF_HINTS[diff] || '';
}

async function onSetupShow() {
    state.currentContext = 'general';
    state.currentDifficulty = 'L';
    state.currentExpectedDuration = 90;
    state.currentGroupId = null;

    document.querySelectorAll('.context-card').forEach(c =>
        c.classList.toggle('active-context', c.dataset.context === 'general'));
    document.querySelectorAll('.diff-btn').forEach(b =>
        b.classList.toggle('active-diff', b.dataset.diff === 'L'));
    updateDiffHint('L');
    const durInput = document.getElementById('duration-input');
    if (durInput) durInput.value = 90;

    // 動態 import controller，避免靜態 import 失敗影響 view 載入
    if (state.currentUser) {
        try {
            const { fetchMyGroups } = await import('../../features/groups/controller.js');
            const groups = await fetchMyGroups();
            const sel = document.getElementById('group-select');
            if (sel) {
                sel.innerHTML = '<option value="">— 不綁定群組 —</option>';
                groups.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.group_id;
                    opt.textContent = g.name;
                    sel.appendChild(opt);
                });
            }
        } catch (_) { /* 群組載入失敗不阻擋 */ }
    }
}

async function handleConfirm() {
    if (!state.currentUser) {
        alert('請先用 Google 登入才能發起聚會');
        return;
    }

    const durInput = document.getElementById('duration-input');
    const duration = parseInt(durInput?.value || '90', 10);
    const groupSel = document.getElementById('group-select');
    const groupId = groupSel?.value || null;

    state.currentExpectedDuration = duration;
    state.currentGroupId = groupId || null;

    const btn = document.getElementById('btn-confirm-setup');
    if (btn) { btn.disabled = true; btn.textContent = '建立中…'; }

    try {
        state.amIHost = true;
        state.myNickname = getDisplayNickname() || '房主';

        const frontendUrl = window.location.protocol + '//' + window.location.host;
        const res = await fetch(`${apiBase}/api/create_room`, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: JSON.stringify({
                frontend_url: frontendUrl,
                context: state.currentContext,
                difficulty: state.currentDifficulty,
                expected_duration_min: duration,
                group_id: groupId || null,
            }),
        });

        if (res.status === 401) {
            alert('登入狀態失效，請重新登入');
            await doSignOut();
            return;
        }

        const data = await res.json();
        state.currentContext = data.context || state.currentContext;
        state.currentDifficulty = data.difficulty || state.currentDifficulty;
        state.currentRoomMode = data.mode || 'GATHERING';

        document.getElementById('qr-code-img').src = 'data:image/png;base64,' + data.qr_base64;
        joinRoom(data.room_id);
    } catch (err) {
        console.error('create_room failed:', err);
        alert('建立房間失敗：' + (err.message || err));
        state.amIHost = false;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '建立房間'; }
    }
}
