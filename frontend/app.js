// UUID Generator for Guest User IDs
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// API Configuration
// BACKEND_HOST 只留網址主體，不加 https://
const BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';

const isSecure = window.location.protocol === 'https:';
const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

// State
let ws = null;
let roomId = null;
let userId = localStorage.getItem('phubbing_uid') || uuidv4();
localStorage.setItem('phubbing_uid', userId);

let amIHost = false;
let currentPhase = 'HOME'; 
let sessionStartTime = null;
let totalDeviations = 0;
let holdInterval = null;
let myProgress = 0;
let bufferTimerObj = null;
let bufferSecondsLeft = 30;

let currentRoomMode = 'GATHERING'; 
let isReady = false;

// UI Elements
const viewHome = document.getElementById('view-home');
const viewHostRoom = document.getElementById('view-host-room');
const viewSyncRitual = document.getElementById('view-sync-ritual');
const viewFocus = document.getElementById('view-focus');
const viewBuffer = document.getElementById('view-buffer');
const viewSummary = document.getElementById('view-summary');
const viewQaGame = document.getElementById('view-qa-game'); 

// 🟢 擴充：多題目題庫字典
const qaDatabase = {
    "GATHERING": [
        { q: "你的性向是？", opts: ["A. 女異性戀", "B. 男異性戀", "C. 女同性戀", "D. 男同性戀"] },
        { q: "如果現在要一個人去買單，誰看起來最有錢？", opts: ["A. 潘振軒", "B. 吳佩霓", "C. 科穎文", "D. 陳厚名"] }
    ],
    "FAMILY": [
        { q: "這次家庭聚會，等一下誰負責洗碗？", opts: ["A. 爸爸", "B. 媽媽", "C. 我", "D. 妹妹"] },
        { q: "最期待誰的遺產？", opts: ["A. 爸爸", "B. 媽媽", "C. 奶奶", "D. 爺爺"] }
    ],
    "MEETING": [
        { q: "對於剛才討論的內容，你的看法是？", opts: ["A. 非常贊成", "B. 還有待商榷", "C. 部分贊同", "D. 完全不贊同"] }
    ],
    "CLASS": [
        { q: "老師剛才講的概念，你聽懂了嗎？", opts: ["A. 完全懂", "B. 懂一半", "C. 不太懂", "D. 完全不懂"] }
    ]
};

const uiViews = [viewHome, viewHostRoom, viewSyncRitual, viewFocus, viewBuffer, viewSummary, viewQaGame];

function switchView(viewElement) {
    if (!viewElement) return; 
    uiViews.forEach(el => {
        if(el) el.classList.remove('active');
    });
    viewElement.classList.add('active');
}

// 🟢 擴充：背景顏色同步函式
function updateThemeByMode(mode) {
    document.body.classList.remove('mode-gathering', 'mode-family', 'mode-meeting', 'mode-class');
    const modeClassMap = { "GATHERING": "mode-gathering", "FAMILY": "mode-family", "MEETING": "mode-meeting", "CLASS": "mode-class" };
    document.body.classList.add(modeClassMap[mode]);
}

// ==== INIT / SETUP ====
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    
    if (roomFromUrl) {
        joinRoom(roomFromUrl);
    } else {
        switchView(viewHome);
    }

    lottie.loadAnimation({
        container: document.getElementById('lottie-orb'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://lottie.host/9e4d6a66-515c-48be-85cf-5b43deabeb2b/F9PzUfV6u8.json'
    });
};

document.getElementById('btn-create-room').onclick = async () => {
    amIHost = true;
    const frontendUrl = window.location.protocol + "//" + window.location.host;
    const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/create_room?frontend_url=${encodeURIComponent(frontendUrl)}`, {
        mode: 'cors',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json();

    document.getElementById('qr-code-img').src = 'data:image/png;base64,' + data.qr_base64;
    joinRoom(data.room_id);
};

// ==== 模式切換與視覺回饋邏輯 ====
function setActiveModeBtn(clickedBtnId) {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active-mode'));
    if (clickedBtnId) {
        const activeBtn = document.getElementById(clickedBtnId);
        if (activeBtn) activeBtn.classList.add('active-mode');
    }
}

document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'btn-start-sync') {
        if (!e.target.classList.contains('disabled')) {
            console.log("🚀 房主進入同步儀式！");
            currentPhase = 'SYNC';
            switchView(document.getElementById('view-sync-ritual'));
        }
    }

    const modeBtn = e.target.closest('.mode-btn'); 
    if (modeBtn) {
        const btnId = modeBtn.id;
        setActiveModeBtn(btnId); 
        
        if (btnId === 'btn-mode-gathering') currentRoomMode = "GATHERING";
        else if (btnId === 'btn-mode-family') currentRoomMode = "FAMILY";
        else if (btnId === 'btn-mode-meeting') currentRoomMode = "MEETING";
        else if (btnId === 'btn-mode-class') currentRoomMode = "CLASS";
        
        updateThemeByMode(currentRoomMode); // 房主端先行變色回饋

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({action: "CHANGE_MODE", mode: currentRoomMode}));
        }
    }
    
    // 🟢 擴充：房主發起問答 (從多題庫隨機出一題)
    const qaBtn = e.target.closest('#btn-mode-qa');
    if (qaBtn) {
        const questions = qaDatabase[currentRoomMode];
        const randomItem = questions[Math.floor(Math.random() * questions.length)];
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "START_QA", 
                question: randomItem.q,
                options: randomItem.opts
            }));
        }
    }
});

// ==== WEBSOCKET ====
function joinRoom(id) {
    roomId = id;
    const wsUrl = `${WS_PROTOCOL}${BACKEND_HOST}/ws/${roomId}/${userId}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        if(amIHost) switchView(viewHostRoom);
        else {
            currentPhase = 'SYNC';
            switchView(viewSyncRitual);
        }
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };
}

