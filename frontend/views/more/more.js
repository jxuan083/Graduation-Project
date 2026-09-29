// views/more/more.js — 「更多」頁：連線診斷。
// 需求（NOTES 2026-08-06）：顯示 IS_NATIVE_APP、解析出的 devHost / BACKEND_HOST /
// emulator hosts，並提供「測試連線」按鈕，把 fetch 的錯誤訊息直接印在畫面上，
// 不需要接 Mac 就能自我診斷。
import { register, back } from '../../core/router.js';
import { updateToggleUI } from '../../core/i18n.js';
import { vibrate } from '../../core/haptics.js?v=74';
import {
    IS_NATIVE_APP,
    BACKEND_HOST,
    HTTP_PROTOCOL,
    FIREBASE_EMULATORS,
    NATIVE_DEV_HOST_STORAGE_KEY,
} from '../../core/config.js';

const BACKEND_BASE = `${HTTP_PROTOCOL}${BACKEND_HOST}`;
const TEST_TIMEOUT_MS = 6000;

function resolvedDevHost() {
    try {
        const stored = localStorage.getItem(NATIVE_DEV_HOST_STORAGE_KEY);
        if (stored) return stored;
    } catch (_) {}
    return (window.PHUBBING_NATIVE_CONFIG && window.PHUBBING_NATIVE_CONFIG.devHost) || '(空)';
}

function capacitorPlatform() {
    try { return window.Capacitor?.getPlatform?.() || '(none)'; } catch (_) { return '(none)'; }
}

function renderEnv() {
    const dl = document.getElementById('diag-env');
    if (!dl) return;
    const rows = [
        ['IS_NATIVE_APP', String(IS_NATIVE_APP)],
        ['platform', capacitorPlatform()],
        ['location', window.location.href],
        ['devHost', resolvedDevHost()],
        ['BACKEND_HOST', BACKEND_BASE],
        ['emulators.enabled', String(FIREBASE_EMULATORS.enabled)],
        ['auth emulator', FIREBASE_EMULATORS.authHost],
        ['storage emulator', `http://${FIREBASE_EMULATORS.storageHost}:${FIREBASE_EMULATORS.storagePort}`],
    ];
    dl.innerHTML = '';
    for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dt, dd);
    }
}

// 帶 timeout 的 fetch：連不到 Mac 時常是靜默 hang，加 timeout 才能把它變成
// 看得到的「逾時」訊息，而不是一直轉。
async function probe(label, url, parseJson) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const started = performance.now();
    try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const ms = Math.round(performance.now() - started);
        let detail = '';
        if (parseJson) {
            try { detail = ` ${JSON.stringify(await res.json()).slice(0, 160)}`; }
            catch (_) { detail = ' (回應非 JSON)'; }
        } else {
            try { detail = ` ${(await res.text()).slice(0, 80).replace(/\s+/g, ' ')}`; } catch (_) {}
        }
        return `[OK] ${label}  HTTP ${res.status} (${ms}ms)\n   ${url}${detail}`;
    } catch (err) {
        const ms = Math.round(performance.now() - started);
        const reason = err.name === 'AbortError'
            ? `逾時 >${TEST_TIMEOUT_MS}ms`
            : `${err.name}: ${err.message}`;
        return `[FAIL] ${label}  (${ms}ms)\n   ${url}\n   ${reason}`;
    } finally {
        clearTimeout(timer);
    }
}

async function runTests() {
    const out = document.getElementById('diag-output');
    const btn = document.getElementById('diag-run');
    if (!out) return;
    if (btn) { btn.disabled = true; btn.textContent = '測試中…'; }
    out.textContent = '測試中…';

    const targets = [
        () => probe('/api/health', `${BACKEND_BASE}/api/health`, true),
    ];
    if (FIREBASE_EMULATORS.enabled) {
        targets.push(() => probe('auth emulator', `${FIREBASE_EMULATORS.authHost}/`, false));
    }

    const lines = [];
    for (const run of targets) {
        lines.push(await run());
        out.textContent = lines.join('\n\n');
    }

    if (btn) { btn.disabled = false; btn.textContent = '重新測試'; }
}

