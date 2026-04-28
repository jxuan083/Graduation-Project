// views/question-bank/question-bank.js — 題庫管理
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { goHomeFromMenu } from '../../core/session.js';
import { openQuestionEdit } from '../question-edit/question-edit.js';

export function init() {
    register('view-question-bank', { element: document.getElementById('view-question-bank') });
    document.getElementById('btn-qbank-back').onclick = goHomeFromMenu;
    document.getElementById('btn-qbank-add').onclick = () => openQuestionEdit('new', null);
    document.getElementById('qbank-tab-mine').onclick = () => {
        state.qbankCurrentTab = 'mine';
        document.getElementById('qbank-tab-mine').classList.add('active');
        document.getElementById('qbank-tab-public').classList.remove('active');
        refreshQuestionBank();
    };
    document.getElementById('qbank-tab-public').onclick = () => {
        state.qbankCurrentTab = 'public';
        document.getElementById('qbank-tab-public').classList.add('active');
        document.getElementById('qbank-tab-mine').classList.remove('active');
        refreshQuestionBank();
    };
}

export async function openQuestionBank() {
    if (!state.currentUser) {
        alert('請先登入 Google 帳號');
        return;
    }
    state.qbankCurrentTab = 'mine';
    document.getElementById('qbank-tab-mine').classList.add('active');
    document.getElementById('qbank-tab-public').classList.remove('active');
    const addBtn = document.getElementById('btn-qbank-add');
    if (addBtn) addBtn.style.display = 'block';
    switchView('view-question-bank');
    await refreshQuestionBank();
}

export async function refreshQuestionBank() {
    const listEl = document.getElementById('qbank-list');
    const emptyEl = document.getElementById('qbank-empty');
    const addBtn = document.getElementById('btn-qbank-add');
    listEl.innerHTML = '<p class="hint">載入中...</p>';
    emptyEl.style.display = 'none';

    try {
        if (state.qbankCurrentTab === 'mine') {
            if (addBtn) addBtn.style.display = 'block';
            const { data } = await apiFetch('/api/questions');
            state.qbankMyQuestions = (data && data.questions) || [];
            renderQbankList(state.qbankMyQuestions, 'mine');
        } else {
            if (addBtn) addBtn.style.display = 'none';
            const { data } = await apiFetch('/api/public_questions');
            state.qbankPublicQuestions = (data && data.questions) || [];
            renderQbankList(state.qbankPublicQuestions, 'public');
        }
    } catch (err) {
        listEl.innerHTML = '';
        emptyEl.innerText = '讀取失敗:' + (err.message || err);
        emptyEl.style.display = 'block';
    }
}

function renderQbankList(questions, kind) {
    const listEl = document.getElementById('qbank-list');
    const emptyEl = document.getElementById('qbank-empty');
    listEl.innerHTML = '';

    if (!questions.length) {
        emptyEl.innerText = kind === 'mine'
            ? '你還沒有任何題目。可以按「+ 新增題目」建立,或切到「公共題庫」複製幾題過來。'
            : '公共題庫目前是空的。';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    questions.forEach(q => {
        const item = document.createElement('div');
        item.className = 'qbank-item';

        const qText = document.createElement('div');
        qText.className = 'qbank-item-q';
        qText.innerText = q.question;
        item.appendChild(qText);

        if (kind === 'public' && q.category) {
            const meta = document.createElement('div');
            meta.className = 'qbank-item-meta';
            meta.innerText = `分類:${q.category}` + (q.has_answer ? ' · 有正解' : '');
            item.appendChild(meta);
        } else if (kind === 'mine' && q.has_answer) {
            const meta = document.createElement('div');
            meta.className = 'qbank-item-meta';
            meta.innerText = '✅ 有正解';
            item.appendChild(meta);
        }

        const optsWrap = document.createElement('div');
        optsWrap.className = 'qbank-item-opts';
        (q.options || []).forEach((opt, idx) => {
            const span = document.createElement('span');
            span.className = 'qbank-item-opt';
            if (q.has_answer && q.correct_index === idx) {
                span.classList.add('correct');
                span.innerText = '✓ ' + opt;
            } else {
                span.innerText = opt;
            }
            optsWrap.appendChild(span);
        });
        item.appendChild(optsWrap);

        const actions = document.createElement('div');
        actions.className = 'qbank-item-actions';
        if (kind === 'mine') {
            const editBtn = document.createElement('button');
            editBtn.className = 'qbank-mini-btn';
            editBtn.innerText = '✏️ 編輯';
            editBtn.onclick = () => openQuestionEdit('edit', q);
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'qbank-mini-btn danger';
            delBtn.innerText = '🗑️ 刪除';
            delBtn.onclick = () => deleteMyQuestion(q.id);
            actions.appendChild(delBtn);
        } else {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'qbank-mini-btn primary';
            copyBtn.innerText = '📥 加到我的題庫';
            copyBtn.onclick = () => importPublicQuestion(q.id, copyBtn);
            actions.appendChild(copyBtn);
        }
        item.appendChild(actions);
        listEl.appendChild(item);
    });
}

async function deleteMyQuestion(qid) {
    if (!confirm('確定要刪除這題?')) return;
    try {
        const { data } = await apiFetch(`/api/questions/${qid}`, { method: 'DELETE' });
        if (data.status !== 'success') {
            alert('刪除失敗:' + (data.detail || ''));
            return;
        }
        await refreshQuestionBank();
    } catch (err) {
        alert('刪除失敗:' + (err.message || err));
    }
}

async function importPublicQuestion(publicId, btn) {
    if (btn) { btn.disabled = true; btn.innerText = '加入中...'; }
    try {
        const { data } = await apiFetch('/api/questions/import', {
            method: 'POST',
            body: JSON.stringify({ public_id: publicId })
        });
        if (data.status !== 'success') {
            alert('加入失敗:' + (data.detail || ''));
            if (btn) { btn.disabled = false; btn.innerText = '📥 加到我的題庫'; }
            return;
        }
        if (btn) btn.innerText = '✓ 已加入';
    } catch (err) {
        alert('加入失敗:' + (err.message || err));
        if (btn) { btn.disabled = false; btn.innerText = '📥 加到我的題庫'; }
    }
}
