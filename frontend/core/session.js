// core/session.js — 聚會 session lifecycle (清理、回首頁、加入房間)
import { state } from './state.js';
import { closeWs, connectRoom } from './ws.js';
import { switchView } from './router.js';
import { events } from './events.js';

// 清理本地 session 狀態 (關 ws + 重設 state + 清網址)
export function cleanupSession() {
    closeWs();
    state.roomId = null;
    state.amIHost = false;
    state.currentPhase = 'HOME';
    state.roomHostUid = null;
    state.roomMembers = {};
    state.roomAllParticipants = {};
    state.leftRoomId = null;
    state.exemptUntil = 0;
    state.myNickname = '';
    state.myProgress = 0;
    state.isReady = false;
    state.totalDeviations = 0;
    state.myDeviations = 0;
    document.body.className = '';
    state.lastMeetingView = null;
    history.replaceState(history.state, '', window.location.pathname);
    events.emit('session:cleanup');
}

// 進入一場聚會（新開、加入、加回）時，把上一場留下的「本場」計數清掉。
// 正常結束後是從總結頁回首頁，不會經過 cleanupSession，所以要在進場時清。
// 加回的人：分心次數與開始時間隨後會由 ROOM_UPDATE 依後端資料補上。
export function resetSessionCounters() {
    state.totalDeviations = 0;
    state.myDeviations = 0;
    state.sessionStartTime = null;
    state.pendingDeviation = 0;
    state.deviationDeadline = null;
    state.exemptUntil = 0;
    state.roomMembers = {};
    state.roomAllParticipants = {};
}

// 從選單頁面「回到首頁」: 若還在聚會中(WS 連線仍在),就視為徹底離開
export function goHomeFromMenu() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        cleanupSession();
    }
    switchView('view-home', { replace: true });
}

// 加入房間 (WebSocket 連上 + 切到對應 view)
// 由 host 與訪客共用,差別在 amIHost 旗標
// 🔒 [C1 v15.2] connectRoom 變 async 因為要取 Firebase ID token
export async function joinRoom(roomId) {
    await connectRoom(roomId, state.userId, state.myNickname, () => {
        if (state.amIHost) {
            switchView('view-host-room', { replace: true });
        } else {
            state.currentPhase = 'WAITING';
            switchView('view-waiting-room', { replace: true });
        }
        resetSessionCounters();
        events.emit('session:joined', { roomId, amIHost: state.amIHost });
    });
}

// WS 斷線後靜默重連（不切換畫面，用於從背景回來補送訊息）
export async function reconnectSilent() {
    // 已經在總結頁（聚會結束或自己離開了）就不要再連回去
    const stillInSession = () => state.currentPhase !== 'SUMMARY' && state.currentPhase !== 'HOME';
    if (!state.roomId || !state.myNickname || !stillInSession()) return;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
    await connectRoom(state.roomId, state.userId, state.myNickname, () => {
        events.emit('session:reconnected');
    }, { silent: true, shouldProceed: stillInSession });
}

// 同步 body class 顯示模式對應顏色
export function updateThemeByMode(mode) {
    document.body.classList.remove('mode-gathering', 'mode-family', 'mode-meeting', 'mode-class');
    const map = {
        "GATHERING": "mode-gathering",
        "FAMILY": "mode-family",
        "MEETING": "mode-meeting",
        "CLASS": "mode-class"
    };
    if (map[mode]) document.body.classList.add(map[mode]);
}
