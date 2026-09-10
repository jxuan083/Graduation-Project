#!/usr/bin/env bash
# run-sim.sh — 在 iOS 模擬器上跑 App,繞開 Xcode 那個常常 "Busy / preflight checks" 的 Run 流程。
#
# 用法:
#   bash scripts/run-sim.sh            # 用目前已開機(Booted)的模擬器
#   bash scripts/run-sim.sh <udid>     # 指定某台模擬器的 UDID
#
# 它做的事:cap copy(把最新前端同步進 app)→ build(免簽章)→ 重裝 → 啟動。
# 改了前端(CSS/JS)或原生程式後,跑這個就會看到最新版。
set -euo pipefail

BID="tw.edu.nccu.phubbinganchor"
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DD="$PROJ_DIR/ios/.build-sim"   # 本機 build 產物,已在 .gitignore

# 1. 選模擬器:參數優先 → 已開機的那台 → 都沒有就挑一台可用的 iPhone 開機
pick_booted() { xcrun simctl list devices booted 2>/dev/null | grep -oE '[0-9A-F-]{36}' | head -1 || true; }
pick_any_iphone() {
  xcrun simctl list devices available 2>/dev/null \
    | grep -iE 'iPhone' | grep -oE '[0-9A-F-]{36}' | head -1 || true
}

DEV="${1:-}"
[ -n "$DEV" ] || DEV="$(pick_booted)"
if [ -z "$DEV" ]; then
  DEV="$(pick_any_iphone)"
  [ -n "$DEV" ] || { echo "❌ 找不到任何可用的 iPhone 模擬器,請在 Xcode 安裝一個 iOS runtime。"; exit 1; }
  echo "▶ 沒有開機中的模擬器,幫你開: $DEV"
fi
echo "▶ 目標模擬器: $DEV"

# 2. 確保開機完成（已開機會直接通過）
xcrun simctl boot "$DEV" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1 || true

# 3. 把最新前端同步進 iOS app
echo "▶ cap copy…"
( cd "$PROJ_DIR" && npx cap copy ios >/dev/null )

# 4. build(模擬器不需簽章)
echo "▶ building…"
xcodebuild -project "$PROJ_DIR/ios/App/App.xcodeproj" -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=$DEV" \
  -derivedDataPath "$DD" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build >/dev/null

APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
[ -d "$APP" ] || { echo "❌ 找不到 build 產物: $APP"; exit 1; }

# 5. 重裝 + 啟動
echo "▶ 安裝 + 啟動…"
xcrun simctl uninstall "$DEV" "$BID" >/dev/null 2>&1 || true
xcrun simctl install "$DEV" "$APP"
xcrun simctl launch "$DEV" "$BID"
open -a Simulator
echo "✅ 完成。App 已在模擬器啟動。"
