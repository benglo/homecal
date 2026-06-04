import logging, subprocess, tempfile, requests
log = logging.getLogger("homecal_voice.tts")

def synthesize(text: str, *, model: str, api_key: str, timeout_s: int = 15) -> bytes:
    r = requests.post(
        "https://openrouter.ai/api/v1/audio/speech",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "input": text, "voice": "default"},
        timeout=timeout_s,
    )
    r.raise_for_status()
    return r.content

def speak(text: str, *, model: str, api_key: str, muted: bool = False) -> None:
    if muted:
        log.info("muted; skipping TTS: %r", text)
        return
    try:
        audio = synthesize(text, model=model, api_key=api_key)
    except Exception as e:
        log.warning("TTS failed: %s", e)
        return
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(audio); path = f.name
    subprocess.run(["aplay", "-q", path], check=False)
