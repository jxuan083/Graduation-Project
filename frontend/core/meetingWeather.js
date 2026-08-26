// core/meetingWeather.js — 聚會場景「天氣」：用群體專注氛圍替寵物表達心情。
//
// 大部分人專注 → 晴天；一兩個人分心 → 陰天；多數人分心 → 雨天。
// 用「比例」而非人數（聚會 2~20 人都可能）。訊號來源是 DEVIATION_RECORDED——
// 那是「真的離開去滑別的 app」才會記的分心；關螢幕（把手機放下）不會產生 deviation，
// 所以放下手機的人不會讓天氣變差（這正是我們要的）。
import { state } from './state.js';

const RECENT_WINDOW_MS = 75000;  // 一次分心後，多久內仍算「這個人正在分心」
const TICK_MS = 2500;            // 重算天氣的節奏
const CLOUDY_RATIO = 0.15;       // 超過此比例的人最近分心 → 陰天
const RAINY_RATIO = 0.45;        // 超過此比例 → 雨天

// 溫柔、群體視角的文案（不指責個人）。
const BUBBLE_TEXT = {
    cloudy: '有人分心了，牠有點在意…',
    rainy: '大家都跑掉了，牠好失落…',
};

const lastDistractedAt = new Map();  // uid -> timestamp
let tickTimer = null;
let currentWeather = 'clear';

// wsHandlers 收到某人分心時呼叫。
export function noteDistraction(uid) {
    if (!uid) return;
    lastDistractedAt.set(uid, Date.now());
}

export function resetWeather() {
    lastDistractedAt.clear();
    currentWeather = 'clear';
    applyWeather('clear');
}

function presentCount() {
    return Math.max(1, Object.keys(state.roomMembers || {}).length);
}

function strugglingRatio() {
    const now = Date.now();
    let struggling = 0;
    for (const ts of lastDistractedAt.values()) {
        if (now - ts < RECENT_WINDOW_MS) struggling += 1;
    }
    return struggling / presentCount();
}

function computeWeather() {
    const r = strugglingRatio();
    if (r >= RAINY_RATIO) return 'rainy';
    if (r >= CLOUDY_RATIO) return 'cloudy';
    return 'clear';
}

function applyWeather(weather) {
    const scene = document.querySelector('#view-focus .pa-scene-card');
    if (scene) {
        scene.classList.remove('weather-clear', 'weather-cloudy', 'weather-rainy');
        scene.classList.add(`weather-${weather}`);
    }
    const bubble = document.getElementById('focus-pet-bubble');
    if (bubble) {
        // 只有真的有群組寵物（不是預設動畫球）才顯示牠的失落對話框
        const hasPet = !!state.meetingGroupPetFace;
        const text = hasPet ? (BUBBLE_TEXT[weather] || '') : '';
        bubble.textContent = text;
        bubble.style.display = text ? 'block' : 'none';
    }
}

function tick() {
    const weather = computeWeather();
    if (weather !== currentWeather) {
        currentWeather = weather;
        applyWeather(weather);
    }
}

// 進入 focus 畫面時啟動；離開時停止（背景時瀏覽器本來就會限流 setInterval）。
export function startWeather() {
    stopWeather();
    applyWeather(currentWeather);
    tick();
    tickTimer = setInterval(tick, TICK_MS);
}

export function stopWeather() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
