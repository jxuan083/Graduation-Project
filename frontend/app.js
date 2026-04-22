// UUID Generator for Guest User IDs
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// API Configuration
// Try to connect to backend on the same machine IP but port 8000
// 1. BACKEND_HOST 只留網址主體，不加 https://
const BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';

// 2. 修正三元運算式的語法 (補上 : 後面的部分)
const isSecure = window.location.protocol === 'https:';
const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

// State
let ws = null;
let roomId = null;
let userId = localStorage.getItem('phubbing_uid') || uuidv4();
localStorage.setItem('phubbing_uid', userId);

let amIHost = false;
let currentPhase = 'HOME'; // HOME, ROOM, SYNC, ACTIVE, BUFFER, SUMMARY
let sessionStartTime = null;
let totalDeviations = 0;
let holdInterval = null;
let myProgress = 0;
let bufferTimerObj = null;
let bufferSecondsLeft = 30;

// UI Elements
const viewHome = document.getElementById('view-home');
const viewHostRoom = document.getElementById('view-host-room');
const viewSyncRitual = document.getElementById('view-sync-ritual');
const viewFocus = document.getElementById('view-focus');
const viewBuffer = document.getElementById('view-buffer');
const viewSummary = document.getElementById('view-summary');

const uiViews = [viewHome, viewHostRoom, viewSyncRitual, viewFocus, viewBuffer, viewSummary];

function switchView(viewElement) {
    uiViews.forEach(el => el.classList.remove('active'));
    viewElement.classList.add('active');
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

    // Load Lottie Orb Animation
    lottie.loadAnimation({
        container: document.getElementById('lottie-orb'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        // Free glowing orb lottie JSON
        path: 'https://lottie.host/9e4d6a66-515c-48be-85cf-5b43deabeb2b/F9PzUfV6u8.json'
    });
};

document.getElementById('btn-create-room').onclick = async () => {
    amIHost = true;
    
    // Pass frontend origin so that backend QR generator points to the frontend server!
    const frontendUrl = window.location.protocol + "//" + window.location.host;
    const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/create_room?frontend_url=${encodeURIComponent(frontendUrl)}`, {
    mode: 'cors', // 強制使用 cors 模式
    headers: {
        'Content-Type': 'application/json'
    }
});
    const data = await res.json();
    
    document.getElementById('qr-code-img').src = 'data:image/png;base64,' + data.qr_base64;
    joinRoom(data.room_id);
};

document.getElementById('btn-start-sync').onclick = () => {
    // Client mock sync start
    currentPhase = 'SYNC';
    switchView(viewSyncRitual);
};

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
        // Allowed 1 person to start for testing
        if (amIHost) {
            document.getElementById('btn-start-sync').classList.remove('disabled');
        }
    } else if (msg.type === "PROGRESS_UPDATE") {
        // Here we could animate others progress
    } else if (msg.type === "ANCHOR_ESTABLISHED") {
        currentPhase = 'ACTIVE';
        sessionStartTime = Date.now();
        switchView(viewFocus);
        document.body.classList.add('mode-flow');
    } else if (msg.type === "DEVIATION_RECORDED") {
        totalDeviations = msg.total_deviations;
        document.getElementById('deviation-count').innerText = totalDeviations;
    }
}

// ==== SYNC RITUAL LOGIC ====
const btnHold = document.getElementById('btn-sync-hold');
const progressFill = document.getElementById('sync-progress-fill');

btnHold.addEventListener('touchstart', startHold);
btnHold.addEventListener('mousedown', startHold);
btnHold.addEventListener('touchend', endHold);
btnHold.addEventListener('mouseup', endHold);
btnHold.addEventListener('mouseleave', endHold);

function startHold(e) {
    e.preventDefault();
    if(currentPhase !== 'SYNC') return;
    
    holdInterval = setInterval(() => {
        myProgress += 2; // fill up over ~2.5 seconds (50 loops of 50ms)
        if (myProgress >= 100) myProgress = 100;
        
        progressFill.style.width = myProgress + '%';
        
        // Notify Server
        if(ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: myProgress}));
        }

        if(myProgress >= 100) {
            clearInterval(holdInterval);
        }
    }, 50);
}

function endHold(e) {
    if(currentPhase !== 'SYNC') return;
    clearInterval(holdInterval);
    myProgress = 0;
    progressFill.style.width = '0%';
    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: 0}));
    }
}


// ==== PAGE VISIBILITY API (Device Screen Mock) ====
document.addEventListener("visibilitychange", () => {
    if (currentPhase !== 'ACTIVE') return;

    if (document.visibilityState === "visible") {
        // Screen Woke Up / Tab focused -> DANGER! Start Buffer!
        startCognitiveBuffer();
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "visible"}));
    } else {
        // Screen off / Tab Background -> Safe! End Buffer!
        endCognitiveBuffer(true); // true means success
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "hidden"}));
    }
});

function startCognitiveBuffer() {
    switchView(viewBuffer);
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');
    
    bufferSecondsLeft = 30;
    document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
    
    // Haptic feedback if supported
    if (navigator.vibrate) navigator.vibrate(200);

    bufferTimerObj = setInterval(() => {
        bufferSecondsLeft--;
        document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
        
        if (bufferSecondsLeft <= 0) {
            // Buffer failed!
            clearInterval(bufferTimerObj);
            handleBufferTimeout();
        }
    }, 1000);
}

function endCognitiveBuffer(safe) {
    clearInterval(bufferTimerObj);
    if(safe) {
        // Re-enter flow
        switchView(viewFocus);
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}

function handleBufferTimeout() {
    // Emit deviation
    if(ws) ws.send(JSON.stringify({action: "LOG_DEVIATION"}));
    
    // Dim the lottie orb to simulate Penalty (Beta phase feature)
    document.getElementById('lottie-orb').style.filter = "grayscale(100%) opacity(0.5)";
    
    switchView(viewFocus); // Force back, but sad state
    document.body.classList.remove('mode-danger');
    
    // Return to normal color after a while?
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
