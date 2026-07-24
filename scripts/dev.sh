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
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:${FIREBASE_HOSTING_PORT},http://127.0.0.1:${FIREBASE_HOSTING_PORT},http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000}"

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
  local pids
  pids="$(jobs -p)"
  if [[ -n "$pids" ]]; then
    kill $pids
  fi
}
trap cleanup EXIT INT TERM

firebase emulators:start --only auth,firestore,storage,hosting --project "$FIREBASE_PROJECT_ID" &
(
  cd backend
  "../.venv/bin/python" -m uvicorn main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT"
) &

echo "Frontend: http://127.0.0.1:${FIREBASE_HOSTING_PORT}"
echo "Backend:  http://127.0.0.1:${BACKEND_PORT}"
echo "Health:   http://127.0.0.1:${BACKEND_PORT}/api/health"

wait
