FROM python:3.11-slim

# dlib 需要 cmake 和 C++ 編譯工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    libopenblas-dev \
    curl \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 下載 dlib 68 點模型（95MB）
RUN curl -L http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2 \
    -o /tmp/sp.dat.bz2 \
    && bunzip2 /tmp/sp.dat.bz2 \
    && mv /tmp/sp.dat /app/deepfake_pet/shape_predictor_68_face_landmarks.dat

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
