# Python 3.13 slim — kokoro-onnx supports 3.10-3.13 per upstream.
# Explicit linux/amd64 — see spec §3 item 3.
FROM --platform=linux/amd64 python:3.13-slim AS base

# espeak-ng is required by kokoro-onnx's phonemizer dependency.
# curl is here so a smoke check can hit /healthz during build if we ever want one.
RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached when only app code changes).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code + models + catalogs (catalogs come from a build context arg).
COPY app/ ./app/
COPY models/ ./models/

# Catalogs live in the parent repo; mount them at build time.
ARG CATALOGS_SRC=catalogs
COPY ${CATALOGS_SRC}/ ./catalogs/

# Build-time pre-render of noise + joke clips. Writes into ./cache/{noise,joke}/.
ENV PI_API_TOKEN=build-time-placeholder \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.fp16.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
    KOKORO_CATALOG_DIR=/app/cache
RUN python -m app.render_catalogs \
        --catalogs-dir /app/catalogs \
        --out-dir /app/cache \
    && ls -R /app/cache

EXPOSE 8789

# uvicorn runs the FastAPI app. Single worker — exactly one Pi, one
# request at a time (spec §3 item 6).
CMD ["uvicorn", "app.service:app", \
     "--host", "0.0.0.0", \
     "--port", "8789", \
     "--workers", "1", \
     "--log-level", "info"]
