#!/usr/bin/env python3
"""
Compute confusion matrices (and basic metrics) for spiral, wave, and voice models.

Expects labeled data in subfolders:
  <root>/healthy/   — true label 0 (Healthy)
  <root>/parkinsons/ — true label 1 (Parkinsons)

Prediction rules match backend_api.py (including inverted wave sigmoid semantics).

Usage:
  python evaluate_confusion_matrices.py --dataset-root ./eval_data --init-skeleton   # create empty folder tree, then add images/audio
  python evaluate_confusion_matrices.py --spiral-root ./data/spiral --wave-root ./data/wave --voice-root ./data/voice
  python evaluate_confusion_matrices.py --dataset-root ./eval_data   # expects eval_data/spiral|wave|voice/{healthy,parkinsons}/

Requires: tensorflow, numpy, pillow, opencv-python, librosa, soundfile, scikit-learn

Exit codes: 0 = at least one modality evaluated with samples; 1 = bad/missing dirs; 2 = dirs OK but no data files.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from typing import Iterable, List, Optional, Sequence, Tuple

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import tensorflow as tf
from PIL import Image

# -----------------------------------------------------------------------------
# Paths (same layout as backend_api.py)
# -----------------------------------------------------------------------------
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SPIRAL_MODEL_PATH_H5 = os.path.join(_BACKEND_DIR, "models", "spiral", "mobilenet_spiral_robust.h5")
WAVE_MODEL_PATH = os.path.join(_BACKEND_DIR, "models", "wave", "inception_wave_v2.h5")
VOICE_MODEL_PATH_H5 = os.path.join(_BACKEND_DIR, "models", "Voice", "voice_melspec_mobilenetv2.h5")

VOICE_SAMPLE_RATE = 22050
VOICE_NFFT = 2048
VOICE_HOP_LENGTH = 512
VOICE_TOP_DB = 80.0
VOICE_TRIM_TOP_DB = 45
VOICE_MIN_DURATION_SECONDS = 2.0
VOICE_POSITIVE_THRESHOLD = 0.65
VOICE_BORDERLINE_MARGIN = 0.12

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")
AUDIO_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".webm", ".m4a")


def _composite_with_white_bg(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").split()[-1]
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=alpha)
        return bg
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def preprocess_for_spiral(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes))
    img = _composite_with_white_bg(img)
    img = img.resize((224, 224), Image.LANCZOS)
    img_array = np.array(img, dtype=np.float32)
    mean_val = np.mean(img_array)
    if mean_val > 127:
        img_array = 255.0 - img_array
    img_array = (img_array / 127.5) - 1.0
    return np.expand_dims(img_array, axis=0)


def preprocess_for_wave(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes))
    img = _composite_with_white_bg(img)
    img = img.resize((224, 224), Image.LANCZOS)
    img_array = np.array(img, dtype=np.float32) / 255.0
    return np.expand_dims(img_array, axis=0)


def preprocess_for_voice(audio_bytes: bytes, model_input_shape: Optional[Tuple] = None) -> np.ndarray:
    import librosa

    audio_data, sr = librosa.load(io.BytesIO(audio_bytes), sr=VOICE_SAMPLE_RATE, mono=True)
    audio_data, _ = librosa.effects.trim(audio_data, top_db=VOICE_TRIM_TOP_DB)
    min_samples = int(sr * VOICE_MIN_DURATION_SECONDS)
    if len(audio_data) < min_samples:
        pad_amount = min_samples - len(audio_data)
        audio_data = np.pad(audio_data, (0, pad_amount), mode="constant")
    peak = float(np.max(np.abs(audio_data))) if len(audio_data) else 0.0
    if peak < 1e-4:
        raise ValueError("Voice sample is too quiet")
    audio_data = (audio_data / peak).astype(np.float32)

    target_height = 224
    target_width = 224
    target_channels = 3
    if model_input_shape and len(model_input_shape) >= 4:
        if model_input_shape[1] is not None:
            target_height = int(model_input_shape[1])
        if model_input_shape[2] is not None:
            target_width = int(model_input_shape[2])
        if model_input_shape[3] is not None:
            target_channels = int(model_input_shape[3])

    mel_spec = librosa.feature.melspectrogram(
        y=audio_data,
        sr=sr,
        n_mels=target_height,
        n_fft=VOICE_NFFT,
        hop_length=VOICE_HOP_LENGTH,
        fmin=0,
        fmax=sr / 2,
        power=2.0,
    )
    mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max, top_db=VOICE_TOP_DB)
    current_width = mel_spec_db.shape[1]
    if current_width < target_width:
        pad_left = (target_width - current_width) // 2
        pad_right = target_width - current_width - pad_left
        mel_spec_db = np.pad(
            mel_spec_db,
            ((0, 0), (pad_left, pad_right)),
            mode="constant",
            constant_values=-VOICE_TOP_DB,
        )
    elif current_width > target_width:
        start = (current_width - target_width) // 2
        mel_spec_db = mel_spec_db[:, start : start + target_width]

    mel_spec_normalized = np.clip((mel_spec_db + VOICE_TOP_DB) / VOICE_TOP_DB, 0.0, 1.0).astype(np.float32)
    if target_channels == 1:
        model_input = np.expand_dims(mel_spec_normalized, axis=-1)
    else:
        model_input = np.stack([mel_spec_normalized] * target_channels, axis=-1)
        model_input = tf.keras.applications.mobilenet_v2.preprocess_input(model_input * 255.0)
    return np.expand_dims(model_input.astype(np.float32), axis=0)


def predict_spiral_class(model, batch: np.ndarray) -> float:
    """Raw sigmoid: high value => Parkinson (matches training / API)."""
    out = model.predict(batch, verbose=0)
    return float(np.asarray(out).reshape(-1)[0])


def predict_wave_class(model, batch: np.ndarray) -> float:
    """Raw sigmoid first output; API maps high sigmoid -> Healthy."""
    out = model.predict(batch, verbose=0)
    return float(np.asarray(out).reshape(-1)[0])


def spiral_pred_label(sigmoid: float) -> int:
    return 1 if sigmoid > 0.5 else 0


def wave_pred_label(sigmoid: float) -> int:
    """Match backend_api: healthy_score = sigmoid, parkinsons = 1 - sigmoid."""
    parkinsons_score = 1.0 - sigmoid
    healthy_score = sigmoid
    return 1 if parkinsons_score > healthy_score else 0


def voice_scores_and_label(model, batch: np.ndarray, sigmoid_positive_class: str) -> Tuple[float, float, int]:
    """Returns parkinsons_score, healthy_score, binary pred (1=Parkinsons) using API threshold."""
    preds = model.predict(batch, verbose=0)
    preds = np.asarray(preds)
    if preds.ndim == 2 and preds.shape[1] == 1:
        raw = float(preds[0][0])
        if sigmoid_positive_class == "healthy":
            healthy_score = raw
            parkinsons_score = 1.0 - healthy_score
        else:
            parkinsons_score = raw
            healthy_score = 1.0 - parkinsons_score
    elif preds.ndim == 2 and preds.shape[1] >= 2:
        parkinsons_score = float(preds[0][0])
        healthy_score = float(preds[0][1])
    else:
        raise ValueError(f"Unexpected voice output shape: {preds.shape}")

    parkinsons_score = float(np.clip(parkinsons_score, 0.0, 1.0))
    healthy_score = float(np.clip(healthy_score, 0.0, 1.0))
    pred = 1 if parkinsons_score >= VOICE_POSITIVE_THRESHOLD else 0
    return parkinsons_score, healthy_score, pred


def list_files(root: str, extensions: Sequence[str]) -> List[str]:
    if not root or not os.path.isdir(root):
        return []
    out: List[str] = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if os.path.isfile(path) and name.lower().endswith(tuple(extensions)):
            out.append(path)
    return out


def collect_binary_labels(healthy_dir: str, parkinsons_dir: str, extensions: Sequence[str]) -> Tuple[List[str], np.ndarray]:
    h_files = list_files(healthy_dir, extensions)
    p_files = list_files(parkinsons_dir, extensions)
    paths = h_files + p_files
    y = np.array([0] * len(h_files) + [1] * len(p_files), dtype=np.int32)
    return paths, y


def print_matrix(name: str, cm: np.ndarray, labels: Sequence[str]) -> None:
    print(f"\n=== {name} ===")
    print("Rows: true | Columns: predicted")
    header = " " * 18 + "".join(f"{lab:>14}" for lab in labels)
    print(header)
    for i, row_lab in enumerate(labels):
        row = "".join(f"{cm[i, j]:>14}" for j in range(cm.shape[1]))
        print(f"{row_lab:>16}  {row}")


def run_eval(
    title: str,
    y_true: np.ndarray,
    y_pred: np.ndarray,
) -> None:
    from sklearn.metrics import classification_report, confusion_matrix

    labels = ["Healthy", "Parkinsons"]
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    print_matrix(title, cm, labels)
    print("\nClassification report:")
    print(classification_report(y_true, y_pred, target_names=labels, zero_division=0))


def evaluate_spiral(model_path: str, healthy_dir: str, parkinsons_dir: str) -> int:
    """Returns number of samples evaluated (0 if skipped)."""
    model = tf.keras.models.load_model(model_path, compile=False)
    paths, y_true = collect_binary_labels(healthy_dir, parkinsons_dir, IMAGE_EXTS)
    if not paths:
        print(
            "Spiral: no image files found (.png, .jpg, … in spiral/healthy and spiral/parkinsons); skipping.",
            file=sys.stderr,
        )
        return 0
    y_pred = np.zeros_like(y_true)
    for i, p in enumerate(paths):
        with open(p, "rb") as f:
            x = preprocess_for_spiral(f.read())
        sig = predict_spiral_class(model, x)
        y_pred[i] = spiral_pred_label(sig)
    run_eval("Spiral (MobileNet spiral)", y_true, y_pred)
    return len(paths)


def evaluate_wave(model_path: str, healthy_dir: str, parkinsons_dir: str) -> int:
    model = tf.keras.models.load_model(model_path, compile=False)
    paths, y_true = collect_binary_labels(healthy_dir, parkinsons_dir, IMAGE_EXTS)
    if not paths:
        print(
            "Wave: no image files found (.png, .jpg, … in wave/healthy and wave/parkinsons); skipping.",
            file=sys.stderr,
        )
        return 0
    y_pred = np.zeros_like(y_true)
    for i, p in enumerate(paths):
        with open(p, "rb") as f:
            x = preprocess_for_wave(f.read())
        sig = predict_wave_class(model, x)
        y_pred[i] = wave_pred_label(sig)
    run_eval("Wave (Inception wave)", y_true, y_pred)
    return len(paths)


def evaluate_voice(model_path: str, healthy_dir: str, parkinsons_dir: str, sigmoid_positive_class: str) -> int:
    model = tf.keras.models.load_model(model_path, compile=False)
    paths, y_true = collect_binary_labels(healthy_dir, parkinsons_dir, AUDIO_EXTS)
    if not paths:
        print(
            "Voice: no audio files found (.wav, .mp3, … in voice/healthy and voice/parkinsons); skipping.",
            file=sys.stderr,
        )
        return 0
    yt: List[int] = []
    yp: List[int] = []
    for i, p in enumerate(paths):
        with open(p, "rb") as f:
            audio_bytes = f.read()
        try:
            mel = preprocess_for_voice(audio_bytes, model.input_shape)
        except Exception as e:
            print(f"  Skip (preprocess error) {p}: {e}")
            continue
        _, _, pred = voice_scores_and_label(model, mel, sigmoid_positive_class)
        yt.append(int(y_true[i]))
        yp.append(int(pred))
    if not yt:
        print("Voice: no samples could be preprocessed; skipping metrics.", file=sys.stderr)
        return 0
    run_eval(
        f"Voice (threshold={VOICE_POSITIVE_THRESHOLD}, positive_class={sigmoid_positive_class})",
        np.array(yt, dtype=np.int32),
        np.array(yp, dtype=np.int32),
    )
    return len(yt)


def _print_expected_layout(dataset_root: str) -> None:
    root = os.path.abspath(dataset_root)
    print("\nExpected layout when using --dataset-root (three modalities, separate images/audio):", file=sys.stderr)
    print(f"  {root}/", file=sys.stderr)
    for kind in ("spiral", "wave", "voice"):
        print(f"    {kind}/healthy/     <- {kind} samples labeled healthy", file=sys.stderr)
        print(f"    {kind}/parkinsons/  <- {kind} samples labeled Parkinsons", file=sys.stderr)
    print("\nOr use one root per model, e.g. --spiral-root ./my_spiral_data (with healthy/ & parkinsons/ inside).", file=sys.stderr)


def _diagnose_dataset_root(dataset_root: str) -> None:
    root = os.path.abspath(dataset_root)
    print(f"\nDiagnosing --dataset-root {root}", file=sys.stderr)
    if not os.path.isdir(root):
        print("  ERROR: this folder does not exist yet.", file=sys.stderr)
        print("  Create it (and spiral/wave/voice subfolders) with:", file=sys.stderr)
        print(
            f'    python evaluate_confusion_matrices.py --dataset-root "{dataset_root}" --init-skeleton',
            file=sys.stderr,
        )
        print("  The repo also includes backend/eval_data/ — use --dataset-root ./eval_data from the backend folder.", file=sys.stderr)
        return
    for kind in ("spiral", "wave", "voice"):
        base = os.path.join(root, kind)
        h = os.path.join(base, "healthy")
        pk = os.path.join(base, "parkinsons")
        print(f"  {kind}/", file=sys.stderr)
        print(f"    exists: {os.path.isdir(base)}", file=sys.stderr)
        if os.path.isdir(base):
            print(f"    healthy/:     exists={os.path.isdir(h)}", file=sys.stderr)
            print(f"    parkinsons/:  exists={os.path.isdir(pk)}", file=sys.stderr)


def _init_skeleton(dataset_root: str) -> None:
    root = os.path.abspath(dataset_root)
    for kind in ("spiral", "wave", "voice"):
        for label in ("healthy", "parkinsons"):
            d = os.path.join(root, kind, label)
            os.makedirs(d, exist_ok=True)
    print(f"Created empty folder tree under {root} (spiral|wave|voice)/(healthy|parkinsons). Add files, then run again.")


def main(argv: Optional[Iterable[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Confusion matrices for spiral / wave / voice models.")
    p.add_argument(
        "--dataset-root",
        type=str,
        default=None,
        help="Folder containing spiral/, wave/, voice/ subdirs, each with healthy/ and parkinsons/.",
    )
    p.add_argument(
        "--init-skeleton",
        action="store_true",
        help="Create empty spiral/wave/voice -> healthy/parkinsons under --dataset-root and exit.",
    )
    p.add_argument("--spiral-root", type=str, default=None, help="Folder with healthy/ and parkinsons/ image subfolders.")
    p.add_argument("--wave-root", type=str, default=None)
    p.add_argument("--voice-root", type=str, default=None)
    p.add_argument("--spiral-model", type=str, default=SPIRAL_MODEL_PATH_H5)
    p.add_argument("--wave-model", type=str, default=WAVE_MODEL_PATH)
    p.add_argument("--voice-model", type=str, default=VOICE_MODEL_PATH_H5)
    p.add_argument(
        "--voice-sigmoid-positive-class",
        type=str,
        default=os.getenv("VOICE_SIGMOID_POSITIVE_CLASS", "parkinsons").strip().lower(),
        choices=("parkinsons", "healthy"),
        help="Must match backend_api VOICE_SIGMOID_POSITIVE_CLASS for single-output voice models.",
    )
    args = p.parse_args(list(argv) if argv is not None else None)

    if args.init_skeleton:
        if not args.dataset_root:
            print("--init-skeleton requires --dataset-root", file=sys.stderr)
            return 1
        _init_skeleton(args.dataset_root)
        return 0

    def resolve_pair(kind: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        if args.dataset_root:
            base = os.path.join(args.dataset_root, kind)
            h = os.path.join(base, "healthy")
            pk = os.path.join(base, "parkinsons")
            if os.path.isdir(base):
                return base, h, pk
        if kind == "spiral" and args.spiral_root:
            return args.spiral_root, os.path.join(args.spiral_root, "healthy"), os.path.join(args.spiral_root, "parkinsons")
        if kind == "wave" and args.wave_root:
            return args.wave_root, os.path.join(args.wave_root, "healthy"), os.path.join(args.wave_root, "parkinsons")
        if kind == "voice" and args.voice_root:
            return args.voice_root, os.path.join(args.voice_root, "healthy"), os.path.join(args.voice_root, "parkinsons")
        return None, None, None

    for name, path in ("spiral", args.spiral_model), ("wave", args.wave_model), ("voice", args.voice_model):
        if not os.path.isfile(path):
            print(f"Warning: {name} model not found at {path}", file=sys.stderr)

    n_spiral = n_wave = n_voice = 0

    _, sh, sp = resolve_pair("spiral")
    if sh and sp and (os.path.isdir(sh) or os.path.isdir(sp)):
        if os.path.isfile(args.spiral_model):
            n_spiral = evaluate_spiral(args.spiral_model, sh, sp)
        else:
            print("Spiral: model file missing; skipped.", file=sys.stderr)

    _, wh, wp = resolve_pair("wave")
    if wh and wp and (os.path.isdir(wh) or os.path.isdir(wp)):
        if os.path.isfile(args.wave_model):
            n_wave = evaluate_wave(args.wave_model, wh, wp)
        else:
            print("Wave: model file missing; skipped.", file=sys.stderr)

    _, vh, vp = resolve_pair("voice")
    if vh and vp and (os.path.isdir(vh) or os.path.isdir(vp)):
        if os.path.isfile(args.voice_model):
            n_voice = evaluate_voice(args.voice_model, vh, vp, args.voice_sigmoid_positive_class)
        else:
            print("Voice: model file missing; skipped.", file=sys.stderr)

    dirs_ok = any(
        [
            sh and sp and os.path.isdir(sh) and os.path.isdir(sp),
            wh and wp and os.path.isdir(wh) and os.path.isdir(wp),
            vh and vp and os.path.isdir(vh) and os.path.isdir(vp),
        ]
    )

    if not dirs_ok:
        print(
            "No valid data directories found. Each modality needs BOTH subfolders 'healthy' and 'parkinsons' with files inside.",
            file=sys.stderr,
        )
        if args.dataset_root:
            _diagnose_dataset_root(args.dataset_root)
            _print_expected_layout(args.dataset_root)
            print(
                f"\nTip: create empty dirs with:\n  python evaluate_confusion_matrices.py --dataset-root {args.dataset_root} --init-skeleton",
                file=sys.stderr,
            )
        else:
            _print_expected_layout(".")
        return 1

    if n_spiral + n_wave + n_voice == 0:
        print(
            "\nNo evaluation ran: folders exist but there are no labeled image/audio files yet.\n"
            "  • spiral & wave: add .png / .jpg under each modality’s healthy/ and parkinsons/\n"
            "  • voice: add .wav (or .mp3, …) under voice/healthy/ and voice/parkinsons/\n"
            ".gitkeep files are ignored — you need real samples for a confusion matrix.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
