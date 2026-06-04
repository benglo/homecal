import os, subprocess, logging
from typing import Iterator
import numpy as np

log = logging.getLogger("homecal_voice.mic")
SAMPLE_RATE = 16000
FRAME_MS = 80
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000   # 1280
FRAME_BYTES = FRAME_SAMPLES * 2                  # int16

class MicStream:
    """Run `pw-record` as a subprocess and yield int16 PCM frames @ 16kHz mono.

    Avoids PortAudio/sounddevice on PipeWire (feasibility-tested: scipy resample
    in sounddevice callback caused input overflow on Pi 5)."""

    def __init__(self, device: str = "default"):
        self.device = device
        self._proc: subprocess.Popen | None = None

    def start(self) -> None:
        # R14 — `--target` is unreliable across pw-record versions; rely on the
        # PipeWire default source. Override via env var `PIPEWIRE_NODE=<name>`.
        cmd = [
            "pw-record",
            "--rate", str(SAMPLE_RATE),
            "--channels", "1",
            "--format=s16",
            "-",
        ]
        env = os.environ.copy()
        if self.device and self.device != "default":
            env["PIPEWIRE_NODE"] = self.device
        log.info("starting %s (PIPEWIRE_NODE=%s)", " ".join(cmd), env.get("PIPEWIRE_NODE", "<default>"))
        self._proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)

    def stop(self) -> None:
        if self._proc:
            self._proc.terminate()
            try: self._proc.wait(timeout=2)
            except subprocess.TimeoutExpired: self._proc.kill()
            self._proc = None

    def frames(self) -> Iterator[np.ndarray]:
        assert self._proc and self._proc.stdout, "call start() first"
        while True:
            buf = self._proc.stdout.read(FRAME_BYTES)
            if not buf or len(buf) < FRAME_BYTES:
                if self._proc.poll() is not None:
                    log.warning("pw-record exited rc=%s", self._proc.returncode)
                    return
                continue
            yield np.frombuffer(buf, dtype=np.int16)
