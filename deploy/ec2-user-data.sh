#!/bin/bash
# EC2 第一次開機時執行：裝 Docker、抓程式碼、從 SSM 讀密鑰、啟動後端。
# 之後更新程式只要跑 /opt/phubbing/deploy.sh（GitHub Actions 透過 SSM 呼叫）。
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

cat > /opt/phubbing/deploy.sh <<'DEPLOY'
#!/bin/bash
set -euo pipefail
REGION=ap-northeast-1
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
cd /opt/phubbing/app
git pull --ff-only
cd deploy
docker compose up -d --build
docker image prune -f
DEPLOY
chmod +x /opt/phubbing/deploy.sh
/opt/phubbing/deploy.sh