export function init() {
    register('view-more', {
        element: document.getElementById('view-more'),
        onShow: () => { renderEnv(); updateToggleUI(); },
    });

    const backBtn = document.getElementById('btn-more-back');
    if (backBtn) backBtn.onclick = () => back();

    const runBtn = document.getElementById('diag-run');
    if (runBtn) runBtn.onclick = runTests;

    bindMotionSpike();
    bindPickupTest();
}

// --- 動作偵測 spike：驗證 CMSensorRecorder 在這台 iPhone 上是否可用（驗完移除）---
function bindMotionSpike() {
    const out = document.getElementById('motion-output');
    const show = (obj) => { if (out) out.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };
    // Capacitor 6+：內建自訂 plugin 用 registerPlugin 取得（window.Capacitor.Plugins 不一定有）。
    const plugin = () => {
        const cap = window.Capacitor;
        if (!cap) return null;
        try { return (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('LockState') : null) || cap.Plugins?.LockState || null; }
        catch { return cap.Plugins?.LockState || null; }
    };
    const fail = (label, e) => {
        const names = Object.keys(window.Capacitor?.Plugins || {}).join(', ') || '(空)';
        show(`${label} 失敗：${e?.message || e}\n\nplatform=${window.Capacitor?.getPlatform?.() || '?'}\n已註冊的 Plugins：${names}`);
    };

    const check = document.getElementById('motion-check');
    if (check) check.onclick = async () => {
        // 純環境 dump：看清 Capacitor / Plugins / registerPlugin 到底長怎樣。
        const cap = window.Capacitor;
        const env = {
            hasCapacitor: !!cap,
            platform: cap?.getPlatform?.(),
            isNative: cap?.isNativePlatform?.(),
            typeof_registerPlugin: typeof cap?.registerPlugin,
            capacitorKeys: cap ? Object.keys(cap) : [],
            pluginKeys: Object.keys(cap?.Plugins || {}),
        };
        let callResult = '(未呼叫)';
        try {
            const p = plugin();
            if (p && typeof p.motionAvailable === 'function') {
                callResult = await p.motionAvailable();
            } else {
                callResult = 'plugin proxy 取得: ' + (!!p) + '，但沒有 motionAvailable 方法';
            }
        } catch (e) { callResult = '呼叫 motionAvailable 失敗: ' + (e?.message || e); }
        show({ env, callResult });
    };

    const start = document.getElementById('motion-start');
    if (start) start.onclick = async () => {
        const p = plugin();
        if (!p) { show('連 Capacitor 都取不到——你不在原生 App 裡。'); return; }
        try {
            const r = await p.startMotionRecording({ durationSec: 30 });
            show('已開始錄製 30 秒：' + JSON.stringify(r) + '\n把手機面朝下放著、期間拿起幾次，30 秒後按③讀取。');
        } catch (e) { fail('startMotionRecording', e); }
    };

    const read = document.getElementById('motion-read');
    if (read) read.onclick = async () => {
        const p = plugin();
        if (!p) { show('連 Capacitor 都取不到——你不在原生 App 裡。'); return; }
        try { show(await p.readMotionRecording({ fromMsAgo: 120000 })); }
        catch (e) { fail('readMotionRecording', e); }
    };

    // 走動查詢：步數 / 距離 / 各活動狀態時間
    const mvOut = document.getElementById('movement-output');
    const fmtMin = (sec) => `${Math.round((Number(sec) || 0) / 60 * 10) / 10} 分`;
    document.querySelectorAll('#movement-spike [data-movement-min]').forEach(btn => {
        btn.onclick = async () => {
            const p = plugin();
            if (!p || typeof p.queryMovement !== 'function') {
                if (mvOut) mvOut.textContent = '拿不到原生方法——請確認是實機上重新 build 的 App。';
                return;
            }
            const min = Number(btn.dataset.movementMin) || 30;
            if (mvOut) mvOut.textContent = `查詢過去 ${min} 分鐘…`;
            try {
                const r = await p.queryMovement({ fromMsAgo: min * 60 * 1000 });
                const lines = [
                    `區間：過去 ${min} 分鐘`,
                    `步數：${r.steps ?? '—'}　距離：${r.distanceM != null ? Math.round(r.distanceM) + ' 公尺' : '—'}`,
                    `走路 ${fmtMin(r.walkingSec)}・跑步 ${fmtMin(r.runningSec)}・靜止 ${fmtMin(r.stationarySec)}`,
                    `騎車 ${fmtMin(r.cyclingSec)}・搭車 ${fmtMin(r.automotiveSec)}・未知 ${fmtMin(r.unknownSec)}`,
                    '',
                    '原始資料：',
                    JSON.stringify(r, null, 2),
                ];
                if (mvOut) mvOut.textContent = lines.join('\n');
            } catch (e) {
                if (mvOut) mvOut.textContent = 'queryMovement 失敗：' + (e?.message || e);
            }
        };
    });
}


