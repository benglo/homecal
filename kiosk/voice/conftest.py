import numpy as np, pytest

@pytest.fixture
def silence_frame():
    from homecal_voice.mic import FRAME_SAMPLES
    return np.zeros(FRAME_SAMPLES, dtype=np.int16)

@pytest.fixture
def loud_frame():
    from homecal_voice.mic import FRAME_SAMPLES
    return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)
