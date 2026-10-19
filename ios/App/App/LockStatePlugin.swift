import Foundation
import Capacitor
import UIKit
import CoreMotion
import ActivityKit
import WebKit
import Photos

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
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        // --- 靈動島／鎖定畫面倒數（iOS 16.2+ 即時動態） ---
        CAPPluginMethod(name: "startCountdown", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateCountdown", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCountdown", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGraceCountdown", returnType: CAPPluginReturnPromise),
        // --- 掃碼點餐：App 內建、只能在點餐網站裡走動的瀏覽器 ---
        CAPPluginMethod(name: "openOrdering", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasOrdering", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOrderingTripsLeft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showOrderingMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetOrdering", returnType: CAPPluginReturnPromise),
        // 照片存到手機「照片」App（只要「加入照片」權限，看不到使用者原本的相簿）
        CAPPluginMethod(name: "savePhoto", returnType: CAPPluginReturnPromise)
    ]

    // 協同處理器離線錄製器：App 可被 suspend / 螢幕可關，資料仍由 M 系列協同處理器記著。
    private let sensorRecorder = CMSensorRecorder()
    // 步數/活動歷史：系統由協同處理器持續記錄（保留約 7 天），不需要事先「開始錄製」。
    private let pedometer = CMPedometer()
    private let activityManager = CMMotionActivityManager()

    private var locked = false
    private var lastLockedAt: Double = 0
    private var lastUnlockedAt: Double = 0

    // 跳出 App 的寬限倒數：前端在聚會中先「預備」好，真正開始是 App 即將離開前景那一刻。
    private var graceArmed = false
    private var graceSeconds: Double = 20
    private var graceLabels: [String: String] = [:]
    private var graceStartedOnResign = false
    private var graceStartedAt: Date? = nil
    private var wentToBackground = false
    private var overtimeTask: UIBackgroundTaskIdentifier = .invalid

    // 掃碼點餐的瀏覽器：整場聚會留著同一個（購物車不會不見），聚會結束才丟掉
    private var orderingController: OrderingBrowserController?

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
        center.addObserver(self, selector: #selector(appWillResignActive),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appDidEnterBackground),
                           name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(appWillEnterForeground),
                           name: UIApplication.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(appDidBecomeActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func deviceDidLock() {
        locked = true
        lastLockedAt = Date().timeIntervalSince1970 * 1000
        notifyListeners("lockStateChange", data: stateData())
        // 在 App 內按鎖定鍵不算分心 → 剛才離開前景時開的寬限倒數收掉（暫離倒數照常）。
        // 鎖定訊號會晚約 10 秒才到，所以只有「離開前景後 12 秒內」收到的才算在 App 內關螢幕；
        // 更晚才收到代表是先切去別的 App 再鎖螢幕，倒數照常，要回到 App 才結束（前端同樣這樣算）。
        if let started = graceStartedAt, Date().timeIntervalSince(started) <= 12, #available(iOS 16.2, *) {
            endCountdowns(kind: "grace")
        }
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

    // MARK: - 靈動島／鎖定畫面倒數（即時動態）
    //
    // 暫離倒數：前端在按下暫離（App 在前景）時呼叫 startCountdown，延長時 updateCountdown。
    // 寬限倒數：iOS 只允許在前景開始即時動態，跳出 App 時已經來不及從前端呼叫，
    //   所以前端先用 setGraceCountdown 預備（聚會中、沒在暫離時），由這裡在 willResignActive 開始。
    //   那一瞬間分不出是跳去別的 App 還是按鎖定鍵；確定是鎖定（deviceDidLock）時再收掉。
    // 回到 App（willEnterForeground）一律結束：回來了，暫離也就結束（後端同樣這樣算）。

    @objc private func appWillResignActive() {
        wentToBackground = false
        graceStartedOnResign = false
        guard graceArmed, #available(iOS 16.2, *) else { return }
        guard Activity<AnchorCountdownAttributes>.activities.isEmpty else { return }  // 暫離倒數進行中就不另開
        graceStartedOnResign = startActivity(kind: "grace",
                                             endsAt: Date().addingTimeInterval(graceSeconds),
                                             labels: graceLabels)
        graceStartedAt = graceStartedOnResign ? Date() : nil
    }

    @objc private func appDidEnterBackground() {
        wentToBackground = true
        if #available(iOS 16.2, *) { scheduleOvertimeFlip() }
    }

    @objc private func appWillEnterForeground() {
        graceStartedAt = nil
        endOvertimeTask()
        if #available(iOS 16.2, *) { endCountdowns(kind: nil) }
    }

    /// App 進背景後通常還能多跑約 30 秒。倒數若在這段時間內結束（寬限倒數 10～20 秒），
    /// 就撐到那一刻主動把畫面切成超時；更長的倒數只能靠進度環變空與系統的過期標記。
    @available(iOS 16.2, *)
    private func scheduleOvertimeFlip() {
        guard let activity = Activity<AnchorCountdownAttributes>.activities.first else { return }
        let wait = activity.content.state.endsAt.timeIntervalSinceNow
        guard wait > 0, wait < 28 else { return }
        endOvertimeTask()
        overtimeTask = UIApplication.shared.beginBackgroundTask(withName: "AnchorCountdownOvertime") { [weak self] in
            self?.endOvertimeTask()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + wait + 0.3) { [weak self] in
            Task {
                for activity in Activity<AnchorCountdownAttributes>.activities where !activity.content.state.isOver {
                    var state = activity.content.state
                    state.isOver = true
                    await activity.update(ActivityContent(state: state, staleDate: nil))
                }
                await MainActor.run { self?.endOvertimeTask() }
            }
        }
    }

    private func endOvertimeTask() {
        guard overtimeTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(overtimeTask)
        overtimeTask = .invalid
    }

    @objc private func appDidBecomeActive() {
        // 只是拉下通知中心／控制中心又放開（沒有真的進背景）→ 剛開的寬限倒數收掉
        if graceStartedOnResign && !wentToBackground, #available(iOS 16.2, *) {
            endCountdowns(kind: "grace")
        }
        graceStartedOnResign = false
    }

    private static func labels(from call: CAPPluginCall) -> [String: String] {
        var out: [String: String] = [:]
        for key in ["title", "hint", "overTitle", "overHint", "appName"] {
            out[key] = call.getString(key) ?? ""
        }
        return out
    }

    @available(iOS 16.2, *)
    @discardableResult
    private func startActivity(kind: String, endsAt: Date, labels: [String: String]) -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        let previous = Activity<AnchorCountdownAttributes>.activities
        let state = AnchorCountdownAttributes.ContentState(
            kind: kind, startedAt: Date(), endsAt: endsAt,
            title: labels["title"] ?? "", hint: labels["hint"] ?? "",
            overTitle: labels["overTitle"] ?? "", overHint: labels["overHint"] ?? "",
            appName: labels["appName"] ?? ""
        )
        do {
            // staleDate = 倒數結束：時間一到系統會把它標成過期，畫面就切成往上計時（App 在背景也一樣）
            _ = try Activity.request(attributes: AnchorCountdownAttributes(),
                                     content: ActivityContent(state: state, staleDate: endsAt),
                                     pushType: nil)
        } catch {
            print("[LockState] Live Activity request failed: \(error)")
            return false
        }
        for activity in previous {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        return true
    }

    /// kind = nil 表示全部結束。
    @available(iOS 16.2, *)
    private func endCountdowns(kind: String?) {
        for activity in Activity<AnchorCountdownAttributes>.activities
        where kind == nil || activity.content.state.kind == kind {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// 開始倒數。endsAt 為毫秒時間戳；文字由前端依介面語言帶入。
    @objc func startCountdown(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["started": false]); return }
        let kind = call.getString("kind") ?? "break"
        let endsAt = Date(timeIntervalSince1970: (call.getDouble("endsAt") ?? 0) / 1000)
        let labels = Self.labels(from: call)
        DispatchQueue.main.async {
            call.resolve(["started": self.startActivity(kind: kind, endsAt: endsAt, labels: labels)])
        }
    }

    /// 延長暫離：把進行中的倒數改到新的結束時間。
    @objc func updateCountdown(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        let endsAt = Date(timeIntervalSince1970: (call.getDouble("endsAt") ?? 0) / 1000)
        for activity in Activity<AnchorCountdownAttributes>.activities {
            var state = activity.content.state
            state.endsAt = endsAt
            state.isOver = false
            Task { await activity.update(ActivityContent(state: state, staleDate: endsAt)) }
        }
        call.resolve()
    }

    @objc func endCountdown(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) { endCountdowns(kind: nil) }
        call.resolve()
    }

    /// 預備（armed=true）或取消跳出 App 時的寬限倒數。
    @objc func setGraceCountdown(_ call: CAPPluginCall) {
        let armed = call.getBool("armed") ?? false
        let seconds = max(1, call.getDouble("graceSec") ?? 20)
        let labels = Self.labels(from: call)
        DispatchQueue.main.async {
            self.graceArmed = armed
            self.graceSeconds = seconds
            if armed { self.graceLabels = labels }
            call.resolve()
        }
    }

    // MARK: - 掃碼點餐
    //
    // 點餐網頁開在 App 內建的瀏覽器（OrderingBrowserController），人沒有離開 App，所以不算分心。
    // 只能在掃到的那家點餐網站裡走動；要去別的網站或 App（付款、LINE 點餐）時先確認，
    // 使用者同意就通知前端（orderingExternal），前端向後端登記一次「帶出」成功後再呼叫 openExternal。

    private static func orderingLabels(from call: CAPPluginCall) -> [String: String] {
        var out: [String: String] = [:]
        for key in ["title", "back", "extTitle", "extMessage", "extGo", "extCancel", "noneTitle", "noneMessage", "ok"] {
            out[key] = call.getString(key) ?? ""
        }
        return out
    }

    /// 打開點餐瀏覽器。帶 url = 新掃的一家（換掉舊的）；不帶 = 回到上次的網頁（吃到飽一直加點）。
    @objc func openOrdering(_ call: CAPPluginCall) {
        let urlString = call.getString("url")
        let labels = Self.orderingLabels(from: call)
        let tripsLeft = call.getInt("tripsLeft") ?? 0
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else { call.reject("no view controller"); return }
            if let urlString = urlString {
                guard let url = URL(string: urlString), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                    call.reject("不是點餐網址")
                    return
                }
                self.orderingController = OrderingBrowserController(startURL: url)
            }
            guard let controller = self.orderingController else { call.reject("沒有進行中的點餐"); return }
            controller.labels = labels
            controller.tripsLeft = tripsLeft
            controller.onExternal = { [weak self] url in
                self?.notifyListeners("orderingExternal", data: ["url": url.absoluteString])
            }
            controller.onClose = { [weak self] in
                self?.notifyListeners("orderingClosed", data: [:])
            }
            if controller.presentingViewController == nil {
                // overFullScreen：底下的聚會畫面留在畫面上，網頁的可見狀態不變，不會被當成離開 App
                controller.modalPresentationStyle = .overFullScreen
                presenter.present(controller, animated: true)
            }
            call.resolve()
        }
    }

    @objc func hasOrdering(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["open": self.orderingController != nil]) }
    }

    @objc func setOrderingTripsLeft(_ call: CAPPluginCall) {
        let n = call.getInt("n") ?? 0
        DispatchQueue.main.async {
            self.orderingController?.tripsLeft = n
            call.resolve()
        }
    }

    /// 在點餐瀏覽器上方跳一則訊息（例如後端拒絕帶出時的原因）。
    @objc func showOrderingMessage(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let message = call.getString("message") ?? ""
        let ok = call.getString("ok") ?? "OK"
        DispatchQueue.main.async {
            let host: UIViewController? = self.orderingController?.presentingViewController != nil
                ? self.orderingController : self.bridge?.viewController
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: ok, style: .default))
            host?.present(alert, animated: true)
            call.resolve()
        }
    }

    /// 交給 iOS 打開（外部網頁 → Safari、LINE → LINE App）。前端登記帶出成功後才呼叫。
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? "") else { call.reject("bad url"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in call.resolve(["opened": ok]) }
        }
    }

    /// 聚會結束：收起並丟掉點餐瀏覽器（下一場重新掃）。
    @objc func resetOrdering(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.orderingController?.dismiss(animated: false)
            self.orderingController = nil
            call.resolve()
        }
    }

    /// 把一張照片（base64 的 JPEG/HEIC 原檔）存進「照片」App。
    /// 只要「加入照片」權限；第一次會跳系統詢問，之後拒絕就直接回 denied（前端只提示一次）。
    @objc func savePhoto(_ call: CAPPluginCall) {
        var b64 = call.getString("data") ?? ""
        if let comma = b64.firstIndex(of: ","), b64.hasPrefix("data:") { b64 = String(b64[b64.index(after: comma)...]) }
        guard let data = Data(base64Encoded: b64), !data.isEmpty else { call.reject("bad image"); return }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.resolve(["saved": false, "reason": "denied"])
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, error in
                if ok { call.resolve(["saved": true]) }
                else { call.resolve(["saved": false, "reason": "error", "message": error?.localizedDescription ?? ""]) }
            }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

