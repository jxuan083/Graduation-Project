FROM python:3.11-slim
# v2 — 模型改由 pip face_recognition_models 提供，移除 curl 下載

# dlib 需要 cmake 和 C++ 編譯工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    libopenblas-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 模型由 face_recognition_models pip 套件提供，不需要另外下載

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
