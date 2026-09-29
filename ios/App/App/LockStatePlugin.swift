import Foundation
import Capacitor
import UIKit
import CoreMotion

/// LockState — 回報「裝置是否鎖定」給前端，讓分心偵測能分辨
/// 「在 App 內按關螢幕鍵（鎖定）」與「切去別的 app」。
///
/// iOS 沒有公開的即時鎖定 API，改用資料保護通知：
///   protectedDataWillBecomeUnavailable → 裝置鎖定（需使用者有設密碼/Face ID）
///   protectedDataDidBecomeAvailable    → 裝置解鎖
/// 未設密碼的裝置不會觸發，此時前端會 fallback 回原本行為。
@objc(LockStatePlugin)
public class LockStatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LockStatePlugin"
    public let jsName = "LockState"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        // --- 動作偵測 spike（CMSensorRecorder 可行性驗證，實機專用）---
        CAPPluginMethod(name: "motionAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMotionRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readMotionRecording", returnType: CAPPluginReturnPromise),
        // --- 走動查詢（戶外情境走動修正）：iPhone 本來就在背景記步數/活動，直接查歷史即可 ---
        CAPPluginMethod(name: "queryMovement", returnType: CAPPluginReturnPromise),
        // --- Pickup 偵測：規則式、全程在裝置上分析，只回傳事件與統計 ---
        CAPPluginMethod(name: "analyzePickups", returnType: CAPPluginReturnPromise),
        // --- 腳本測試時讓螢幕保持亮著（避免自動鎖定中斷腳本） ---
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise)
    ]

    // 協同處理器離線錄製器：App 可被 suspend / 螢幕可關，資料仍由 M 系列協同處理器記著。
    private let sensorRecorder = CMSensorRecorder()
    // 步數/活動歷史：系統由協同處理器持續記錄（保留約 7 天），不需要事先「開始錄製」。
    private let pedometer = CMPedometer()
    private let activityManager = CMMotionActivityManager()

    private var locked = false
    private var lastLockedAt: Double = 0
    private var lastUnlockedAt: Double = 0

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(deviceDidLock),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(deviceDidUnlock),
            name: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil
        )
    }

    @objc private func deviceDidLock() {
        locked = true
        lastLockedAt = Date().timeIntervalSince1970 * 1000
        notifyListeners("lockStateChange", data: stateData())
    }

    @objc private func deviceDidUnlock() {
        locked = false
        lastUnlockedAt = Date().timeIntervalSince1970 * 1000
        notifyListeners("lockStateChange", data: stateData())
    }

    private func stateData() -> [String: Any] {
        return [
            "locked": locked,
            "lastLockedAt": lastLockedAt,
            "lastUnlockedAt": lastUnlockedAt
        ]
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(stateData())
    }

    // MARK: - 動作偵測 spike（CMSensorRecorder）

    /// 這台裝置到底支不支援協同處理器離線錄製 + 目前的動作權限狀態。
    @objc func motionAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": CMSensorRecorder.isAccelerometerRecordingAvailable(),
            "authStatus": CMSensorRecorder.authorizationStatus().rawValue  // 0=未決定 1=受限 2=拒絕 3=已授權
        ])
    }

    /// 開始「代錄」：呼叫後即使 App 進背景、螢幕關閉，協同處理器仍會記錄加速度。
    /// 第一次呼叫會跳出「動作與健身」權限詢問（需 Info.plist NSMotionUsageDescription）。
    @objc func startMotionRecording(_ call: CAPPluginCall) {
        let durationSec = call.getDouble("durationSec") ?? 60
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else {
            call.resolve(["ok": false, "reason": "unavailable"])
            return
        }
        sensorRecorder.recordAccelerometer(forDuration: durationSec)
        call.resolve(["ok": true, "durationSec": durationSec])
    }

    /// 把最近 fromMsAgo 毫秒內、協同處理器已錄好的資料撈回來，離線算幾個簡單指標。
    /// sampleCount > 0 就代表「螢幕關著、背景也錄得到」在這台機子成立。
    @objc func readMotionRecording(_ call: CAPPluginCall) {
        let fromMsAgo = call.getDouble("fromMsAgo") ?? 120000
        let to = Date()
        let from = Date(timeIntervalSinceNow: -(fromMsAgo / 1000.0))

        guard let list = sensorRecorder.accelerometerData(from: from, to: to) else {
            call.resolve(["ok": false, "reason": "noData", "sampleCount": 0])
            return
        }

        var count = 0
        var movementBursts = 0   // 從靜止進入「明顯晃動」的次數 → 粗估「拿起/移動」
        var faceDownSamples = 0  // 螢幕朝下（重力 z 接近 +1g）的樣本數
        var quiet = true
        // CMSensorDataList 只符合 NSFastEnumeration，不是 Swift Sequence，需手動迭代。
        var iterator = NSFastEnumerationIterator(list)
        while let element = iterator.next() {
            guard let d = element as? CMRecordedAccelerometerData else { continue }
            count += 1
            let ax: Double = d.acceleration.x
            let ay: Double = d.acceleration.y
            let az: Double = d.acceleration.z
            let sumSq: Double = ax * ax + ay * ay + az * az
            let mag: Double = sumSq.squareRoot()
            if abs(mag - 1.0) > 0.35 {
                if quiet { movementBursts += 1; quiet = false }
            } else {
                quiet = true
            }
            if az > 0.8 { faceDownSamples += 1 }
        }
        let faceDownRatio = count > 0 ? Double(faceDownSamples) / Double(count) : 0
        call.resolve([
            "ok": true,
            "sampleCount": count,
            "movementBursts": movementBursts,
            "faceDownRatio": faceDownRatio
        ])
    }

    // MARK: - 走動查詢（CMPedometer + CMMotionActivityManager 歷史）

    /// 查 [fromMs, toMs]（或最近 fromMsAgo 毫秒）這段時間的步數、距離，
    /// 以及靜止/走路/跑步/騎車/搭車各佔幾秒。全部是系統已記好的歷史，不耗額外電。
    @objc func queryMovement(_ call: CAPPluginCall) {
        let (from, to) = Self.timeRange(of: call, defaultAgoMs: 1_800_000)
        fetchMovement(from: from, to: to) { summary, _ in
            call.resolve(summary)
        }
    }

    /// 走動資料的共用查詢：回傳統計摘要 + 「移動中」區間（走路/跑步/騎車/搭車，信心度中以上）。
    /// 移動區間給 pickup 分析用：這段時間的晃動是走路/搭車造成的，不是拿起手機。
    private func fetchMovement(from: Date, to: Date,
                               completion: @escaping ([String: Any], [LocomotionInterval]) -> Void) {
        let lock = NSLock()
        var summary: [String: Any] = [
            "windowSec": max(0, to.timeIntervalSince(from)),
            "stepAvailable": CMPedometer.isStepCountingAvailable(),
            "activityAvailable": CMMotionActivityManager.isActivityAvailable(),
            "authStatus": CMPedometer.authorizationStatus().rawValue  // 0=未決定 1=受限 2=拒絕 3=已授權
        ]
        var intervals: [LocomotionInterval] = []
        func put(_ key: String, _ value: Any) { lock.lock(); summary[key] = value; lock.unlock() }

        let group = DispatchGroup()
        if CMPedometer.isStepCountingAvailable() {
            group.enter()
            pedometer.queryPedometerData(from: from, to: to) { data, error in
                if let data = data {
                    put("steps", data.numberOfSteps.intValue)
                    put("distanceM", data.distance?.doubleValue ?? 0)
                } else if let error = error {
                    put("stepError", error.localizedDescription)
                }
                group.leave()
            }
        }
        if CMMotionActivityManager.isActivityAvailable() {
            group.enter()
            activityManager.queryActivityStarting(from: from, to: to, to: OperationQueue()) { activities, error in
                if let acts = activities {
                    var secs: [String: Double] = [
                        "stationary": 0, "walking": 0, "running": 0,
                        "cycling": 0, "automotive": 0, "unknown": 0
                    ]
                    var found: [LocomotionInterval] = []
                    // 每筆活動持續到下一筆開始（最後一筆到 to）
                    for (i, a) in acts.enumerated() {
                        let start = max(a.startDate, from)
                        let end = i + 1 < acts.count ? acts[i + 1].startDate : to
                        let dur = max(0, end.timeIntervalSince(start))
                        let key: String
                        if a.walking { key = "walking" }
                        else if a.running { key = "running" }
                        else if a.cycling { key = "cycling" }
                        else if a.automotive { key = "automotive" }
                        else if a.stationary { key = "stationary" }
                        else { key = "unknown" }
                        secs[key, default: 0] += dur
                        let moving = key == "walking" || key == "running" || key == "cycling" || key == "automotive"
                        if moving && a.confidence != .low && dur > 0 {
                            found.append(LocomotionInterval(start: start.timeIntervalSince1970,
                                                            end: end.timeIntervalSince1970, type: key))
                        }
                    }
                    for (k, v) in secs { put(k + "Sec", v) }
                    lock.lock(); intervals = found; lock.unlock()
                } else if let error = error {
                    put("activityError", error.localizedDescription)
                }
                group.leave()
            }
        }
        group.notify(queue: .global(qos: .userInitiated)) {
            lock.lock(); let s = summary; let iv = intervals; lock.unlock()
            completion(s, iv)
        }
    }

    /// 解析 fromMs/toMs（或 fromMsAgo）成查詢區間。
    private static func timeRange(of call: CAPPluginCall, defaultAgoMs: Double) -> (Date, Date) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let toMs = call.getDouble("toMs") ?? nowMs
        let fromMs = call.getDouble("fromMs") ?? (toMs - (call.getDouble("fromMsAgo") ?? defaultAgoMs))
        return (Date(timeIntervalSince1970: fromMs / 1000), Date(timeIntervalSince1970: toMs / 1000))
    }

    // MARK: - Pickup 偵測（規則式、on-device）

    /// 分析一段時間內「手機被拿起」的事件，並判斷每次是「無心之舉 / 不確定 / 潛在分心」。
    /// 原始加速度只在裝置上處理，回傳的只有事件與統計。
    /// 參數：fromMs/toMs（或 fromMsAgo）、context（情境 key，戶外會放寬）、unlockMs（選填：解鎖時間點）
    @objc func analyzePickups(_ call: CAPPluginCall) {
        let (from, to) = Self.timeRange(of: call, defaultAgoMs: 300_000)
        let context = call.getString("context") ?? "general"
        let unlockMs = (call.getArray("unlockMs") ?? []).compactMap { ($0 as? NSNumber)?.doubleValue }
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else {
            call.resolve(["ok": false, "reason": "unavailable"])
            return
        }
        let recorder = sensorRecorder
        fetchMovement(from: from, to: to) { movement, intervals in
            guard let list = recorder.accelerometerData(from: from, to: to) else {
                var out: [String: Any] = ["ok": false, "reason": "noData", "sampleCount": 0]
                out["movement"] = movement
                call.resolve(out)
                return
            }
            var analyzer = PickupAnalyzer(config: .forContext(context),
                                          from: from.timeIntervalSince1970,
                                          to: to.timeIntervalSince1970)
            var iterator = NSFastEnumerationIterator(list)
            while let element = iterator.next() {
                guard let d = element as? CMRecordedAccelerometerData else { continue }
                analyzer.add(t: d.startDate.timeIntervalSince1970,
                             x: d.acceleration.x, y: d.acceleration.y, z: d.acceleration.z)
            }
            var out = analyzer.analyze(locomotion: intervals, unlocks: unlockMs.map { $0 / 1000 })
            out["ok"] = true
            out["context"] = context
            out["movement"] = movement
            call.resolve(out)
        }
    }

    /// 腳本測試時避免螢幕自動鎖定（on=true 保持亮著；結束一定要 on=false）。
    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve(["on": on])
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

