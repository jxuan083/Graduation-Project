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
        CAPPluginMethod(name: "readMotionRecording", returnType: CAPPluginReturnPromise)
    ]

    // 協同處理器離線錄製器：App 可被 suspend / 螢幕可關，資料仍由 M 系列協同處理器記著。
    private let sensorRecorder = CMSensorRecorder()

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
