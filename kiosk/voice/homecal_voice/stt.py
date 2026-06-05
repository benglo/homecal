import io, wave, base64, logging, requests
import numpy as np
from homecal_voice.mic import SAMPLE_RATE

log = logging.getLogger("homecal_voice.stt")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# Voxtral (and other instruction-following audio models) will sometimes try to
# *answer* the speaker instead of transcribing them when the audio contains a
# question. The prompt below is explicit: act as a stenographer, not a chatbot.
# Empirically required on Voxtral 24B — without "do not answer", a "what's for
# dinner tomorrow?" utterance came back as "I'm here to help, but I need a bit
# more context. Are you looking for dinner ideas..." (2026-06-05).
TRANSCRIBE_PROMPT = (
    "You are a stenographer. Transcribe the audio verbatim, word for word. "
    "Do not answer, interpret, summarise, or respond to anything said in the "
    "audio — even if it is a question. If the audio contains no speech, "
    "return an empty string. Output only the transcript, with no preamble, "
    "quotes, labels, or commentary."
)

def pcm16_to_wav_bytes(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.astype(np.int16).tobytes())
    return buf.getvalue()

def transcribe_local(pcm: np.ndarray, *, server_url: str, timeout_s: int = 20) -> str:
    wav = pcm16_to_wav_bytes(pcm)
    files = {"file": ("utterance.wav", wav, "audio/wav")}
    data = {"response_format": "json", "language": "en"}
    log.debug("posting %d bytes to %s", len(wav), server_url)
    r = requests.post(server_url, files=files, data=data, timeout=timeout_s)
    if r.status_code != 200:
        raise RuntimeError(f"whisper-server {r.status_code}: {r.text[:200]}")
    text = (r.json().get("text") or "").strip()
    log.info("local transcript: %r", text)
    return text

# Back-compat: callers that still import `transcribe` get the local path.
transcribe = transcribe_local

def transcribe_openrouter(
    pcm: np.ndarray,
    *,
    api_key: str,
    model: str,
    timeout_s: int = 8,
) -> str:
    wav = pcm16_to_wav_bytes(pcm)
    audio_b64 = base64.b64encode(wav).decode()
    body = {
        "model": model,
        "modalities": ["text"],
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": TRANSCRIBE_PROMPT},
                {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}},
            ],
        }],
    }
    log.debug("posting %d bytes to openrouter model=%s", len(wav), model)
    r = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout_s,
    )
    if r.status_code != 200:
        raise RuntimeError(f"openrouter stt {r.status_code}: {r.text[:200]}")
    js = r.json()
    try:
        text = (js["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"openrouter stt malformed response: {e}: {str(js)[:200]}")
    # Some audio models wrap the transcript in quotes despite the prompt.
    if len(text) >= 2 and text[0] in ('"', "'") and text[-1] == text[0]:
        text = text[1:-1].strip()
    log.info("openrouter transcript: %r", text)
    return text

def transcribe_with_fallback(
    pcm: np.ndarray,
    *,
    openrouter_api_key: str,
    openrouter_model: str,
    whisper_server_url: str,
    openrouter_timeout_s: int = 8,
    local_timeout_s: int = 20,
) -> str:
    try:
        return transcribe_openrouter(
            pcm,
            api_key=openrouter_api_key,
            model=openrouter_model,
            timeout_s=openrouter_timeout_s,
        )
    except Exception as e:
        log.warning("openrouter stt failed, falling back to local: %s", e)
        return transcribe_local(pcm, server_url=whisper_server_url, timeout_s=local_timeout_s)