/// Capacitor 8 只會自動註冊 SPM 套件 plugin；寫在 App 專案裡的本地 plugin（LockState）
/// 必須在 capacitorDidLoad() 手動 registerPluginType，否則 JS 端的
/// window.Capacitor.Plugins.LockState 會是 undefined（過去一直靜默走 fallback）。
class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // 注意：registerPluginType() 在 autoRegisterPlugins=true（本專案預設）時是空操作，
        // 只讀 capacitor.config.json 的套件清單、不含本地 plugin。
        // registerPluginInstance() 沒有這個限制，會直接註冊並 exportJS 給前端。
        bridge?.registerPluginInstance(LockStatePlugin())
    }
}

// MARK: - Pickup 偵測演算法（規則式、可解釋、全程 on-device）
//
// 流程：
//  1. 分窗：每 0.5 秒一窗，算「平均重力方向（姿態）」與「動作強度 act」。
//     act = 窗內加速度相對平均向量的 RMS（g）：放桌上≈感測器雜訊、手持≈手部微震、搬動≈大。
//  2. 自適應門檻：取整段最安靜 10% 窗的上緣當雜訊底，×2.5 當「靜止」門檻（夾在 0.008–0.03g），
//     不同手機、不同桌面都能自動校正。
//  3. 分段：平放且靜止持續 ≥ 3 秒 = 「放著」；兩段「放著」之間 = 一段「活動」。
//  4. 每段活動先判斷：錄製開頭 / 碰撞震動 / 移動中（走路、搭車、放口袋）/ 真的拿起。
//     移動中的晃動不算拿起（任何情境都適用），但其中「看螢幕夠久」的片段會另外抽出來。
//  5. 真的拿起：依「看螢幕姿勢持續多久、拿多久、拿得穩不穩、是否翻面、是否解鎖」給分，
//     分成 無心之舉 / 不確定 / 潛在分心，並附上中文理由（可解釋）。