// ─────────────────────────────────────────────────────────────
// Pickup 偵測測試（實機）：自由測試 + 腳本測試（自動算準確率）
// 演算法在原生 LockStatePlugin.analyzePickups，全程在手機上分析，不需要後端。
// ─────────────────────────────────────────────────────────────

// 腳本：每一步有固定秒數，事件依「開始時間落在哪一步」自動對答案。
// expect：incidental=無心、distracted=潛在分心、glance=瞄一眼（不算分心即正確）、none=不該有拿起、null=休息
const PICKUP_SCRIPT = [
    { title: '準備', sec: 15, say: '開始。請把手機螢幕朝上，平放在桌上，先不要動。', expect: null },
    { title: '挪位置', sec: 12, say: '把手機拿起來，移到旁邊再放下。不用看螢幕，放好後不要動。', expect: 'incidental' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '拿起來滑', sec: 25, say: '拿起手機，看著螢幕滑動大約十五秒，然後螢幕朝上放回桌上。', expect: 'distracted' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '敲桌子', sec: 10, say: '不要碰手機，輕輕敲桌面兩下。', expect: 'none' },
    { title: '休息', sec: 6, say: '放著不要動。', expect: null },
    { title: '快速瞄一眼', sec: 10, say: '拿起手機，瞄一眼兩秒，馬上螢幕朝上放回。', expect: 'glance' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '挪位置並蓋上', sec: 12, say: '把手機拿起來移到另一邊，這次螢幕朝下放。', expect: 'incidental' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '翻起來滑', sec: 25, say: '把手機翻過來，看著螢幕滑動大約十五秒，看完螢幕朝下放回。', expect: 'distracted' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '蓋著挪位置', sec: 12, say: '把手機拿起來移到旁邊，保持螢幕朝下放回。', expect: 'incidental' },
    { title: '休息', sec: 8, say: '放著不要動。', expect: null },
    { title: '翻起來瞄一眼', sec: 10, say: '把手機翻過來瞄一眼兩秒，馬上螢幕朝下放回。', expect: 'glance' },
    { title: '結束', sec: 10, say: '最後一步，放著不要動，等一下會自動分析。', expect: null },
];
const CLS_LABEL = { incidental: '無心', uncertain: '不確定', distracted: '潛在分心' };
const KIND_LABEL = { bump: '碰撞/震動', moving: '移動中', setup: '剛放下' };
const EXPECT_LABEL = { incidental: '無心', distracted: '潛在分心', glance: '不算分心', none: '無事件' };

let lastPickupResult = null;

function lockPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    return cap.Plugins?.LockState || null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function say(text) {
    try {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        window.speechSynthesis.speak(u);
    } catch (_) { /* 語音不可用就只靠畫面 + 震動 */ }
}

function mmss(ms) {
    const sec = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function eventLabel(e) {
    return e.kind === 'pickup' ? (CLS_LABEL[e.cls] || e.cls) : (KIND_LABEL[e.kind] || e.kind);
}

function renderAnalysis(res, heading) {
    if (!res?.ok) {
        const why = res?.reason === 'unavailable' ? '這台 iPhone 不支援動作錄製' : '沒有錄到資料（要先按「開始錄」，或等一下再分析）';
        return `${heading}\n分析失敗：${why}`;
    }
    const c = res.counts || {};
    const mv = res.movement || {};
    const lines = [
        heading,
        `共拿起 ${res.pickups} 次：無心 ${c.incidental || 0}・不確定 ${c.uncertain || 0}・潛在分心 ${c.distracted || 0}`,
        `（另：碰撞/震動 ${c.bump || 0}、移動中 ${c.moving || 0}）`,
        `面朝下 ${Math.round((res.faceDownRatio || 0) * 100)}%・放著 ${Math.round((res.restRatio || 0) * 100)}%・資料 ${res.coverageSec}/${res.windowSec} 秒・步數 ${mv.steps ?? '—'}`,
        '',
    ];
    (res.events || []).forEach((e, i) => {
        const score = e.kind === 'pickup' ? `（分數 ${e.score}）` : '';
        lines.push(`#${i + 1} ${mmss(e.startMs - res.fromMs)}  ${e.durationSec} 秒  ${eventLabel(e)}${score}`);
        lines.push(`    ${(e.reasons || []).join('；')}`);
    });
    const pr = res.params || {};
    lines.push('', `門檻：雜訊底 ${pr.noiseFloor}g → 靜止 < ${pr.actStill}g・搬動 ≥ ${pr.actMove}g・看螢幕 ≥ ${pr.viewDistractSec} 秒算潛在分心`);
    return lines.join('\n');
}

// 依腳本時間槽對答案：事件歸到「開始時間所在的那一步」
function evaluateScript(slots, res) {
    const events = res?.events || [];
    const rows = [];
    let binOk = 0, binN = 0, strictOk = 0, strictN = 0, detectOk = 0, detectN = 0, extra = 0;
    for (const s of slots) {
        const inSlot = events.filter(e => e.startMs >= s.startMs && e.startMs < s.endMs);
        const picks = inSlot.filter(e => e.kind === 'pickup');
        if (s.expect === null) {
            // 休息/準備：不該出現拿起（準備階段的「剛放下」不算）
            if (picks.length) {
                extra += picks.length;
                rows.push({ ok: false, title: `${s.title}（不該有拿起）`, expect: '無事件', got: picks.map(eventLabel).join('、') });
            }
            continue;
        }
        detectN++;
        if (s.expect === 'none') {
            const ok = picks.length === 0;
            if (ok) detectOk++;
            rows.push({ ok, title: s.title, expect: EXPECT_LABEL.none,
                got: ok ? (inSlot.some(e => e.kind === 'bump') ? '碰撞/震動（不算拿起）' : '無事件') : picks.map(eventLabel).join('、') });
            continue;
        }
        binN++; strictN++;
        if (!picks.length) {
            rows.push({ ok: false, title: s.title, expect: EXPECT_LABEL[s.expect], got: '沒偵測到' });
            continue;
        }
        detectOk++;
        extra += picks.length - 1;
        const main = picks.reduce((a, b) => (b.durationSec > a.durationSec ? b : a));
        const isDistract = main.cls === 'distracted';
        const bin = (s.expect === 'distracted') === isDistract;
        const strict = s.expect === 'distracted' ? isDistract
            : s.expect === 'glance' ? !isDistract
            : main.cls === 'incidental';
        if (bin) binOk++;
        if (strict) strictOk++;
        rows.push({ ok: strict, title: s.title, expect: EXPECT_LABEL[s.expect],
            got: `${eventLabel(main)}（${(main.reasons || []).slice(0, 2).join('；')}）` });
    }
    return { rows, binOk, binN, strictOk, strictN, detectOk, detectN, extra };
}

function renderEvaluation(ev, res, ctxLabel) {
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const lines = [
        `腳本測試結果（情境：${ctxLabel}）`,
        `「是否分心」判斷正確 ${ev.binOk}/${ev.binN}（${pct(ev.binOk, ev.binN)}%）`,
        `分類完全正確 ${ev.strictOk}/${ev.strictN}・偵測正確 ${ev.detectOk}/${ev.detectN}・多偵測 ${ev.extra} 次`,
        '',
    ];
    ev.rows.forEach(r => {
        lines.push(`${r.ok ? '✓' : '✗'} ${r.title}`);
        lines.push(`    預期：${r.expect}　判斷：${r.got}`);
    });
    lines.push('', '──── 完整分析 ────', renderAnalysis(res, '').trim());
    return lines.join('\n');
}

function buildOverlay(onCancel) {
    const el = document.createElement('div');
    el.className = 'pk-overlay';
    el.innerHTML = `
        <button type="button" class="pk-cancel">中止</button>
        <div class="pk-step"></div>
        <div class="pk-title"></div>
        <div class="pk-say"></div>
        <div class="pk-count"></div>
        <div class="pk-next"></div>`;
    el.querySelector('.pk-cancel').onclick = () => {
        if (window.confirm('要中止腳本測試嗎？')) onCancel();
    };
    document.body.appendChild(el);
    return el;
}

async function analyzeWithRetry(p, args, expectSec, out) {
    let res = null;
    for (let attempt = 0; attempt < 8; attempt++) {
        res = await p.analyzePickups(args);
        if (res?.ok && res.coverageSec >= expectSec * 0.85) return res;
        if (out) out.textContent = `等待感測資料寫入…（第 ${attempt + 1} 次）`;
        await sleep(5000);
    }
    return res;
}

function bindPickupTest() {
    const out = document.getElementById('pickup-output');
    const ctxSel = document.getElementById('pickup-context');
    const show = (text) => { if (out) out.textContent = text; };
    const ctx = () => ctxSel?.value || 'general';
    const ctxLabel = () => ctxSel?.selectedOptions?.[0]?.textContent || '一般';
    const needPlugin = () => {
        const p = lockPlugin();
        if (!p || typeof p.analyzePickups !== 'function') {
            show('拿不到原生方法——請確認是在實體 iPhone 上跑重新 build 的 App（模擬器無法測）。');
            return null;
        }
        return p;
    };

    // 自由測試：開始錄
    document.querySelectorAll('#pickup-test [data-pickup-record]').forEach(btn => {
        btn.onclick = async () => {
            const p = needPlugin();
            if (!p) return;
            const min = Number(btn.dataset.pickupRecord) || 3;
            try {
                const r = await p.startMotionRecording({ durationSec: min * 60 + 60 });
                if (!r?.ok) { show('這台 iPhone 不支援動作錄製。'); return; }
                show(`已開始錄 ${min} 分鐘（${new Date().toLocaleTimeString()}）。\n像平常一樣放著、拿起幾次，可以鎖螢幕。結束後按「分析最近 ${min} 分鐘」。`);
            } catch (e) { show('開始錄製失敗：' + (e?.message || e)); }
        };
    });

    // 自由測試：分析
    document.querySelectorAll('#pickup-test [data-pickup-analyze]').forEach(btn => {
        btn.onclick = async () => {
            const p = needPlugin();
            if (!p) return;
            const min = Number(btn.dataset.pickupAnalyze) || 3;
            show('分析中…');
            try {
                const res = await p.analyzePickups({ fromMsAgo: min * 60 * 1000, context: ctx() });
                lastPickupResult = { mode: 'free', minutes: min, context: ctx(), at: new Date().toISOString(), analysis: res };
                show(renderAnalysis(res, `自由測試：最近 ${min} 分鐘（情境：${ctxLabel()}）`));
            } catch (e) { show('分析失敗：' + (e?.message || e)); }
        };
    });

    // 腳本測試
    const scriptBtn = document.getElementById('pickup-script');
    if (scriptBtn) scriptBtn.onclick = async () => {
        const p = needPlugin();
        if (!p) return;
        const totalSec = PICKUP_SCRIPT.reduce((a, s) => a + s.sec, 0);
        try {
            const r = await p.startMotionRecording({ durationSec: totalSec + 120 });
            if (!r?.ok) { show('這台 iPhone 不支援動作錄製。'); return; }
        } catch (e) { show('開始錄製失敗：' + (e?.message || e)); return; }

        let cancelled = false;
        try { await p.setKeepAwake({ on: true }); } catch (_) {}
        const overlay = buildOverlay(() => { cancelled = true; });
        const $ = (sel) => overlay.querySelector(sel);

        const startMs = Date.now();
        let off = 0;
        const slots = PICKUP_SCRIPT.map(s => {
            const slot = { ...s, startMs: startMs + off * 1000, endMs: startMs + (off + s.sec) * 1000 };
            off += s.sec;
            return slot;
        });

        for (let i = 0; i < slots.length && !cancelled; i++) {
            const s = slots[i];
            $('.pk-step').textContent = `第 ${i + 1} / ${slots.length} 步`;
            $('.pk-title').textContent = s.title;
            $('.pk-say').textContent = s.say;
            $('.pk-next').textContent = slots[i + 1] ? `下一步：${slots[i + 1].title}` : '';
            say(s.say);
            vibrate(s.expect ? 60 : 20);
            while (!cancelled && Date.now() < s.endMs) {   // 以絕對時間倒數，不會累積誤差
                $('.pk-count').textContent = Math.ceil((s.endMs - Date.now()) / 1000);
                await sleep(200);
            }
        }

        overlay.remove();
        try { window.speechSynthesis?.cancel(); } catch (_) {}
        try { await p.setKeepAwake({ on: false }); } catch (_) {}
        if (cancelled) { show('腳本測試已中止。'); return; }

        const endMs = slots[slots.length - 1].endMs;
        show('分析中…');
        try {
            const res = await analyzeWithRetry(p, { fromMs: startMs - 1000, toMs: endMs + 1000, context: ctx() },
                (endMs - startMs) / 1000, out);
            const ev = evaluateScript(slots, res);
            lastPickupResult = {
                mode: 'script', context: ctx(), at: new Date().toISOString(),
                script: slots.map(s => ({ title: s.title, expect: s.expect, startMs: s.startMs, endMs: s.endMs })),
                evaluation: { binOk: ev.binOk, binN: ev.binN, strictOk: ev.strictOk, strictN: ev.strictN,
                    detectOk: ev.detectOk, detectN: ev.detectN, extra: ev.extra, rows: ev.rows },
                analysis: res,
            };
            show(renderEvaluation(ev, res, ctxLabel()));
        } catch (e) { show('分析失敗：' + (e?.message || e)); }
    };

    // 複製結果（JSON，貼給開發者校準門檻用）
    const copyBtn = document.getElementById('pickup-copy');
    if (copyBtn) copyBtn.onclick = async () => {
        if (!lastPickupResult) { show('還沒有結果可以複製。'); return; }
        const text = JSON.stringify(lastPickupResult, null, 1);
        try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = '已複製 ✓';
            setTimeout(() => { copyBtn.textContent = '複製結果（貼給開發者）'; }, 1500);
        } catch (_) {
            show(text);   // 剪貼簿不可用：直接顯示，讓使用者長按選取
        }
    };
}
