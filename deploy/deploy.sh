#!/bin/bash
# 在 EC2 上更新並重啟後端。用法：sudo bash deploy/deploy.sh [branch]
# GitHub Actions 透過 SSM Run Command 呼叫；第一次開機由 ec2-user-data.sh 呼叫。
set -euo pipefail
REGION=ap-northeast-1
APP_DIR=/opt/phubbing/app
BRANCH="${1:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout -f -B "$BRANCH" "origin/$BRANCH"

# SSM 參數沒設就不寫那一行（空字串會蓋掉程式裡的預設值）
param() {
  local v
  v=$(aws ssm get-parameter --region $REGION --with-decryption --name "/phubbing/$1" --query Parameter.Value --output text 2>/dev/null) || return 0
  echo "$1=$v"
}
{
  echo "AWS_REGION=$REGION"
  param VAPID_PRIVATE_KEY
  param DASHSCOPE_API_KEY
  param ALLOWED_ORIGINS
} > /opt/phubbing/backend.env
chmod 600 /opt/phubbing/backend.env

cd deploy
docker compose up -d --build
docker image prune -f