struct LocomotionInterval {
    let start: Double   // epoch 秒
    let end: Double
    let type: String    // walking / running / cycling / automotive
}

struct PickupConfig {
    var windowSec = 0.5
    var restMinSec = 3.0            // 放著至少多久才算「放下」
    var actMove = 0.08              // 動作強度 ≥ 此值 = 明顯搬動（g）
    var actStillFloor = 0.008       // 靜止門檻下限
    var actStillCeil = 0.03         // 靜止門檻上限（避免整段都在手上時把手持誤當靜止）
    var actStillMult = 2.5          // 靜止門檻 = 雜訊底 × 此倍數
    var flatUz = 0.8                // |uz| > 此值 = 平放（螢幕朝上或朝下）
    var viewUzMax = -0.2            // uz < 此值 = 螢幕朝上半邊（看得到螢幕的角度）
    var bumpMaxSec = 1.0            // 碰撞/震動（規則一）：短於此秒數、峰值低、全程沒離開平放
    var bumpMaxPeak = 0.25
    var bumpStillMaxSec = 3.0       // 碰撞/震動（規則二）：全程平放且從沒真正搬動，3 秒內（連敲兩下桌子）
    var carryMinSec = 45.0          // 長時間在手上/口袋且很少看螢幕 → 攜帶中
    var carryMaxViewRatio = 0.3
    var locoOverlap = 0.5           // 與系統判定「移動中」重疊 ≥ 此比例 → 移動中
    var viewDistractSec = 8.0       // 看螢幕姿勢連續 ≥ 此秒數 → 潛在分心
    var setupGraceSec = 30.0        // 錄製開頭的活動段短於此 → 視為「剛放下手機」
    var distractScore = 0.55
    var incidentalScore = 0.30

