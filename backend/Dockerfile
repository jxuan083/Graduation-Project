# base image 釘死 digest（= python:3.11-slim @ 2026-07-16）。
# 理由：浮動 tag 一旦被上游更新，base layer digest 就變，其上所有層（含 pip
# install torch/whisperx）全部 cache 失效，build 會從 3 分鐘暴增到 10 分鐘以上。
# 與 requirements.txt 同樣採「主動更新」策略：要升版時自己換 digest 並驗證。
# 查目前 digest：
#   curl -s https://hub.docker.com/v2/repositories/library/python/tags/3.11-slim | jq -r .digest
FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93
# v3 — 移除 face_swap/dlib，前端改本機貼紙濾鏡；只留 whisper 需要的 ffmpeg

# ffmpeg 給 whisper / whisperx 用
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
