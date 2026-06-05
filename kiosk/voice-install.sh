#!/bin/bash
# kiosk/voice-install.sh — run on the Pi
set -euo pipefail
sudo apt-get update -qq
# Trixie ships python3.13 only; we use silero ONNX path so torch isn't pulled.
# pipewire is already running on the kiosk Pi but install pipewire-pulse if needed.
sudo apt-get install -y python3 python3-venv python3-dev pipewire-pulse sox curl \
                        build-essential cmake git rsync \
                        mpg123  # MP3 player for TTS playback; aplay is PCM-only and silently fails on MP3

# 1. Python service
DEST="$HOME/homecal-voice"
mkdir -p "$DEST"
rsync -a --exclude .venv --exclude __pycache__ kiosk/voice/ "$DEST/"
cd "$DEST"
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip wheel
pip install -e .
deactivate

# Vendor the silero VAD ONNX model directly (the silero-vad pypi package's
# __init__ imports torch transitively, even with --no-deps installed). The
# model file is ~1.8 MB and is loaded by endpointer.py via onnxruntime alone.
if [ ! -f "$DEST/silero_vad.onnx" ]; then
  curl -fsSL -o "$DEST/silero_vad.onnx" \
    https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
fi
echo "silero_vad.onnx: $(ls -la $DEST/silero_vad.onnx)"

# 2. whisper.cpp built locally (Bookworm/trixie may not package it).
WCPP="$HOME/whisper.cpp"
if [ ! -d "$WCPP" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WCPP"
fi
(
  cd "$WCPP"
  cmake -B build -DGGML_NATIVE=ON -DWHISPER_BUILD_SERVER=ON
  # Modern whisper.cpp renamed `quantize` -> `whisper-quantize`.
  cmake --build build -j --config Release --target whisper-server whisper-quantize
)
( cd "$WCPP" && ./models/download-ggml-model.sh base.en )
( cd "$WCPP" && ./build/bin/whisper-quantize models/ggml-base.en.bin models/ggml-base.en-q5_1.bin q5_1 )

# 3. systemd units
sudo cp kiosk/homecal-voice.service /etc/systemd/system/
sudo tee /etc/systemd/system/whisper-server.service > /dev/null <<UNIT
[Unit]
Description=whisper.cpp HTTP server
After=network-online.target
[Service]
Type=simple
User=hbadmin
ExecStart=$HOME/whisper.cpp/build/bin/whisper-server -m $HOME/whisper.cpp/models/ggml-base.en-q5_1.bin -t 4 -l en --host 127.0.0.1 --port 8080
Restart=always
[Install]
WantedBy=default.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now whisper-server   # no env needed for whisper

# homecal-voice needs /etc/homecal-voice.env populated first; only enable here.
sudo systemctl enable homecal-voice

# 4. confirm whisper is up (homecal-voice will be inactive until env populated + started)
sleep 3
systemctl status whisper-server --no-pager -l | head -5

echo
echo "================================================================"
echo "Next step: populate /etc/homecal-voice.env then start the service:"
echo "  sudo nano /etc/homecal-voice.env"
echo "  sudo systemctl start homecal-voice"
echo "  journalctl -u homecal-voice -f"
echo "================================================================"
echo "Template for /etc/homecal-voice.env:"
cat <<'ENV'
OPENROUTER_API_KEY=sk-or-...
HOMECAL_API_BASE=http://192.168.1.94:8787
PI_API_TOKEN=...
WAKE_WORD=hey_mycroft
WHISPER_MODEL=base.en-q5_1
WHISPER_SERVER_URL=http://127.0.0.1:8080/inference
INTENT_MODEL=anthropic/claude-haiku-4.5
TTS_MODEL=google/gemini-3.1-flash-tts-preview
DAILY_REQUEST_CAP=200
AUDIO_DEVICE=default
ENV
