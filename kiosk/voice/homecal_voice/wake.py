import logging, glob, os
from dataclasses import dataclass, field
from typing import Tuple
import numpy as np

log = logging.getLogger("homecal_voice.wake")

@dataclass
class WakeDetector:
    """openWakeWord-backed wake detector with trigger-level + refractory window.

    `wake_name` must be the versioned scoring key returned by Model.predict()
    (e.g. 'hey_mycroft_v0.1'), NOT the user-facing short name. With the wrong
    key, Model.predict() silently returns 0 for every frame and wake never
    fires. Use `load_default_model` to get both the Model and the correct key.
    """
    model: object
    wake_name: str
    threshold: float = 0.5
    trigger_level: int = 1
    refractory_frames: int = 25
    _activations: int = field(default=0, init=False)
    _refractory: int = field(default=0, init=False)

    def step(self, frame: np.ndarray) -> bool:
        if self._refractory > 0:
            self._refractory -= 1
            return False
        scores = self.model.predict(frame)
        s = float(scores.get(self.wake_name, 0.0))
        if s >= self.threshold:
            self._activations += 1
            if self._activations >= self.trigger_level:
                self._activations = 0
                self._refractory = self.refractory_frames
                log.info("WAKE fired (%s) score=%.3f", self.wake_name, s)
                return True
        else:
            self._activations = 0
        return False

def load_default_model(wake_name_prefix: str = "hey_mycroft") -> Tuple[object, str]:
    """Load an openWakeWord model and return (Model, scoring_key).

    `wake_name_prefix` is matched against the ONNX file basename; the scoring
    key is the basename without the .onnx suffix (e.g. 'hey_mycroft_v0.1').
    """
    import openwakeword
    from openwakeword.model import Model
    pkg = os.path.dirname(openwakeword.__file__)
    candidates = glob.glob(os.path.join(pkg, "resources", "models", "*.onnx"))
    matches = [p for p in candidates if wake_name_prefix in os.path.basename(p)]
    if not matches:
        raise RuntimeError(f"no oWW model on disk matches {wake_name_prefix!r}: {candidates}")
    scoring_key = os.path.splitext(os.path.basename(matches[0]))[0]
    return Model(wakeword_model_paths=matches), scoring_key