function handleServerMessage(msg) {
    if (msg.type === "ROOM_UPDATE") {
        document.getElementById('member-count').innerText = Object.keys(msg.room_state.members).length;
        if (amIHost) {
            document.getElementById('btn-start-sync').classList.remove('disabled');
        }
    } else if (msg.type === "ANCHOR_ESTABLISHED") {
        currentPhase = 'ACTIVE';
        sessionStartTime = Date.now();
        switchView(viewFocus);
        document.body.classList.add('mode-flow');

        if (amIHost) {
            document.getElementById('host-only-controls').style.display = 'block';
        }
    } else if (msg.type === "DEVIATION_RECORDED") {
        totalDeviations = msg.total_deviations;
        document.getElementById('deviation-count').innerText = totalDeviations;
    } else if (msg.type === "MODE_CHANGED") {
        currentRoomMode = msg.mode;
        updateThemeByMode(msg.mode); // 🟢 擴充：同步所有人背景顏色
    } else if (msg.type === "QA_STARTED") {
        currentPhase = 'QA_GAME'; 
        switchView(viewQaGame);
        
        const questionEl = document.getElementById('qa-question-text');
        const container = document.getElementById('qa-options-container');
        const statusEl = document.getElementById('qa-status');
        
        if (questionEl) questionEl.innerText = msg.question;
        if (statusEl) statusEl.innerText = "";
        
        if (container) {
            container.innerHTML = ''; 
            msg.options.forEach(opt => {
                let btn = document.createElement('button');
                btn.innerText = opt;
                btn.className = 'qa-option-btn'; 
                btn.onclick = () => {
                    ws.send(JSON.stringify({action: "SUBMIT_ANSWER", answer: opt}));
                    if (statusEl) statusEl.innerText = "你已送出答案，等待其他人...";
                    Array.from(container.children).forEach(b => b.disabled = true);
                };
                container.appendChild(btn);
            });
        }
    }
}

// ==== SYNC RITUAL LOGIC ====
const btnHold = document.getElementById('btn-sync-hold');
const progressFill = document.getElementById('sync-progress-fill');

btnHold.addEventListener('touchstart', startHold, {passive: false});
btnHold.addEventListener('mousedown', startHold);
btnHold.addEventListener('touchend', endHold);
btnHold.addEventListener('mouseup', endHold);
btnHold.addEventListener('mouseleave', endHold);

function startHold(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if(currentPhase !== 'SYNC' || isReady) return; 
    
    holdInterval = setInterval(() => {
        myProgress += 2; 
        if (myProgress >= 100) {
            myProgress = 100;
            isReady = true; 
            progressFill.style.background = "linear-gradient(90deg, #10b981, #34d399)"; 
            btnHold.innerText = "READY"; 
            btnHold.style.background = "#10b981"; 
            clearInterval(holdInterval);
        }
        
        progressFill.style.width = myProgress + '%';
        
        if(ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: myProgress}));
        }
    }, 50);
}

function endHold(e) {
    if(currentPhase !== 'SYNC' || isReady) return; 
    
    clearInterval(holdInterval);
    myProgress = 0;
    progressFill.style.width = '0%';
    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: 0}));
    }
}

// ==== PAGE VISIBILITY API ====
document.addEventListener("visibilitychange", () => {
    if (currentPhase !== 'ACTIVE') return; 

    if (document.visibilityState === "visible") {
        startCognitiveBuffer();
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "visible"}));
    } else {
        endCognitiveBuffer(true); 
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "hidden"}));
    }
});

function startCognitiveBuffer() {
    switchView(viewBuffer);
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');
    
    bufferSecondsLeft = 30;
    document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
    
    if (navigator.vibrate) navigator.vibrate(200);

    bufferTimerObj = setInterval(() => {
        bufferSecondsLeft--;
        document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
        
        if (bufferSecondsLeft <= 0) {
            clearInterval(bufferTimerObj);
            handleBufferTimeout();
        }
    }, 1000);
}

function endCognitiveBuffer(safe) {
    clearInterval(bufferTimerObj);
    if(safe) {
        switchView(viewFocus);
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}

function handleBufferTimeout() {
    if(ws) ws.send(JSON.stringify({action: "LOG_DEVIATION"}));
    document.getElementById('lottie-orb').style.filter = "grayscale(100%) opacity(0.5)";
    switchView(viewFocus); 
    document.body.classList.remove('mode-danger');
    
    setTimeout(() => {
        document.getElementById('lottie-orb').style.filter = "none";
        document.body.classList.add('mode-flow');
    }, 5000);
}

// ==== SUMMARY ====
document.getElementById('btn-end-session').onclick = () => {
    currentPhase = 'SUMMARY';
    document.body.className = '';
    
    const timeMs = Date.now() - sessionStartTime;
    const mins = Math.round(timeMs / 60000);
    
    document.getElementById('summary-time').innerText = mins;
    document.getElementById('summary-deviations').innerText = totalDeviations;
    
    if(ws) ws.close();
    switchView(viewSummary);
};