// views/meeting-setup/meeting-setup.js
import { back, register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import {
    CONTEXT_CONFIGS, DIFFICULTY_LABELS, EXEMPT_BUDGET_BY_CONTEXT,
    EXEMPT_WINDOW_SEC, CONTEXT_NOTES,
} from '../../core/config.js?v=62';
import { getDisplayNickname, getAuthHeaders, doSignOut } from '../../core/firebase.js?v=62';
import { apiBase } from '../../core/api.js';
import { joinRoom } from '../../core/session.js';
import { t } from '../../core/i18n.js';
import { setButtonError, setButtonPending, setButtonSuccess } from '../../core/feedback.js?v=62';
import { showToast } from '../../utils/toast.js';

export function init() {
    register('view-meeting-setup', {
        element: document.getElementById('view-meeting-setup'),
        onShow: onSetupShow,
    });

    buildContextGrid();
    bindStartMode();
    bindGroupDropdown();

    const btnConfirm = document.getElementById('btn-confirm-setup');
    if (btnConfirm) btnConfirm.onclick = handleConfirm;
    const btnCancel = document.getElementById('btn-cancel-setup');
    if (btnCancel) btnCancel.onclick = back;
    const btnSchedule = document.getElementById('btn-setup-sch-ics');
    if (btnSchedule) btnSchedule.onclick = createScheduleIcs;
}

function bindStartMode() {
    document.querySelectorAll('#view-meeting-setup .cp-mode-btn').forEach(btn => {
        btn.onclick = () => setStartMode(btn.dataset.mode || 'now');
    });
}

function setStartMode(mode) {
    const isSchedule = mode === 'schedule';
    const nowPanel = document.getElementById('setup-now-panel');
    const schedulePanel = document.getElementById('setup-schedule-panel');
    if (nowPanel) nowPanel.hidden = isSchedule;
    if (schedulePanel) schedulePanel.hidden = !isSchedule;
    document.querySelectorAll('#view-meeting-setup .cp-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });
    if (isSchedule) primeScheduleTime();
    if (window.lucide) window.lucide.createIcons();
}

// ── 自訂群組下拉 ──
function bindGroupDropdown() {
    const btn = document.getElementById('cp-group-btn');
    const list = document.getElementById('cp-group-list');
    if (!btn || !list) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        const willOpen = list.hidden;
        list.hidden = !willOpen;
        btn.setAttribute('aria-expanded', String(willOpen));
    };

    // 點選項目（事件委派）
    list.onclick = (e) => {
        const item = e.target.closest('.cp-dropdown-item');
        if (!item) return;
        selectGroup(item.dataset.gid || '', item.textContent);
    };

    // 點外面關閉
    document.addEventListener('click', (e) => {
        if (list.hidden) return;
        if (!e.target.closest('.cp-dropdown-wrap')) closeGroupDropdown();
    });
}

function closeGroupDropdown() {
    const btn = document.getElementById('cp-group-btn');
    const list = document.getElementById('cp-group-list');
    if (list) list.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function selectGroup(gid, name) {
    state.currentGroupId = gid || null;
    const val = document.getElementById('cp-group-val');
    if (val) {
        val.textContent = gid ? name : t('選擇一個群組…');
        val.classList.toggle('placeholder', !gid);
        val.classList.toggle('selected', !!gid);
    }
    closeGroupDropdown();
}

function populateGroupDropdown(groups) {
    const list = document.getElementById('cp-group-list');
    if (!list) return;
    // 第一項：不綁定
    let html = `<button class="cp-dropdown-item placeholder-item" type="button" data-gid="">${t('不綁定群組')}</button>`;
    html += (groups || []).map(g =>
        `<button class="cp-dropdown-item" type="button" data-gid="${escAttr(g.group_id)}">${escHtml(g.name || t('群組'))}</button>`
    ).join('');
    list.innerHTML = html;
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }

function buildContextGrid() {
    const grid = document.getElementById('context-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(CONTEXT_CONFIGS).forEach(([key, cfg]) => {
        const card = document.createElement('button');
        card.className = 'cp-sit-btn' + (key === 'general' ? ' active-context' : '');
        card.type = 'button';
        card.dataset.context = key;
        card.innerHTML = `<span class="cp-sit-icon"><i data-lucide="${cfg.icon}"></i></span><span class="cp-sit-label">${cfg.label}</span>`;
        card.onclick = () => selectContext(key, card);
        grid.appendChild(card);
    });
    if (window.lucide) window.lucide.createIcons();
}

function selectContext(key, card) {
    document.querySelectorAll('.cp-sit-btn').forEach(c => c.classList.remove('active-context'));
    card.classList.add('active-context');
    state.currentContext = key;

    const cfg = CONTEXT_CONFIGS[key];
    state.currentDifficulty = cfg.difficulty;
    state.currentExpectedDuration = cfg.duration;
    renderContextInfo(key);
}

// 選定情境後顯示：建議難度 + 可暫離次數/時長 + 一句注意事項（純顯示，不含評分方式）
function renderContextInfo(key) {
    const cfg = CONTEXT_CONFIGS[key];
    if (!cfg) return;
    const diffEl = document.getElementById('context-diff-label');
    const exemptEl = document.getElementById('context-exempt-label');
    const noteEl = document.getElementById('context-note');
    if (diffEl) {
        diffEl.textContent = t('建議難度：{label}', { label: DIFFICULTY_LABELS[cfg.difficulty] || cfg.difficulty });
    }
    if (exemptEl) {
        const budget = EXEMPT_BUDGET_BY_CONTEXT[key] ?? 0;
        if (budget > 0) {
            const mins = Math.round((EXEMPT_WINDOW_SEC[cfg.difficulty] || 120) / 60);
            exemptEl.textContent = t('可暫離 {n} 次（每次最多 {m} 分鐘）', { n: budget, m: mins });
        } else {
            exemptEl.textContent = t('不開放暫離');
        }
    }
    if (noteEl) noteEl.textContent = CONTEXT_NOTES[key] || '';
}

async function onSetupShow() {
    state.currentContext = 'general';
    state.currentDifficulty = 'L';
    state.currentExpectedDuration = 90;
    state.currentGroupId = null;
    setStartMode('now');

    document.querySelectorAll('.cp-sit-btn').forEach(c =>
        c.classList.toggle('active-context', c.dataset.context === 'general'));
    renderContextInfo('general');
    // 重設群組下拉為未選
    selectGroup('', '');
    closeGroupDropdown();

    // 動態 import controller，避免靜態 import 失敗影響 view 載入
    if (state.currentUser) {
        try {
            const { fetchMyGroups } = await import('../../features/groups/controller.js?v=62');
            const groups = await fetchMyGroups();
            populateGroupDropdown(groups);
        } catch (_) { /* 群組載入失敗不阻擋 */ }
    } else {
        populateGroupDropdown([]);
    }
}

async function handleConfirm() {
    const btn = document.getElementById('btn-confirm-setup');
    if (!state.currentUser && !state.localGuestActive) {
        setButtonError(btn, t('請先登入'));
        showToast(t('請先用 Google 登入才能發起聚會'), 'error');
        return;
    }

    const duration = state.currentExpectedDuration || 90;
    const groupId = state.currentUser ? (state.currentGroupId || null) : null;

    setButtonPending(btn, t('正在建立聚會室'));

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
                host_nickname: state.myNickname,
            }),
        });

        if (res.status === 401) {
            setButtonError(btn, t('登入已失效'));
            showToast(t('登入狀態失效，請重新登入'), 'error');
            await doSignOut();
            return;
        }

        const data = await res.json();
        if (!res.ok || !data?.room_id) throw new Error(data?.detail || `HTTP ${res.status}`);
        state.currentContext = data.context || state.currentContext;
        state.currentDifficulty = data.difficulty || state.currentDifficulty;
        state.currentRoomMode = data.mode || 'GATHERING';

        const qrImg = document.getElementById('qr-code-img');
        if (qrImg) {
            qrImg.src = 'data:image/png;base64,' + data.qr_base64;
            qrImg.dataset.qrUrl = data.url || `${frontendUrl}/?room=${data.room_id}`;
        }
        setButtonSuccess(btn, t('聚會室已建立'), { restoreAfter: 1600 });
        joinRoom(data.room_id);
    } catch (err) {
        console.error('create_room failed:', err);
        setButtonError(btn, t('建立失敗'));
        showToast(t('建立房間失敗：') + (err.message || err), 'error');
        state.amIHost = false;
    }
}

function primeScheduleTime() {
    const input = document.getElementById('setup-sch-time');
    if (!input || input.value) return;
    const when = new Date(Date.now() + 60 * 60 * 1000);
    when.setSeconds(0, 0);
    input.value = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function createScheduleIcs() {
    const title = (document.getElementById('setup-sch-title')?.value || t('放下手機聚一聚')).trim();
    const timeVal = document.getElementById('setup-sch-time')?.value || '';
    const place = (document.getElementById('setup-sch-place')?.value || '').trim();
    if (!timeVal) { alert(t('請先選聚會時間')); return; }
    const start = new Date(timeVal);
    if (isNaN(start.getTime())) { alert(t('時間格式不正確')); return; }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const frontendUrl = window.location.protocol + '//' + window.location.host;
    const description = `${t('來自 Phubbing：手機可以留在手上，注意力留在彼此身上。')} ${frontendUrl}`;
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phubbing//meeting-setup//TW', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@phubbing`,
        `DTSTAMP:${utc(new Date())}`,
        `DTSTART:${utc(start)}`,
        `DTEND:${utc(end)}`,
        `SUMMARY:${esc(title)}`,
        place ? `LOCATION:${esc(place)}` : '',
        `DESCRIPTION:${esc(description)}`,
        'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
