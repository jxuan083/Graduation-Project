#!/usr/bin/env bash
# ============================================================
# 一鍵設定 Workload Identity Federation (GitHub Actions -> GCP)
# 跑一次就好，之後 CI/CD 會自動用這個身份部署
# ============================================================

set -euo pipefail

PROJECT_ID="graduation-6ae65"
GITHUB_REPO="jxuan083/Graduation-Project"
SA_NAME="github-actions-deploy"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

echo "=== 設定 GCP 專案: $PROJECT_ID ==="
gcloud config set project "$PROJECT_ID"

# 1. 啟用必要 API
echo "=== 啟用 API ==="
gcloud services enable \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firebasehosting.googleapis.com

# 2. 建立 Service Account
echo "=== 建立 Service Account ==="
gcloud iam service-accounts describe "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" 2>/dev/null || \
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GitHub Actions Deploy"

SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# 3. 授權 Service Account
echo "=== 授權 Service Account ==="
for ROLE in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/storage.admin \
  roles/firebasehosting.admin \
  roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --condition=None \
    --quiet 2>/dev/null
done

# 4. 建立 Workload Identity Pool
echo "=== 建立 Workload Identity Pool ==="
gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location="global" --format="value(name)" 2>/dev/null || \
gcloud iam workload-identity-pools create "$POOL_NAME" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# 5. 建立 GitHub OIDC Provider
echo "=== 建立 OIDC Provider ==="
gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location="global" --format="value(name)" 2>/dev/null || \
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location="global" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO'"

# 6. 允許 GitHub repo 扮演 Service Account
echo "=== 綁定 WIF -> Service Account ==="
POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location="global" --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$GITHUB_REPO" \
  --quiet

# 7. 取得 Provider 全名
WIF_PROVIDER=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location="global" \
  --format="value(name)")

echo ""
echo "============================================================"
echo "  設定完成! 請到 GitHub repo Settings > Secrets 新增："
echo "============================================================"
echo ""
echo "  WIF_PROVIDER = $WIF_PROVIDER"
echo "  GCP_SA_EMAIL = $SA_EMAIL"
echo ""
echo "============================================================"