/// 掃碼點餐用的 App 內建瀏覽器：沒有網址列，只能在點餐網站（最後落地網址的網域）裡走動。
/// 第一次載入時的轉址（短網址 → 真正的點餐系統）都放行；載入完成後，主畫面要換到別的網域
/// 或打開別的 App（line://、付款 App）就先擋下來問使用者，同意才交給前端登記「帶出」。
final class OrderingBrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let startURL: URL
    private var allowedDomain: String?
    private var initialLoadPending = true
    private var webView: WKWebView!
    private let titleLabel = UILabel()
    private let backButton = UIButton(type: .system)

    var labels: [String: String] = [:] { didSet { applyLabels() } }
    var tripsLeft = 0
    var onExternal: ((URL) -> Void)?
    var onClose: (() -> Void)?

    // 配色沿用 App：淡橘背景、咖啡色文字、橘色圖示
    private static let cream = UIColor(red: 255 / 255, green: 212 / 255, blue: 181 / 255, alpha: 1)
    private static let brown = UIColor(red: 79 / 255, green: 53 / 255, blue: 26 / 255, alpha: 1)
    private static let orange = UIColor(red: 224 / 255, green: 120 / 255, blue: 48 / 255, alpha: 1)
    private static let paper = UIColor(red: 251 / 255, green: 248 / 255, blue: 243 / 255, alpha: 1)

    init(startURL: URL) {
        self.startURL = startURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.cream

        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = Self.cream
        view.addSubview(bar)

        let icon = UIImageView(image: UIImage(systemName: "fork.knife"))
        icon.tintColor = Self.orange
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit

        titleLabel.font = .systemFont(ofSize: 16, weight: .bold)
        titleLabel.textColor = Self.brown
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        var config = UIButton.Configuration.filled()
        config.baseBackgroundColor = Self.paper
        config.baseForegroundColor = Self.brown
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 14, bottom: 8, trailing: 14)
        backButton.configuration = config
        backButton.layer.cornerRadius = 18
        backButton.layer.borderWidth = 1
        backButton.layer.borderColor = Self.brown.withAlphaComponent(0.15).cgColor
        backButton.translatesAutoresizingMaskIntoConstraints = false
        backButton.addTarget(self, action: #selector(close), for: .touchUpInside)

        bar.addSubview(icon)
        bar.addSubview(titleLabel)
        bar.addSubview(backButton)

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 56),
            icon.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 20),
            icon.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 20),
            icon.heightAnchor.constraint(equalToConstant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            titleLabel.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            backButton.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            backButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: backButton.leadingAnchor, constant: -12),
            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        applyLabels()
        webView.load(URLRequest(url: startURL))
    }

    private func applyLabels() {
        guard isViewLoaded else { return }
        titleLabel.text = labels["title"]
        var config = backButton.configuration
        var attrs = AttributeContainer()
        attrs.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        config?.attributedTitle = AttributedString(labels["back"] ?? "", attributes: attrs)
        backButton.configuration = config
    }

    @objc private func close() {
        dismiss(animated: true) { [weak self] in self?.onClose?() }
    }

    /// 只比對可註冊網域（例：order.inline.app 與 inline.app 算同一家；.com.tw 這類取三段）。
    static func baseDomain(_ host: String) -> String {
        let parts = host.lowercased().split(separator: ".")
        guard parts.count >= 2 else { return host.lowercased() }
        let lastTwo = parts.suffix(2).joined(separator: ".")
        let twoLevel: Set<String> = ["com.tw", "org.tw", "net.tw", "edu.tw", "gov.tw", "idv.tw", "co.jp", "ne.jp",
                                     "or.jp", "com.hk", "com.cn", "co.uk", "com.sg", "co.kr", "com.au", "com.my"]
        if twoLevel.contains(lastTwo), parts.count >= 3 { return parts.suffix(3).joined(separator: ".") }
        return lastTwo
    }

    private func isOrderingSite(_ url: URL) -> Bool {
        guard let host = url.host, let allowed = allowedDomain else { return false }
        return Self.baseDomain(host) == allowed
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if ["about", "data", "blob", "javascript"].contains(scheme) { decisionHandler(.allow); return }
        let isWeb = scheme == "http" || scheme == "https"
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true   // nil = 要開新視窗
        if isWeb && !isMainFrame { decisionHandler(.allow); return }          // 網頁裡的框架（例如付款元件）
        if isWeb && initialLoadPending { decisionHandler(.allow); return }    // 第一次載入的轉址都放行
        if isWeb && isOrderingSite(url) {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)                       // 開新視窗的連結：在同一頁打開
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
            return
        }
        decisionHandler(.cancel)
        askToLeave(url)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if initialLoadPending, let host = webView.url?.host {
            allowedDomain = Self.baseDomain(host)   // 最後落地的網站 = 這家的點餐網站
            initialLoadPending = false
        }
    }

    // target=_blank / window.open：交給同一套規則判斷
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isOrderingSite(url) { webView.load(navigationAction.request) } else { askToLeave(url) }
        }
        return nil
    }

    private func askToLeave(_ url: URL) {
        guard presentedViewController == nil else { return }
        if tripsLeft <= 0 {
            let alert = UIAlertController(title: labels["noneTitle"], message: labels["noneMessage"], preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: labels["ok"], style: .default))
            present(alert, animated: true)
            return
        }
        let message = (labels["extMessage"] ?? "").replacingOccurrences(of: "{n}", with: String(tripsLeft))
        let alert = UIAlertController(title: labels["extTitle"], message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: labels["extCancel"], style: .cancel))
        alert.addAction(UIAlertAction(title: labels["extGo"], style: .default) { [weak self] _ in
            self?.onExternal?(url)
        })
        present(alert, animated: true)
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
    // 碰撞/震動（規則三，實機校準）：連續敲桌子會讓單一窗的姿態短暫跳動、動作強度也超過「搬動」門檻，
    // 但瞬間峰值遠低於真的拿起（實測敲桌 0.24g，最輕的拿起 0.75g），而且幾乎都維持平放。
    var knockMaxPeak = 0.5
    var knockMaxSec = 8.0
    var knockMaxTiltRatio = 0.5     // 不是平放的窗占比上限
    // 長時間拿在手上、螢幕大多朝著自己（實機校準）：滑手機時手部動作大，常被當成「搬動」，
    // 看螢幕姿勢的判定就斷斷續續；改看「螢幕朝上的時間占比」補判。
    var engagedMinSec = 12.0        // 2026-10-19 第二輪實測：滑 15 秒的實際在手上約 16.5 秒；無心類最長 8.5 秒
    var engagedFacingRatio = 0.6
    var facingMaxAct = 0.5          // 動作強度超過此值（劇烈晃動）時的姿態不可信，不算朝著自己
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

            var nValid = 0, nView = 0, nHold = 0, nTilt = 0, nFacing = 0
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
                    if abs(m.uz) < cfg.flatUz { leftFlat = true; nTilt += 1 }
                    if isHold(m) { nHold += 1 }
                    if m.uz < cfg.viewUzMax && m.act < cfg.facingMaxAct { nFacing += 1 }
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
            let tiltRatio = nValid > 0 ? Double(nTilt) / Double(nValid) : 0
            let facingRatio = nValid > 0 ? Double(nFacing) / Double(nValid) : 0
            let (locoSec, locoType) = locoOverlap(startT, endT)
            let locoRatio = locoSec / dur
            let unlocked = unlocks.contains { $0 >= startT && $0 <= endT }
            let flipped = seg.before == "down" && viewSec >= 1

            var ev: [String: Any] = [
                "startMs": startT * 1000, "endMs": endT * 1000,
                "durationSec": r1(dur), "viewLongestSec": r1(bestRunSec), "viewSec": r1(viewSec),
                "viewRatio": r2(viewRatio), "steadyRatio": r2(steadyRatio), "peakAct": r2(peak),
                "facingRatio": r2(facingRatio), "tiltRatio": r2(tiltRatio),
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
            let knockBump = dur <= cfg.knockMaxSec && peak < cfg.knockMaxPeak && tiltRatio <= cfg.knockMaxTiltRatio
            if (!leftFlat && (shortBump || stillBump)) || knockBump {
                counts["bump", default: 0] += 1
                ev["kind"] = "bump"
                ev["reasons"] = ["沒離開平放、沒有真正移動：碰到桌子或通知震動"]
                events.append(ev)
                continue
            }
            // 移動中（走路/搭車）或長時間攜帶：晃動不算拿起，但抽出「看螢幕夠久」的片段
            let isLoco = locoRatio >= cfg.locoOverlap
            // 螢幕大多朝著自己的不算攜帶（滑手機時手部動作大，viewRatio 會偏低）
            let isCarry = dur >= cfg.carryMinSec && viewRatio < cfg.carryMaxViewRatio && facingRatio < cfg.engagedFacingRatio
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

            let engaged = dur >= cfg.engagedMinSec && facingRatio >= cfg.engagedFacingRatio
            let cls: String
            if bestRunSec >= cfg.viewDistractSec || (unlocked && bestRunSec >= 3) || engaged {
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
            if engaged && bestRunSec < cfg.viewDistractSec {
                reasons.append("螢幕朝著自己約 \(fmt1(facingRatio * dur)) 秒")
            }
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
                "knockMaxPeak": cfg.knockMaxPeak, "engagedMinSec": cfg.engagedMinSec,
                "viewDistractSec": cfg.viewDistractSec, "distractScore": cfg.distractScore,
                "windowSec": w, "restMinSec": cfg.restMinSec
            ]
        ]
    }
}
