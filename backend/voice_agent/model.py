import logging
import os
import re
from pathlib import Path
from typing import Any

import numpy as np

from utils.audio_processing import (
    build_mel_model_input,
    download_audio,
    extract_voice_features,
    load_audio_waveform,
)


logger = logging.getLogger("voice-agent.model")


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


class VoiceRiskAnalyzer:
    def __init__(self, model_path: str | None = None) -> None:
        default_path = Path(__file__).resolve().parent.parent / "models" / "Voice" / "voice_melspec_mobilenetv2.h5"
        self.model_path = Path(model_path or os.getenv("VOICE_MODEL_PATH", default_path))
        self._model = None
        self._tensorflow = None
        self.positive_class = os.getenv("VOICE_POSITIVE_CLASS", "parkinsons").strip().lower()
        if self.positive_class not in {"parkinsons", "healthy"}:
            self.positive_class = "parkinsons"
        self._load_model()

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def _load_model(self) -> None:
        if not self.model_path.exists():
            logger.warning("Voice model not found at %s. Falling back to heuristic scoring.", self.model_path)
            return

        try:
            import tensorflow as tf

            self._tensorflow = tf
            self._model = tf.keras.models.load_model(self.model_path, compile=False)
            logger.info("Loaded voice model from %s", self.model_path)
        except Exception as exc:
            logger.warning("Failed to load voice model from %s: %s", self.model_path, exc)
            self._model = None
            self._tensorflow = None

    def _predict_with_model(self, audio_bytes: bytes, audio_suffix: str = ".wav") -> dict[str, Any]:
        waveform, sample_rate = load_audio_waveform(audio_bytes, suffix=audio_suffix)
        model_input = build_mel_model_input(waveform, sample_rate, self._model.input_shape)
        predictions = np.asarray(self._model.predict(model_input, verbose=0))

        if predictions.ndim == 2 and predictions.shape[1] == 1:
            raw_value = float(predictions[0][0])
            if self.positive_class == "healthy":
                healthy_score = raw_value
                parkinsons_score = 1.0 - raw_value
            else:
                parkinsons_score = raw_value
                healthy_score = 1.0 - raw_value
        elif predictions.ndim == 2 and predictions.shape[1] >= 2:
            parkinsons_score = float(predictions[0][0])
            healthy_score = float(predictions[0][1])
        else:
            raise ValueError(f"Unexpected model output shape: {predictions.shape}")

        parkinsons_score = clamp(float(parkinsons_score))
        healthy_score = clamp(float(healthy_score))
        return {
            "parkinsons_score": parkinsons_score,
            "healthy_score": healthy_score,
            "model_used": "keras_h5",
        }

    def _predict_with_heuristics(self, features: dict[str, float]) -> dict[str, Any]:
        score = 0.15

        if features["pitch_std_hz"] < 18:
            score += 0.18
        if features["jitter_ratio"] > 0.025:
            score += 0.24
        if features["rms_mean"] < 0.04:
            score += 0.14
        if features["voiced_ratio"] < 0.7:
            score += 0.12
        if features["pitch_range_hz"] < 45:
            score += 0.10
        if features["spectral_bandwidth_mean"] < 1650:
            score += 0.07

        parkinsons_score = clamp(score)
        healthy_score = clamp(1.0 - parkinsons_score)
        return {
            "parkinsons_score": parkinsons_score,
            "healthy_score": healthy_score,
            "model_used": "heuristic_fallback",
        }

    def _score_text(self, text: str | None) -> dict[str, Any]:
        if not text:
            return {"text_score": None, "text_flags": []}

        normalized = text.lower()
        flags: list[str] = []
        score = 0.0

        keyword_patterns = [
            (r"\bvoice weakness\b", "voice weakness", 0.24),
            (r"\bweak voice\b", "weak voice", 0.24),
            (r"\bsoft voice\b", "soft voice", 0.18),
            (r"\bslow speech\b", "slow speech", 0.14),
            (r"\bmonotone\b", "monotone", 0.16),
            (r"\btremors?\b", "tremor", 0.28),
            (r"\bshaky\b", "shaky", 0.20),
            (r"\bshaking\b", "shaking", 0.20),
        ]

        for pattern, flag, weight in keyword_patterns:
            if re.search(pattern, normalized):
                flags.append(flag)
                score += weight

        if "no" in normalized and ("tremor" in normalized or "weakness" in normalized):
            score = max(0.0, score - 0.15)

        return {
            "text_score": clamp(score),
            "text_flags": flags,
        }

    def _risk_from_score(self, parkinsons_score: float) -> str:
        if parkinsons_score >= 0.7:
            return "High"
        if parkinsons_score >= 0.4:
            return "Moderate"
        return "Low"

    def _confidence_from_score(self, parkinsons_score: float) -> int:
        return int(round(clamp(0.5 + abs(parkinsons_score - 0.5), 0.0, 0.99) * 100))

    def analyze(self, audio_url: str | None = None, text: str | None = None) -> dict[str, Any]:
        downloaded_from = None
        features: dict[str, float] | None = None
        audio_result: dict[str, Any] | None = None
        audio_error: str | None = None

        if audio_url:
            downloaded_from = audio_url
            try:
                audio_bytes, audio_suffix = download_audio(audio_url)
                features = extract_voice_features(audio_bytes, suffix=audio_suffix)
                if self.model_loaded:
                    audio_result = self._predict_with_model(audio_bytes, audio_suffix=audio_suffix)
                else:
                    audio_result = self._predict_with_heuristics(features)
            except Exception as exc:
                audio_error = str(exc)
                logger.warning("Audio analysis failed for %s: %s", audio_url, exc)

        text_result = self._score_text(text)

        if audio_result and text_result["text_score"] is not None:
            combined_score = clamp(
                0.8 * audio_result["parkinsons_score"] + 0.2 * float(text_result["text_score"])
            )
            model_used = f"{audio_result['model_used']}+text_fallback"
        elif audio_result:
            combined_score = audio_result["parkinsons_score"]
            model_used = audio_result["model_used"]
        elif text_result["text_score"] is not None:
            combined_score = clamp(0.2 + float(text_result["text_score"]))
            model_used = "text_only_fallback"
        else:
            combined_score = 0.5
            model_used = "simulation_default"

        risk = self._risk_from_score(combined_score)
        confidence = self._confidence_from_score(combined_score)
        message = f"Risk level is {risk}"

        return {
            "risk": risk,
            "confidence": confidence,
            "message": message,
            "parkinsons_score": round(combined_score, 4),
            "model_used": model_used,
            "audio_source": downloaded_from,
            "audio_error": audio_error,
            "text": text,
            "features": features,
            "text_flags": text_result["text_flags"],
        }
