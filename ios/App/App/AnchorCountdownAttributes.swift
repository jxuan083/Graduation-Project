import Foundation
import ActivityKit

/// 靈動島／鎖定畫面倒數（iOS 即時動態）的資料格式。
/// App（LockStatePlugin 開始／更新／結束倒數）與 AnchorLiveActivity 擴充功能（畫面）共用這個檔案。
///
/// 兩種倒數：
///   break — 按「需要用一下手機」宣告暫離後的豁免倒數；時間到後改成往上計「超時」。
///   grace — 沒暫離就直接跳出 App 時，「還有幾秒會被算分心」的寬限倒數；時間到後改成往上計「分心中」。
/// 倒數到 endsAt 為止。App 在背景時通常沒辦法更新畫面，時間到後的切換見擴充功能裡的說明。
@available(iOS 16.1, *)
struct AnchorCountdownAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var kind: String
        var startedAt: Date      // 倒數開始的時間（進度環／進度條用）
        var endsAt: Date
        var isOver: Bool = false // App 還在背景跑的那幾十秒內，倒數一到就主動設成 true 切成超時畫面
        // 文字由 App 依目前的介面語言帶進來（擴充功能讀不到 App 裡的翻譯字典）
        var title: String       // 倒數中的標題
        var hint: String        // 倒數中的一句說明
        var overTitle: String   // 時間到後的標題
        var overHint: String    // 時間到後的一句說明
        var appName: String = "" // 鎖定畫面卡片上方的 App 名稱（依介面語言：社交定錨／Phubbing Anchor）
    }
}
