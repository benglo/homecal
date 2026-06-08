# Convenience targets for the kokoro-tts sidecar.
# `pull-models` is idempotent — skips files already present.

MODEL_BASE := https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
MODELS_DIR := models

.PHONY: pull-models
pull-models:
	@mkdir -p $(MODELS_DIR)
	@for f in kokoro-v1.0.fp16.onnx voices-v1.0.bin; do \
		if [ -f $(MODELS_DIR)/$$f ]; then \
			echo "$$f already present"; \
		else \
			echo "downloading $$f..."; \
			curl -fsSL -o $(MODELS_DIR)/$$f $(MODEL_BASE)/$$f; \
		fi; \
	done
	@ls -lh $(MODELS_DIR)
