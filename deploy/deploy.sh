#!/bin/bash
# 在 EC2 上更新並重啟後端。用法：sudo bash deploy/deploy.sh [branch] [verified-commit]
# GitHub Actions 透過 SSM Run Command 呼叫；第一次開機由 ec2-user-data.sh 呼叫。
set -euo pipefail
REGION=ap-northeast-1
APP_DIR=/opt/phubbing/app
BRANCH="${1:-main}"
REVISION="${2:-}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
REVISION="${REVISION:-$(git rev-parse "origin/$BRANCH")}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit" >&2; exit 1; }
git merge-base --is-ancestor "$REVISION" "origin/$BRANCH"
git diff --quiet && git diff --cached --quiet || { echo "Tracked deployment files are dirty" >&2; exit 1; }
git checkout --detach "$REVISION"

# SSM 參數沒設就不寫那一行（空字串會蓋掉程式裡的預設值）
param() {
  local v
  v=$(aws ssm get-parameter --region $REGION --with-decryption --name "/phubbing/$1" --query Parameter.Value --output text 2>/dev/null) || return 0
  echo "$1=$v"
}
{
  echo "AWS_REGION=$REGION"
  echo "APP_COMMIT=$REVISION"
  param VAPID_PRIVATE_KEY
  param DASHSCOPE_API_KEY
  param ALLOWED_ORIGINS
} > /opt/phubbing/backend.env
chmod 600 /opt/phubbing/backend.env

cd deploy
docker compose up -d --build
docker image prune -f
