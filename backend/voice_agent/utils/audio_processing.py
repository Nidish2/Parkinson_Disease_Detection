import logging
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import librosa
import numpy as np
import requests


logger = logging.getLogger("voice-agent.audio")
DEFAULT_SAMPLE_RATE = int(os.getenv("VOICE_SAMPLE_RATE", "16000"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("AUDIO_DOWNLOAD_TIMEOUT", "20"))
TOP_DB = float(os.getenv("VOICE_TOP_DB", "80"))
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()


def _guess_suffix(audio_url: str) -> str:
    parsed = urlparse(audio_url)
    suffix = Path(parsed.path).suffix.lower()
    return suffix if suffix in {".wav", ".mp3", ".m4a", ".ogg", ".flac"} else ".wav"


def _suffix_from_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None
    normalized = content_type.lower()
    mapping = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/wave": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/ogg": ".ogg",
        "audio/flac": ".flac",
    }
    for mime_type, suffix in mapping.items():
        if mime_type in normalized:
            return suffix
    return None


def _twilio_auth_for_url(audio_url: str) -> tuple[str, str] | None:
    parsed = urlparse(audio_url)
    if "api.twilio.com" not in parsed.netloc:
        return None
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        return None
    return (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


def _normalize_twilio_recording_url(audio_url: str) -> str:
    parsed = urlparse(audio_url)
    if "api.twilio.com" not in parsed.netloc:
        return audio_url
    if Path(parsed.path).suffix.lower() in {".wav", ".mp3"}:
        return audio_url
    return f"{audio_url}.wav"


def download_audio(audio_url: str) -> tuple[bytes, str]:
    audio_url = _normalize_twilio_recording_url(audio_url)
    logger.info("Downloading audio from %s", audio_url)
    response = requests.get(
        audio_url,
        timeout=REQUEST_TIMEOUT_SECONDS,
        auth=_twilio_auth_for_url(audio_url),
    )
    response.raise_for_status()
    suffix = _suffix_from_content_type(response.headers.get("Content-Type")) or _guess_suffix(audio_url)
    return response.content, suffix


def load_audio_waveform(
    audio_bytes: bytes,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    suffix: str = ".wav",
) -> tuple[np.ndarray, int]:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
        temp_file.write(audio_bytes)
        temp_path = temp_file.name

    try:
        waveform, sr = librosa.load(temp_path, sr=sample_rate, mono=True)
        waveform, _ = librosa.effects.trim(waveform, top_db=35)
        if waveform.size == 0:
            raise ValueError("Audio appears to be empty after trimming silence.")
        peak = float(np.max(np.abs(waveform)))
        if peak <= 1e-6:
            raise ValueError("Audio is too quiet for analysis.")
        waveform = (waveform / peak).astype(np.float32)
        return waveform, sr
    finally:
        os.unlink(temp_path)


def _estimate_pitch(waveform: np.ndarray, sample_rate: int) -> np.ndarray:
    try:
        pitch_track = librosa.yin(waveform, fmin=70, fmax=400, sr=sample_rate)
        return pitch_track[np.isfinite(pitch_track)]
    except Exception:
        return np.array([], dtype=np.float32)


def _estimate_jitter(pitch_track: np.ndarray) -> float:
    if pitch_track.size < 3:
        return 0.0
    deltas = np.abs(np.diff(pitch_track))
    mean_pitch = float(np.mean(pitch_track)) or 1.0
    return float(np.mean(deltas) / mean_pitch)


def extract_voice_features(audio_bytes: bytes, suffix: str = ".wav") -> dict[str, float]:
    waveform, sample_rate = load_audio_waveform(audio_bytes, suffix=suffix)

    mfcc = librosa.feature.mfcc(y=waveform, sr=sample_rate, n_mfcc=13)
    spectral_centroid = librosa.feature.spectral_centroid(y=waveform, sr=sample_rate)
    spectral_bandwidth = librosa.feature.spectral_bandwidth(y=waveform, sr=sample_rate)
    rolloff = librosa.feature.spectral_rolloff(y=waveform, sr=sample_rate)
    zero_crossing_rate = librosa.feature.zero_crossing_rate(waveform)
    rms = librosa.feature.rms(y=waveform)

    pitch_track = _estimate_pitch(waveform, sample_rate)
    pitch_mean = float(np.mean(pitch_track)) if pitch_track.size else 0.0
    pitch_std = float(np.std(pitch_track)) if pitch_track.size else 0.0
    pitch_range = float(np.max(pitch_track) - np.min(pitch_track)) if pitch_track.size else 0.0
    total_frames = max(1, 1 + (len(waveform) // 512))
    voiced_ratio = float(pitch_track.size / total_frames)

    return {
        "duration_seconds": round(float(len(waveform) / sample_rate), 3),
        "pitch_mean_hz": round(pitch_mean, 3),
        "pitch_std_hz": round(pitch_std, 3),
        "pitch_range_hz": round(pitch_range, 3),
        "jitter_ratio": round(_estimate_jitter(pitch_track), 5),
        "voiced_ratio": round(voiced_ratio, 5),
        "mfcc_mean": round(float(np.mean(mfcc)), 5),
        "mfcc_std": round(float(np.std(mfcc)), 5),
        "spectral_centroid_mean": round(float(np.mean(spectral_centroid)), 5),
        "spectral_bandwidth_mean": round(float(np.mean(spectral_bandwidth)), 5),
        "rolloff_mean": round(float(np.mean(rolloff)), 5),
        "zcr_mean": round(float(np.mean(zero_crossing_rate)), 5),
        "rms_mean": round(float(np.mean(rms)), 5),
    }


def build_mel_model_input(
    waveform: np.ndarray,
    sample_rate: int,
    input_shape: tuple[int | None, ...],
) -> np.ndarray:
    target_height = 224
    target_width = 224
    target_channels = 3

    if len(input_shape) >= 4:
        if input_shape[1]:
            target_height = int(input_shape[1])
        if input_shape[2]:
            target_width = int(input_shape[2])
        if input_shape[3]:
            target_channels = int(input_shape[3])

    mel_spec = librosa.feature.melspectrogram(
        y=waveform,
        sr=sample_rate,
        n_mels=target_height,
        n_fft=2048,
        hop_length=512,
        fmin=0,
        fmax=sample_rate / 2,
        power=2.0,
    )
    mel_db = librosa.power_to_db(mel_spec, ref=np.max, top_db=TOP_DB)

    current_width = mel_db.shape[1]
    if current_width < target_width:
        pad_left = (target_width - current_width) // 2
        pad_right = target_width - current_width - pad_left
        mel_db = np.pad(
            mel_db,
            ((0, 0), (pad_left, pad_right)),
            mode="constant",
            constant_values=-TOP_DB,
        )
    elif current_width > target_width:
        start = (current_width - target_width) // 2
        mel_db = mel_db[:, start : start + target_width]

    mel_normalized = np.clip((mel_db + TOP_DB) / TOP_DB, 0.0, 1.0).astype(np.float32)

    if target_channels == 1:
        model_input = np.expand_dims(mel_normalized, axis=-1)
    else:
        model_input = np.stack([mel_normalized] * target_channels, axis=-1)
        model_input = (model_input * 2.0) - 1.0

    return np.expand_dims(model_input.astype(np.float32), axis=0)