    static func forContext(_ ctx: String) -> PickupConfig {
        var c = PickupConfig()
        if ctx == "outdoor" {
            // 戶外：看地圖、拍照較常見，判定「潛在分心」的標準放寬
            c.viewDistractSec = 15
            c.distractScore = 0.70
        }
        return c
    }
}

struct MotionWindow {
    let t: Double      // 窗起點（epoch 秒）
    let n: Int         // 樣本數
    let act: Double    // 動作強度（g）
    let uz: Double     // 平均重力方向的 z 分量：+1 螢幕朝下平放、-1 螢幕朝上平放
    let peak: Double   // 窗內單一樣本偏離平均的最大值（g）
    var valid: Bool { n >= 5 }
}

fileprivate func r1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
fileprivate func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
fileprivate func r4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
fileprivate func fmt1(_ v: Double) -> String { String(format: "%.1f", v) }

struct PickupAnalyzer {
    let cfg: PickupConfig
    let from: Double
    let to: Double

    private(set) var windows: [MotionWindow] = []
    private(set) var sampleCount = 0
    private var curIdx = -1
    private var buf: [(Double, Double, Double)] = []

    init(config: PickupConfig, from: Double, to: Double) {
        self.cfg = config
        self.from = from
        self.to = to
    }

    /// 餵一筆加速度樣本（需依時間順序）。
    mutating func add(t: Double, x: Double, y: Double, z: Double) {
        let idx = Int((t - from) / cfg.windowSec)
        guard idx >= 0, t <= to, idx >= curIdx else { return }
        if idx != curIdx { flush(); curIdx = idx }
        buf.append((x, y, z))
        sampleCount += 1
    }

