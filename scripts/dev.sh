#!/usr/bin/env bash
# 本機開發：後端 uvicorn（:8080）+ 前端靜態伺服器（:5002）。
# 預設連 AWS 上的 DynamoDB / S3 / Cognito（先跑 `aws login`）；
# 只想離線看畫面可用 DOCSTORE=memory ./scripts/dev.sh（資料只存在記憶體）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for envfile in .env backend/.env; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

export AWS_REGION="${AWS_REGION:-ap-northeast-1}"
export BACKEND_PORT="${BACKEND_PORT:-8080}"
export FRONTEND_PORT="${FRONTEND_PORT:-5002}"
# 同網段手機要能連進來，所以把本機 LAN IP 也加進 CORS 白名單。
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
LAN_ORIGINS=""
if [[ -n "$LAN_IP" ]]; then
  LAN_ORIGINS=",http://${LAN_IP}:${FRONTEND_PORT}"
fi
# Capacitor 原生殼的 webview 從 scheme://localhost 載入，Origin 不帶 port，必須另外列。
NATIVE_ORIGINS="capacitor://localhost,http://localhost,https://localhost"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT},${NATIVE_ORIGINS}${LAN_ORIGINS}}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
PY=".venv/bin/python"
[[ -x "$PY" ]] || PY=".venv/Scripts/python"   # Windows venv
"$PY" -m pip install -q -r backend/requirements-core.txt "botocore[crt]"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && "../$PY" -m uvicorn main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT") &
"$PY" -m http.server "$FRONTEND_PORT" --bind 0.0.0.0 --directory frontend &

echo "前端：http://localhost:${FRONTEND_PORT}"
[[ -n "$LAN_IP" ]] && echo "手機（同 WiFi）：http://${LAN_IP}:${FRONTEND_PORT}"
echo "後端：http://localhost:${BACKEND_PORT}/api/health"
wait
