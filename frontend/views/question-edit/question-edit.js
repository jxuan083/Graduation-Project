// views/question-edit/question-edit.js — 新增/編輯題目
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { openQuestionBank } from '../question-bank/question-bank.js';

export function init() {
    register('view-question-edit', { element: document.getElementById('view-question-edit') });
    document.getElementById('btn-qedit-save').onclick = saveQuestionEdit;
    document.getElementById('btn-qedit-cancel').onclick = openQuestionBank;
    document.getElementById('btn-qedit-add-option').onclick = addQeditOption;
    document.getElementById('qedit-has-answer').onchange = updateQeditAnswerHint;
}

export function openQuestionEdit(mode, question) {
    state.qeditContext = { mode, questionId: question ? question.id : null };
    document.getElementById('qedit-title').innerText =
        mode === 'edit' ? '編輯題目' : '新增題目';
    document.getElementById('qedit-question').value = question ? (question.question || '') : '';
    document.getElementById('qedit-has-answer').checked = !!(question && question.has_answer);
    document.getElementById('qedit-status').innerText = '';
    renderEditOptions(
        question && question.options ? question.options.slice() : ['', ''],
        question ? question.correct_index : null
    );
    updateQeditAnswerHint();
    switchView('view-question-edit');
}

function renderEditOptions(options, correctIndex) {
    const container = document.getElementById('qedit-options-list');
    container.innerHTML = '';
    options.forEach((text, idx) => {
        const row = document.createElement('div');
        row.className = 'qedit-option-row';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'qedit-correct';
        radio.value = String(idx);
        if (idx === correctIndex) radio.checked = true;
        row.appendChild(radio);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'qedit-option-input';
        input.placeholder = `選項 ${idx + 1}`;
        input.maxLength = 40;
        input.value = text;
        row.appendChild(input);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'qedit-remove-btn';
        removeBtn.innerText = '✕';
        removeBtn.title = '刪除這個選項';
        removeBtn.onclick = () => {
            if (container.children.length <= 2) return;
            row.remove();
        };
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
    updateQeditRemoveButtons();
}

function updateQeditRemoveButtons() {
    const container = document.getElementById('qedit-options-list');
    const rows = container.querySelectorAll('.qedit-option-row');
    const disableRemove = rows.length <= 2;
    rows.forEach(r => {
        const btn = r.querySelector('.qedit-remove-btn');
        if (btn) btn.disabled = disableRemove;
    });
}

function updateQeditAnswerHint() {
    const hasAns = document.getElementById('qedit-has-answer').checked;
    document.getElementById('qedit-answer-hint').style.display = hasAns ? 'block' : 'none';
    if (!hasAns) {
        const container = document.getElementById('qedit-options-list');
        container.querySelectorAll('input[type="radio"]').forEach(r => (r.checked = false));
    }
}

function addQeditOption() {
    const container = document.getElementById('qedit-options-list');
    if (container.children.length >= 6) {
        document.getElementById('qedit-status').innerText = '最多只能 6 個選項';
        return;
    }
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'qedit-option-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'qedit-correct';
    radio.value = String(idx);
    row.appendChild(radio);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'qedit-option-input';
    input.placeholder = `選項 ${idx + 1}`;
    input.maxLength = 40;
    row.appendChild(input);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'qedit-remove-btn';
    removeBtn.innerText = '✕';
    removeBtn.onclick = () => { row.remove(); updateQeditRemoveButtons(); };
    row.appendChild(removeBtn);
    container.appendChild(row);
    updateQeditRemoveButtons();
    document.getElementById('qedit-status').innerText = '';
}

async function saveQuestionEdit() {
    const q = document.getElementById('qedit-question').value.trim();
    const statusEl = document.getElementById('qedit-status');
    const container = document.getElementById('qedit-options-list');
    const rows = container.querySelectorAll('.qedit-option-row');
    const options = [];
    let correctIndex = null;
    rows.forEach((row) => {
        const txt = row.querySelector('input[type="text"]').value.trim();
        if (txt) options.push(txt);
        const radio = row.querySelector('input[type="radio"]');
        if (radio && radio.checked) correctIndex = options.length - 1;
    });
    const hasAnswer = document.getElementById('qedit-has-answer').checked;

    if (!q) { statusEl.innerText = '題目不能是空的'; return; }
    if (options.length < 2) { statusEl.innerText = '至少要 2 個有內容的選項'; return; }
    if (options.length > 6) { statusEl.innerText = '最多只能 6 個選項'; return; }
    if (hasAnswer && correctIndex === null) { statusEl.innerText = '請指定正解'; return; }

    const payload = {
        question: q,
        options,
        has_answer: hasAnswer,
        correct_index: hasAnswer ? correctIndex : null
    };

    const saveBtn = document.getElementById('btn-qedit-save');
    saveBtn.disabled = true;
    statusEl.innerText = '儲存中...';

    try {
        let path = '/api/questions';
        let method = 'POST';
        if (state.qeditContext.mode === 'edit' && state.qeditContext.questionId) {
            path += '/' + state.qeditContext.questionId;
            method = 'PATCH';
        }
        const { data } = await apiFetch(path, { method, body: JSON.stringify(payload) });
        if (data.status !== 'success') {
            statusEl.innerText = '失敗:' + (data.detail || '未知錯誤');
            saveBtn.disabled = false;
            return;
        }
        statusEl.innerText = '';
        saveBtn.disabled = false;
        await openQuestionBank();
    } catch (err) {
        statusEl.innerText = '失敗:' + (err.message || err);
        saveBtn.disabled = false;
    }
}
