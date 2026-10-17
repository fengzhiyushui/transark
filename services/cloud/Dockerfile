# TransArk 云端服务（方案 A）
#
# 多阶段构建：只把运行期依赖装入最终镜像，模型权重不进镜像
# （faster-whisper 首次转写时按需下载到挂载卷 / HF 缓存）。
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY services/local /build/services/local
COPY services/cloud /build/services/cloud

RUN pip install --no-cache-dir --prefix=/install \
    ./services/local \
    ./services/cloud \
    && pip install --no-cache-dir --prefix=/install "faster-whisper>=1.0" "redis>=5.0"


FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLOUD_HOST=0.0.0.0 \
    CLOUD_PORT=8780 \
    HF_HOME=/models/hf

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 transark

COPY --from=builder /install /usr/local

RUN mkdir -p /models /data && chown -R transark:transark /models /data

USER transark
EXPOSE 8780

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8780/health', timeout=3)"

CMD ["python", "-m", "cloud_service"]
