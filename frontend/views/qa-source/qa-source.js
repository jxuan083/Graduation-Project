// views/qa-source/qa-source.js — 房主出題的「題目來源選擇」頁
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { openQaManualPicker } from '../qa-picker/qa-picker.js';

export function init() {
    register('view-qa-source', { element: document.getElementById('view-qa-source') });

    document.getElementById('btn-qa-src-mine').onclick = () => startQaFromSource('mine');
    document.getElementById('btn-qa-src-public').onclick = () => startQaFromSource('public');
    document.getElementById('btn-qa-src-pick').onclick = openQaManualPicker;
    document.getElementById('btn-qa-src-cancel').onclick = () => switchView('view-focus');
}

export function openQaSourcePicker() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        alert('連線中斷,無法出題');
        return;
    }
    switchView('view-qa-source');
}

function startQaFromSource(source) {
    if (!sendAction('START_QA', { source })) {
        alert('連線中斷');
    }
    // 不切 view,讓 QA_STARTED 廣播回來時統一處理
}
