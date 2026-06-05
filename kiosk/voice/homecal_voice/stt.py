import io, wave, logging, requests
import numpy as np
from homecal_voice.mic import SAMPLE_RATE

log = logging.getLogger("homecal_voice.stt")

def pcm16_to_wav_bytes(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.astype(np.int16).tobytes())
    return buf.getvalue()

def transcribe(pcm: np.ndarray, *, server_url: str, timeout_s: int = 20) -> str:
    wav = pcm16_to_wav_bytes(pcm)
    files = {"file": ("utterance.wav", wav, "audio/wav")}
    data = {"response_format": "json", "language": "en"}
    log.debug("posting %d bytes to %s", len(wav), server_url)
    r = requests.post(server_url, files=files, data=data, timeout=timeout_s)
    if r.status_code != 200:
        raise RuntimeError(f"whisper-server {r.status_code}: {r.text[:200]}")
    js = r.json()
    text = (js.get("text") or "").strip()
    log.info("transcript: %r", text)
    return text
