#!/bin/bash
# EC2 第一次開機時執行：裝 Docker、抓程式碼、從 SSM 讀密鑰、啟動後端。
# 之後更新程式跑 deploy/deploy.sh（GitHub Actions 透過 SSM 呼叫）。
set -euxo pipefail
BRANCH="${BRANCH:-aws-migration}"
REGION=ap-northeast-1

fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

dnf install -y docker git
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sSL "https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker

mkdir -p /opt/phubbing
git clone --branch "$BRANCH" https://github.com/jxuan083/Graduation-Project.git /opt/phubbing/app

# DOMAIN 由啟動指令帶入（Elastic IP 對應的 <ip>.sslip.io），沒帶就用目前的 public IP
if [ -z "${DOMAIN:-}" ]; then
  TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
  PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
echo "DOMAIN=$DOMAIN" > /opt/phubbing/app/deploy/.env

bash /opt/phubbing/app/deploy/deploy.sh "$BRANCH"
