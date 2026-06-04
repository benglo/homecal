#!/bin/bash
# kiosk/voice-install.sh — run on the Pi
set -euo pipefail
sudo apt-get update -qq
# R15 — explicit python3.12 (trixie default is 3.13; torch wheels for 3.13 on
# aarch64 are unreliable). silero-vad ONNX path is torch-free so this is belt+braces.
sudo apt-get install -y python3.12 python3.12-venv pipewire-audio sox curl \
                        build-essential cmake git

# 1. Python service
DEST="$HOME/homecal-voice"
mkdir -p "$DEST"
rsync -a --exclude .venv --exclude __pycache__ kiosk/voice/ "$DEST/"
cd "$DEST"
python3.12 -m venv .venv
source .venv/bin/activate
pip install -U pip wheel
pip install -e .
deactivate

# 2. whisper.cpp built locally (Bookworm/trixie may not package it). R17.
WCPP="$HOME/whisper.cpp"
if [ ! -d "$WCPP" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WCPP"
fi
(
  cd "$WCPP"
  cmake -B build -DGGML_NATIVE=ON -DWHISPER_BUILD_SERVER=ON
  cmake --build build -j --config Release --target whisper-server quantize
)
( cd "$WCPP" && ./models/download-ggml-model.sh base.en )
( cd "$WCPP" && ./build/bin/quantize models/ggml-base.en.bin models/ggml-base.en-q5_1.bin q5_1 )

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
sudo systemctl enable --now whisper-server
sudo systemctl enable --now homecal-voice

# 4. confirm
sleep 3
systemctl status whisper-server --no-pager -l | head -5
systemctl status homecal-voice --no-pager -l | head -5
echo "Install complete. Remember to populate /etc/homecal-voice.env with:"
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
