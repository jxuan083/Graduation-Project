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
    state.myNickname = '';
    document.body.className = '';
    state.lastMeetingView = null;
    history.replaceState(null, '', window.location.pathname);
    events.emit('session:cleanup');
}

// 從選單頁面「回到首頁」: 若還在聚會中(WS 連線仍在),就視為徹底離開
export function goHomeFromMenu() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        cleanupSession();
    }
    switchView('view-home');
}

// 加入房間 (WebSocket 連上 + 切到對應 view)
// 由 host 與訪客共用,差別在 amIHost 旗標
// 🔒 [C1 v15.2] connectRoom 變 async 因為要取 Firebase ID token
export async function joinRoom(roomId) {
    await connectRoom(roomId, state.userId, state.myNickname, () => {
        if (state.amIHost) {
            switchView('view-host-room');
        } else {
            state.currentPhase = 'WAITING';
            switchView('view-waiting-room');
        }
        events.emit('session:joined', { roomId, amIHost: state.amIHost });
    });
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
