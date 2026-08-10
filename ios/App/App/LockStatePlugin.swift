import Foundation
import Capacitor
import UIKit

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
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

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

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
