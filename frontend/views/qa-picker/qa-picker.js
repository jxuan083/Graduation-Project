// views/qa-picker/qa-picker.js — 房主從題庫挑一題
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { apiFetch } from '../../core/api.js';

export function init() {
    register('view-qa-picker', { element: document.getElementById('view-qa-picker') });
    document.getElementById('btn-qpick-back').onclick = () => switchView('view-qa-source');
    document.getElementById('qpick-tab-mine').onclick = () => {
        state.qpickerCurrentTab = 'mine';
        document.getElementById('qpick-tab-mine').classList.add('active');
        document.getElementById('qpick-tab-public').classList.remove('active');
        refreshQaPickerList();
    };
    document.getElementById('qpick-tab-public').onclick = () => {
        state.qpickerCurrentTab = 'public';
        document.getElementById('qpick-tab-public').classList.add('active');
        document.getElementById('qpick-tab-mine').classList.remove('active');
        refreshQaPickerList();
    };
}

export async function openQaManualPicker() {
    state.qpickerCurrentTab = 'mine';
    document.getElementById('qpick-tab-mine').classList.add('active');
    document.getElementById('qpick-tab-public').classList.remove('active');
    switchView('view-qa-picker');
    await refreshQaPickerList();
}

async function refreshQaPickerList() {
    const listEl = document.getElementById('qpick-list');
    const emptyEl = document.getElementById('qpick-empty');
    listEl.innerHTML = '<p class="hint">載入中...</p>';
    emptyEl.style.display = 'none';

    try {
        const path = state.qpickerCurrentTab === 'mine' ? '/api/questions' : '/api/public_questions';
        const { data } = await apiFetch(path);
        const questions = (data && data.questions) || [];
        listEl.innerHTML = '';
        if (!questions.length) {
            emptyEl.innerText = state.qpickerCurrentTab === 'mine'
                ? '你的個人題庫還沒有題目'
                : '公共題庫目前是空的';
            emptyEl.style.display = 'block';
            return;
        }
        questions.forEach(q => {
            const item = document.createElement('div');
            item.className = 'qbank-item';
            item.style.cursor = 'pointer';

            const qText = document.createElement('div');
            qText.className = 'qbank-item-q';
            qText.innerText = q.question;
            item.appendChild(qText);

            const opts = document.createElement('div');
            opts.className = 'qbank-item-opts';
            (q.options || []).forEach((opt, idx) => {
                const span = document.createElement('span');
                span.className = 'qbank-item-opt';
                if (q.has_answer && q.correct_index === idx) span.classList.add('correct');
                span.innerText = opt;
                opts.appendChild(span);
            });
            item.appendChild(opts);

            item.onclick = () => {
                if (!sendAction('START_QA', { source: 'specific', question_id: q.id })) {
                    alert('連線中斷');
                }
            };
            listEl.appendChild(item);
        });
    } catch (err) {
        listEl.innerHTML = '';
        emptyEl.innerText = '讀取失敗:' + (err.message || err);
        emptyEl.style.display = 'block';
    }
}
