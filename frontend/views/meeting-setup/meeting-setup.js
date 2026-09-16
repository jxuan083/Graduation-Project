// views/meeting-setup/meeting-setup.js
import { back, register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import {
    CONTEXT_CONFIGS, DIFFICULTY_LABELS, EXEMPT_BUDGET_BY_CONTEXT,
    EXEMPT_WINDOW_SEC, CONTEXT_NOTES,
} from '../../core/config.js?v=64';
import { getDisplayNickname, getAuthHeaders, doSignOut } from '../../core/firebase.js?v=64';
import { apiBase } from '../../core/api.js';
import { joinRoom } from '../../core/session.js';
import { t } from '../../core/i18n.js';
import { setButtonError, setButtonPending, setButtonSuccess } from '../../core/feedback.js?v=64';
import { showToast } from '../../utils/toast.js';

export function init() {
    register('view-meeting-setup', {
        element: document.getElementById('view-meeting-setup'),
        onShow: onSetupShow,
    });

    buildContextGrid();
    bindStartMode();
    bindStrengthBtns();
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

// 各難度的白話說明（讓使用者知道差別）
const DIFFICULTY_HINTS = {
    L: '偶爾看手機沒關係，分心只扣一點，暫離時間最長。',
    M: '適度專注，分心會明顯扣分。',
    H: '重視全程專注，一分心就扣很重，暫離時間最短。',
};

// 難度按鈕：預設帶入情境的建議難度，使用者可點著覆蓋。
function bindStrengthBtns() {
    document.querySelectorAll('#view-meeting-setup .cp-strength-btn').forEach(btn => {
        btn.onclick = () => {
            state.currentDifficulty = btn.dataset.diff || 'M';
            updateStrengthActive(state.currentDifficulty);
            renderExemptLabel();    // 暫離時長依難度變動 → 重繪
            renderStrengthHint();   // 更新說明文字
        };
    });
}

function updateStrengthActive(diff) {
    document.querySelectorAll('#view-meeting-setup .cp-strength-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.diff === diff);
    });
}

// 說明列：目前難度是什麼意思 + 這個情境建議哪個難度。
function renderStrengthHint() {
    const el = document.getElementById('strength-hint');
    if (!el) return;
    const diff = state.currentDifficulty || 'M';
    const label = DIFFICULTY_LABELS[diff] || diff;
    let text = `${label}：${DIFFICULTY_HINTS[diff] || ''}`;
    const suggested = CONTEXT_CONFIGS[state.currentContext]?.difficulty;
    if (suggested) {
        text += suggested === diff
            ? t('（此情境建議的強度）')
            : t('（此情境建議「{label}」）', { label: DIFFICULTY_LABELS[suggested] || suggested });
    }
    el.textContent = text;
}

// 暫離次數/時長：次數依情境、每次時長依（可被覆蓋的）難度。
function renderExemptLabel() {
    const exemptEl = document.getElementById('context-exempt-label');
    if (!exemptEl) return;
    const budget = EXEMPT_BUDGET_BY_CONTEXT[state.currentContext] ?? 0;
    if (budget > 0) {
        const mins = Math.round((EXEMPT_WINDOW_SEC[state.currentDifficulty] || 120) / 60);
        exemptEl.textContent = t('可暫離 {n} 次（每次最多 {m} 分鐘）', { n: budget, m: mins });
    } else {
        exemptEl.textContent = t('不開放暫離');
    }
}

// 選定情境後顯示：難度膠囊(預設情境建議) + 可暫離次數/時長 + 一句注意事項
function renderContextInfo(key) {
    const cfg = CONTEXT_CONFIGS[key];
    if (!cfg) return;
    updateStrengthActive(state.currentDifficulty);
    renderExemptLabel();
    renderStrengthHint();
    const noteEl = document.getElementById('context-note');
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
            const { fetchMyGroups } = await import('../../features/groups/controller.js?v=64');
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
