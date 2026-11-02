import ActivityKit
import SwiftUI
import WidgetKit

/// 社交定錨的即時動態擴充功能：暫離倒數／跳出 App 的寬限倒數／帶出 App 點餐，顯示在靈動島與鎖定畫面。
/// 點餐（kind == "order"）刻意不顯示時間，避免造成壓力；10 分鐘後若系統重畫，換成「還在點餐嗎？」。
/// 資料格式見 App/AnchorCountdownAttributes.swift；開始、更新、結束都由 App 端的 LockStatePlugin 控制。
///
/// App 在背景時沒辦法更新畫面，所以「時間到」的變化盡量不靠重畫：
///   - 數字用 .timer 樣式：時間未到往下數，時間一過自己接著往上計。
///   - 進度環／進度條隨時間減少，時間到就變空。
///   - 確定超時時（App 在背景還能跑的那段時間內主動設 isOver，或系統標成過期 isStale 而重畫）
///     再換成紅色、加「+」、換成超時的文字。
@main
struct AnchorLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        AnchorCountdownLiveActivity()
    }
}

/// 配色沿用 App：橘色主按鈕、咖啡色文字、淡橘背景、超時用紅色。
private enum Palette {
    static let orange = Color(red: 224 / 255, green: 120 / 255, blue: 48 / 255)    // #e07830
    static let red = Color(red: 192 / 255, green: 57 / 255, blue: 43 / 255)        // #c0392b
    static let brown = Color(red: 79 / 255, green: 53 / 255, blue: 26 / 255)       // #4f351a
    static let cream = Color(red: 255 / 255, green: 212 / 255, blue: 181 / 255)    // #ffd4b5（App 背景）
}

private extension AnchorCountdownAttributes.ContentState {
    var isOrder: Bool { kind == "order" }
    var symbol: String {
        switch kind {
        case "break": return "iphone"
        case "order": return "fork.knife"
        default: return "exclamationmark"
        }
    }
    /// 進度範圍（開始時間晚於結束時間時保護一下，避免 ClosedRange 崩潰）
    var span: ClosedRange<Date> { min(startedAt, endsAt)...endsAt }
}

/// 計時數字：時間未到往下數，時間一過接著往上計；確定超時（isOver）時前面加「+」。
private struct CountdownText: View {
    let state: AnchorCountdownAttributes.ContentState
    let isOver: Bool

    var body: some View {
        // 「+」跟數字接成同一段文字，靠右對齊時才不會被拉開
        (Text(isOver ? "+" : "") + Text(state.endsAt, style: .timer))
            .monospacedDigit()
    }
}

/// 會隨倒數減少的進度環（可選擇中間放圖示）；時間到就變空。
private struct CountdownRing: View {
    let state: AnchorCountdownAttributes.ContentState
    let accent: Color
    let size: CGFloat
    var showsSymbol = true

    var body: some View {
        ZStack {
            ProgressView(timerInterval: state.span, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                .progressViewStyle(.circular)
                .tint(accent)
            if showsSymbol {
                Image(systemName: state.symbol)
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(accent)
            }
        }
        .frame(width: size, height: size)
    }
}

/// 點餐用的圖示方塊（點餐不顯示時間，所以用圖示代替進度環）。
private struct OrderBadge: View {
    let accent: Color
    let size: CGFloat

    var body: some View {
        Image(systemName: "fork.knife")
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(accent)
            .frame(width: size, height: size)
            .background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// App 的圖示（跟主畫面上的 App 圖示同一張）。
private struct AppLogo: View {
    let size: CGFloat

    var body: some View {
        Image("AppLogo")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
    }
}

struct AnchorCountdownLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AnchorCountdownAttributes.self) { context in
            // 鎖定畫面（以及沒有靈動島的機型的橫幅）
            let state = context.state
            let isOver = context.isStale || state.isOver
            let accent = isOver ? Palette.red : Palette.orange
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    AppLogo(size: 18)
                    Text(state.appName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.brown.opacity(0.55))
                }
                HStack(spacing: 14) {
                    if state.isOrder {
                        OrderBadge(accent: accent, size: 40)
                    } else {
                        CountdownRing(state: state, accent: accent, size: 40)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(isOver ? state.overTitle : state.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Palette.brown)
                        Text(isOver ? state.overHint : state.hint)
                            .font(.system(size: 12))
                            .foregroundStyle(Palette.brown.opacity(0.6))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    if !state.isOrder {
                        CountdownText(state: state, isOver: isOver)
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(accent)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 100, alignment: .trailing)
                    }
                }
                if !state.isOrder {
                    ProgressView(timerInterval: state.span, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                        .progressViewStyle(.linear)
                        .tint(accent)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 16)
            .activityBackgroundTint(Palette.cream)
            .activitySystemActionForegroundColor(Palette.brown)
        } dynamicIsland: { context in
            let state = context.state
            let isOver = context.isStale || state.isOver
            let accent = isOver ? Palette.red : Palette.orange
            return DynamicIsland {
                // 長按展開
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 10) {
                        AppLogo(size: 30)
                        Text(isOver ? state.overTitle : state.title)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }
                    .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if state.isOrder {
                        Image(systemName: "fork.knife")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(accent)
                            .padding(.trailing, 10)
                    } else {
                        CountdownText(state: state, isOver: isOver)
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(accent)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 96, alignment: .trailing)
                            .padding(.trailing, 6)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(isOver ? state.overHint : state.hint)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(2)
                        if !state.isOrder {
                            ProgressView(timerInterval: state.span, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                                .progressViewStyle(.linear)
                                .tint(accent)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                AppLogo(size: 22)
            } compactTrailing: {
                if state.isOrder {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(accent)
                } else {
                    HStack(spacing: 5) {
                        CountdownRing(state: state, accent: accent, size: 16, showsSymbol: false)
                        CountdownText(state: state, isOver: isOver)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(accent)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 48, alignment: .trailing)
                    }
                }
            } minimal: {
                if state.isOrder {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(accent)
                } else {
                    CountdownRing(state: state, accent: accent, size: 22)
                }
            }
            .keylineTint(accent)
        }
    }
}
