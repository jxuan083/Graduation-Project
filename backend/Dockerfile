FROM python:3.11-slim
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