    private mutating func flush() {
        guard curIdx >= 0, !buf.isEmpty else { return }
        while windows.count < curIdx {   // 沒資料的空窗補上（n=0，視為無效）
            windows.append(MotionWindow(t: from + Double(windows.count) * cfg.windowSec,
                                        n: 0, act: 0, uz: 0, peak: 0))
        }
        let n = Double(buf.count)
        var mx = 0.0, my = 0.0, mz = 0.0
        for s in buf { mx += s.0; my += s.1; mz += s.2 }
        mx /= n; my /= n; mz /= n
        var sq = 0.0, pk = 0.0
        for s in buf {
            let dx = s.0 - mx, dy = s.1 - my, dz = s.2 - mz
            let d2 = dx * dx + dy * dy + dz * dz
            sq += d2
            pk = max(pk, d2.squareRoot())
        }
        let norm = (mx * mx + my * my + mz * mz).squareRoot()
        windows.append(MotionWindow(t: from + Double(curIdx) * cfg.windowSec, n: buf.count,
                                    act: (sq / n).squareRoot(),
                                    uz: norm > 0.3 ? mz / norm : 0,
                                    peak: pk))
        buf.removeAll(keepingCapacity: true)
    }

    mutating func analyze(locomotion: [LocomotionInterval], unlocks: [Double]) -> [String: Any] {
        flush()
        let cfg = self.cfg
        let windows = self.windows
        let w = cfg.windowSec

        // ── 2. 自適應靜止門檻 ──
        let acts = windows.filter { $0.valid }.map { $0.act }.sorted()
        let noise = acts.isEmpty ? 0.004 : acts[min(acts.count - 1, acts.count / 10)]
        let actStill = min(cfg.actStillCeil, max(cfg.actStillFloor, noise * cfg.actStillMult))

        func isRest(_ m: MotionWindow) -> Bool { m.valid && m.act < actStill && abs(m.uz) > cfg.flatUz }
        func isHold(_ m: MotionWindow) -> Bool { m.valid && m.act >= actStill && m.act < cfg.actMove }
        func isViewing(_ m: MotionWindow) -> Bool { isHold(m) && m.uz < cfg.viewUzMax }

        // ── 3. 分段：放著 / 活動 ──
        struct Seg { let s: Int; let e: Int; let before: String?; let after: String?; let atStart: Bool }
        var segs: [Seg] = []
        let restMin = max(1, Int((cfg.restMinSec / w).rounded()))
        var restRun = 0
        var segStart: Int? = 0          // 錄製開頭先視為「還沒放下」
        var atStart = true
        var lastRestOri: String? = nil
        var validWins = 0, restWins = 0, downRestWins = 0
        for (i, m) in windows.enumerated() {
            guard m.valid else { restRun = 0; continue }
            validWins += 1
            if isRest(m) {
                restWins += 1
                if m.uz > 0 { downRestWins += 1 }
                restRun += 1
                if restRun >= restMin {
                    let o = m.uz > 0 ? "down" : "up"
                    if let s = segStart {
                        let e = i - restRun + 1
                        if e > s {
                            segs.append(Seg(s: s, e: e, before: atStart ? nil : lastRestOri, after: o, atStart: atStart))
                        }
                        segStart = nil
                        atStart = false
                    }
                    lastRestOri = o
                }
            } else {
                restRun = 0
                if segStart == nil { segStart = i }
            }
        }
        if let s = segStart, s < windows.count {
            segs.append(Seg(s: s, e: windows.count, before: atStart ? nil : lastRestOri, after: nil, atStart: atStart))
        }

        func locoOverlap(_ a: Double, _ b: Double) -> (Double, String?) {
            var total = 0.0, best = 0.0
            var type: String? = nil
            for iv in locomotion {
                let o = max(0, min(b, iv.end) - max(a, iv.start))
                if o > 0 {
                    total += o
                    if o > best { best = o; type = iv.type }
                }
            }
            return (min(total, b - a), type)
        }
        let locoName = ["walking": "走路", "running": "跑步", "cycling": "騎車", "automotive": "搭車"]

        // ── 4 & 5. 每段活動判斷 + 分類 ──
        var events: [[String: Any]] = []
        var counts: [String: Int] = ["incidental": 0, "uncertain": 0, "distracted": 0,
                                     "bump": 0, "moving": 0, "setup": 0]
        for seg in segs {
            guard let fv = (seg.s..<seg.e).first(where: { windows[$0].valid }),
                  let lv = (seg.s..<seg.e).last(where: { windows[$0].valid }) else { continue }
            let startT = windows[fv].t
            let endT = windows[lv].t + w
            let dur = max(w, endT - startT)

            var nValid = 0, nView = 0, nHold = 0
            var peak = 0.0, maxAct = 0.0
            var leftFlat = false
            var runs: [(Int, Int)] = []      // 看螢幕姿勢的連續片段（容許中間 1 窗空隙）
            var rs = -1, lastView = -1
            for i in seg.s..<seg.e {
                let m = windows[i]
                if m.valid {
                    nValid += 1
                    peak = max(peak, m.peak)
                    maxAct = max(maxAct, m.act)
                    if abs(m.uz) < cfg.flatUz { leftFlat = true }
                    if isHold(m) { nHold += 1 }
                }
                if isViewing(m) {
                    nView += 1
                    if rs >= 0 && i - lastView <= 2 {
                        lastView = i
                    } else {
                        if rs >= 0 { runs.append((rs, lastView + 1)) }
                        rs = i
                        lastView = i
                    }
                }
            }
            if rs >= 0 { runs.append((rs, lastView + 1)) }
            let bestRunSec = runs.map { Double($0.1 - $0.0) * w }.max() ?? 0
            let viewSec = Double(nView) * w
            let viewRatio = nValid > 0 ? Double(nView) / Double(nValid) : 0
            let steadyRatio = nValid > 0 ? Double(nHold) / Double(nValid) : 0
            let (locoSec, locoType) = locoOverlap(startT, endT)
            let locoRatio = locoSec / dur
            let unlocked = unlocks.contains { $0 >= startT && $0 <= endT }
            let flipped = seg.before == "down" && viewSec >= 1

            var ev: [String: Any] = [
                "startMs": startT * 1000, "endMs": endT * 1000,
                "durationSec": r1(dur), "viewLongestSec": r1(bestRunSec), "viewSec": r1(viewSec),
                "viewRatio": r2(viewRatio), "steadyRatio": r2(steadyRatio), "peakAct": r2(peak),
                "locoRatio": r2(locoRatio), "beforeOri": seg.before ?? "", "afterOri": seg.after ?? "",
                "unlocked": unlocked
            ]

            // 錄製開頭：手機剛放下
            if seg.atStart && dur < cfg.setupGraceSec {
                counts["setup", default: 0] += 1
                ev["kind"] = "setup"
                ev["reasons"] = ["錄製開始時手機還在手上（剛放下）"]
                events.append(ev)
                continue
            }
            // 碰撞 / 通知震動：全程沒離開平放，且（很短、峰值低）或（從沒真正搬動、3 秒內）
            let shortBump = dur <= cfg.bumpMaxSec && peak < cfg.bumpMaxPeak
            let stillBump = dur <= cfg.bumpStillMaxSec && maxAct < cfg.actMove
            if !leftFlat && (shortBump || stillBump) {
                counts["bump", default: 0] += 1
                ev["kind"] = "bump"
                ev["reasons"] = ["沒離開平放、沒有真正移動：碰到桌子或通知震動"]
                events.append(ev)
                continue
            }
            // 移動中（走路/搭車）或長時間攜帶：晃動不算拿起，但抽出「看螢幕夠久」的片段
            let isLoco = locoRatio >= cfg.locoOverlap
            let isCarry = dur >= cfg.carryMinSec && viewRatio < cfg.carryMaxViewRatio
            if isLoco || isCarry {
                let how = locoName[locoType ?? ""] ?? "移動"
                counts["moving", default: 0] += 1
                ev["kind"] = "moving"
                ev["reasons"] = [isLoco ? "移動中（系統判定：\(how)），晃動不算拿起"
                                        : "長時間在手上或口袋但很少看螢幕，視為攜帶中"]
                events.append(ev)
                for (a, b) in runs {
                    let sec = Double(b - a) * w
                    guard sec >= cfg.viewDistractSec else { continue }
                    counts["distracted", default: 0] += 1
                    events.append([
                        "startMs": windows[a].t * 1000, "endMs": (windows[b - 1].t + w) * 1000,
                        "durationSec": r1(sec), "viewLongestSec": r1(sec), "viewSec": r1(sec),
                        "kind": "pickup", "cls": "distracted", "score": 1.0, "duringMotion": true,
                        "reasons": [isLoco ? "邊\(how)邊看螢幕約 \(fmt1(sec)) 秒" : "拿在手上看螢幕約 \(fmt1(sec)) 秒"]
                    ])
                }
                continue
            }

            // 真的拿起：給分分類
            var score = 0.45 * min(1, bestRunSec / 10)
                      + 0.20 * min(1, dur / 20)
                      + 0.15 * viewRatio
                      + 0.10 * steadyRatio
            if flipped { score += 0.05 }
            if unlocked { score += 0.20 }
            score = min(1, score)

            let cls: String
            if bestRunSec >= cfg.viewDistractSec || (unlocked && bestRunSec >= 3) {
                cls = "distracted"
            } else if viewSec < 1.0 && dur < 6 {
                cls = "incidental"
            } else if score >= cfg.distractScore {
                cls = "distracted"
            } else if score <= cfg.incidentalScore {
                cls = "incidental"
            } else {
                cls = "uncertain"
            }
            counts[cls, default: 0] += 1

            var reasons = ["在手上 \(fmt1(dur)) 秒"]
            reasons.append(bestRunSec >= 1 ? "看螢幕的姿勢連續約 \(fmt1(bestRunSec)) 秒" : "幾乎沒有看螢幕的角度")
            if flipped { reasons.append("從螢幕朝下翻起來") }
            if steadyRatio >= 0.6 { reasons.append("拿得很平穩，像在閱讀") }
            else if steadyRatio < 0.3 { reasons.append("大多在搬動") }
            if unlocked { reasons.append("期間有解鎖") }
            if locoRatio > 0.1 { reasons.append("部分時間在移動中") }
            switch seg.after {
            case "down": reasons.append("放回時螢幕朝下")
            case "up": reasons.append("放回時螢幕朝上")
            default: reasons.append("結束時還拿在手上")
            }
            ev["kind"] = "pickup"
            ev["cls"] = cls
            ev["score"] = r2(score)
            ev["reasons"] = reasons
            events.append(ev)
        }
        events.sort { (($0["startMs"] as? Double) ?? 0) < (($1["startMs"] as? Double) ?? 0) }

        let pickups = (counts["incidental"] ?? 0) + (counts["uncertain"] ?? 0) + (counts["distracted"] ?? 0)
        return [
            "sampleCount": sampleCount,
            "coverageSec": r1(Double(validWins) * w),
            "windowSec": r1(to - from),
            "fromMs": from * 1000,
            "toMs": to * 1000,
            "faceDownRatio": validWins > 0 ? r2(Double(downRestWins) / Double(validWins)) : 0,
            "restRatio": validWins > 0 ? r2(Double(restWins) / Double(validWins)) : 0,
            "pickups": pickups,
            "counts": counts,
            "events": events,
            "params": [
                "noiseFloor": r4(noise), "actStill": r4(actStill), "actMove": cfg.actMove,
                "viewDistractSec": cfg.viewDistractSec, "distractScore": cfg.distractScore,
                "windowSec": w, "restMinSec": cfg.restMinSec
            ]
        ]
    }
}
