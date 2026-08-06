#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-graduation-6ae65}"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-$FIREBASE_PROJECT_ID}"
export FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-graduation-6ae65.firebasestorage.app}"
export BACKEND_PORT="${BACKEND_PORT:-8080}"
export PORT="${PORT:-$BACKEND_PORT}"
export FIREBASE_HOSTING_PORT="${FIREBASE_HOSTING_PORT:-5002}"
export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:9099}"
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8081}"
export FIREBASE_STORAGE_EMULATOR_HOST="${FIREBASE_STORAGE_EMULATOR_HOST:-127.0.0.1:9199}"
export STORAGE_EMULATOR_HOST="${STORAGE_EMULATOR_HOST:-http://127.0.0.1:9199}"
# 同網段手機要能連進來，所以把本機 LAN IP 也加進 CORS 白名單。
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
LAN_ORIGINS=""
if [[ -n "$LAN_IP" ]]; then
  LAN_ORIGINS=",http://${LAN_IP}:${FIREBASE_HOSTING_PORT},http://${LAN_IP}:5173,http://${LAN_IP}:3000"
fi

# Capacitor 原生殼的 webview 從 scheme://localhost 載入，Origin 不帶 port，
# 跟上面那些帶 port 的是不同字串，必須另外列（漏了的症狀是預檢 400、畫面無錯誤訊息）。
NATIVE_ORIGINS="capacitor://localhost,http://localhost,https://localhost"

export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:${FIREBASE_HOSTING_PORT},http://127.0.0.1:${FIREBASE_HOSTING_PORT},http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,${NATIVE_ORIGINS}${LAN_ORIGINS}}"
EMULATOR_DATA_DIR="${EMULATOR_DATA_DIR:-.emulator-data}"
RUNNING_PIDS=()

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r backend/requirements-core.txt

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI is required: npm install -g firebase-tools" >&2
  exit 1
fi

if ! java -version >/dev/null 2>&1; then
  for candidate in /opt/homebrew/opt/openjdk/bin/java /opt/homebrew/opt/openjdk@21/bin/java /usr/local/opt/openjdk/bin/java /usr/local/opt/openjdk@21/bin/java; do
    if [[ -x "$candidate" ]]; then
      export JAVA_HOME="$(cd "$(dirname "$candidate")/.." && pwd)"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

if ! java -version >/dev/null 2>&1; then
  echo "Java runtime is required for Firebase emulators. On macOS: brew install openjdk" >&2
  exit 1
fi

cleanup() {
  # macOS 內建 bash 3.2：在 set -u 下展開空陣列會是 unbound variable，
  # 早期 exit（缺 java、缺 firebase CLI）時會蓋掉真正的錯誤訊息。
  if (( ${#RUNNING_PIDS[@]} > 0 )); then
    for pid in "${RUNNING_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi

  # emulator 收到訊號後才開始把資料寫進 --export-on-exit 目錄。
  # 這裡不等的話 shell 會先結束，匯出寫到一半就被截斷，
  # 下次啟動資料靜默消失且不會有任何錯誤訊息。
  if [[ -n "${firebase_pid:-}" ]]; then
    local waited=0
    while kill -0 "$firebase_pid" 2>/dev/null && (( waited < 30 )); do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$firebase_pid" 2>/dev/null; then
      echo "Emulator export did not finish within 30s; forcing shutdown." >&2
      kill -9 "$firebase_pid" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$EMULATOR_DATA_DIR"
emulator_args=(
  emulators:start
  --only auth,firestore,storage,hosting
  --project "$FIREBASE_PROJECT_ID"
  --export-on-exit "$EMULATOR_DATA_DIR"
)

if [[ -f "$EMULATOR_DATA_DIR/firebase-export-metadata.json" ]]; then
  emulator_args+=(--import "$EMULATOR_DATA_DIR")
else
  echo "No emulator export found in $EMULATOR_DATA_DIR; starting with empty local emulator data."
fi

firebase "${emulator_args[@]}" &
firebase_pid="$!"
RUNNING_PIDS+=("$firebase_pid")
(
  cd backend
  "../.venv/bin/python" -m uvicorn main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT"
) &
backend_pid="$!"
RUNNING_PIDS+=("$backend_pid")

echo "Frontend: http://127.0.0.1:${FIREBASE_HOSTING_PORT}"
echo "Backend:  http://127.0.0.1:${BACKEND_PORT}"
echo "Health:   http://127.0.0.1:${BACKEND_PORT}/api/health"
echo "Emulator data: ${EMULATOR_DATA_DIR}"
if [[ -n "$LAN_IP" ]]; then
  echo ""
  echo "手機（同一個 WiFi）請開: http://${LAN_IP}:${FIREBASE_HOSTING_PORT}"
fi

sleep 3
for pid in "${RUNNING_PIDS[@]}"; do
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" || true
    echo "A local dev service exited during startup; see logs above." >&2
    exit 1
  fi
done

wait
