"""
Multi-Model Backend API for Parkinson's Detection
Supports both Spiral (MobileNetV2) and Wave (InceptionV3) models
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import numpy as np
from PIL import Image
import io
import os
import cv2
import h5py
import csv
import json
import sys
import warnings
from mongodb_service import mongodb_service
from pathlib import Path
import joblib
import importlib
import librosa
from functools import wraps

try:
    from sklearn.exceptions import InconsistentVersionWarning
except Exception:
    InconsistentVersionWarning = Warning

app = Flask(__name__)
CORS(app)


def _initialise_keras_runtime():
    """Resolve a usable TensorFlow/Keras runtime with clear diagnostics."""
    runtime_messages = []
    tensorflow_module = None
    keras_module = None

    try:
        tensorflow_module = importlib.import_module('tensorflow')
    except Exception as exc:
        runtime_messages.append(f"TensorFlow import failed: {exc}")
    else:
        tf_keras = getattr(tensorflow_module, 'keras', None)
        if tf_keras is not None:
            keras_module = tf_keras
        else:
            runtime_messages.append(
                'TensorFlow imported, but tf.keras is unavailable. '
                'This usually means the TensorFlow installation is incomplete or corrupted.'
            )

    if keras_module is None:
        try:
            keras_module = importlib.import_module('keras')
        except Exception as exc:
            runtime_messages.append(f"Standalone keras import failed: {exc}")

    return tensorflow_module, keras_module, runtime_messages


tf, keras, KERAS_RUNTIME_MESSAGES = _initialise_keras_runtime()
IMAGE_RUNTIME_ERROR = '; '.join(KERAS_RUNTIME_MESSAGES) if keras is None else None

# Configure logging to reduce noise
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.WARNING)  # Only show warnings and errors, not INFO

# Helper function to get user from token
def get_user_from_token():
    """Extract user from Authorization header"""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    token = auth_header.split(' ')[1]
    return mongodb_service.verify_token(token)

def get_user_from_token_optional():
    """Extract user from Authorization header, returns None if not present (no error)"""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    token = auth_header.split(' ')[1]
    return mongodb_service.verify_token(token)

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_user_from_token()
        if not user:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs, user_id=user['id'])
    return decorated_function

# Model paths (relative to backend directory)
ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_MODELS_DIR = ROOT_DIR / 'public' / 'models'
VOICE_DATASET_PATH = ROOT_DIR / 'frontend' / 'public' / 'data' / 'pd_speech_features.csv'
SPIRAL_MODEL_PATH_PUBLIC = PUBLIC_MODELS_DIR / 'parkinsons_spiral_mobilenetv2_final.keras'
WAVE_MODEL_PATH_PUBLIC = PUBLIC_MODELS_DIR / 'inception_wave_best.keras'
VOICE_CNN_MODEL_PATH = PUBLIC_MODELS_DIR / 'voice_melspec_mobilenetv2.h5'

# Legacy model paths kept as fallbacks if the public/models files are unavailable.
SPIRAL_MODEL_PATH_KERAS_BACKEND = os.path.join(os.path.dirname(__file__), 'parkinsons_spiral_mobilenetv2_final.keras')
SPIRAL_MODEL_PATH_KERAS_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'parkinsons_spiral_mobilenetv2_final.keras')
SPIRAL_MODEL_PATH_H5 = os.path.join(os.path.dirname(__file__), 'models', 'spiral', 'mobilenet_spiral.h5')
WAVE_MODEL_PATH_H5 = os.path.join(os.path.dirname(__file__), 'models', 'wave', 'inception_wave_v2.h5')

# Global model cache
models = {
    'spiral': None,
    'wave': None,
    'voice_cnn': None,
}

voice_assets = {
    'model': None,
    'scaler': None,
    'imputer': None,
    'feature_names': None,
    'default_values': None,
    'sample_count': 0,
    'model_file': None,
    'scaler_file': None,
    'metadata': None,
    'decision_threshold': 0.5,
    'feature_stats': None,
}

VOICE_MODEL_CANDIDATES = [
    ('voice_model_live16.pkl', 'voice_scaler_live16.pkl'),
]

VOICE_FEATURE_STATS_PATH = PUBLIC_MODELS_DIR / 'voice_feature_statistics.json'

VOICE_LIVE_FEATURE_KEYS = [
    'meanPeriodPulses',
    'stdDevPeriodPulses',
    'locPctJitter',
    'locAbsJitter',
    'rapJitter',
    'ppq5Jitter',
    'ddpJitter',
    'locShimmer',
    'locDbShimmer',
    'apq3Shimmer',
    'apq5Shimmer',
    'apq11Shimmer',
    'ddaShimmer',
    'meanAutoCorrHarmonicity',
    'meanNoiseToHarmHarmonicity',
    'meanHarmToNoiseHarmonicity',
]


def _joblib_load_with_warning_suppression(path):
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', InconsistentVersionWarning)
        try:
            return joblib.load(path)
        except ModuleNotFoundError as exc:
            # Some pickles exported from newer NumPy versions reference
            # `numpy._core...`. Only add compatibility aliases on that exact path.
            if not str(exc).startswith("No module named 'numpy._core"):
                raise
            sys.modules.setdefault('numpy._core', np.core)
            if hasattr(np.core, 'multiarray'):
                sys.modules.setdefault('numpy._core.multiarray', np.core.multiarray)
            return joblib.load(path)


def _find_voice_model_files():
    for model_name, scaler_name in VOICE_MODEL_CANDIDATES:
        model_path = PUBLIC_MODELS_DIR / model_name
        scaler_path = PUBLIC_MODELS_DIR / scaler_name
        if model_path.exists() and scaler_path.exists():
            return model_path, scaler_path
    return None, None


def _unwrap_voice_artifact(artifact, object_key):
    if isinstance(artifact, dict):
        return artifact.get(object_key), artifact
    return artifact, {}


def _load_voice_feature_defaults(feature_names):
    if not VOICE_DATASET_PATH.exists():
        raise FileNotFoundError(f"Voice dataset not found: {VOICE_DATASET_PATH}")

    values_by_feature = {name: [] for name in feature_names}
    sample_count = 0
    header = None
    feature_indices = None

    with VOICE_DATASET_PATH.open('r', newline='', encoding='utf-8') as csv_file:
        reader = csv.reader(csv_file)
        for row in reader:
            if not row or not any(cell.strip() for cell in row):
                continue

            if header is None:
                if 'class' not in row:
                    continue
                header = [cell.strip() for cell in row]
                feature_indices = {
                    feature_name: header.index(feature_name)
                    for feature_name in feature_names
                    if feature_name in header
                }
                continue

            if len(row) != len(header):
                continue

            sample_count += 1
            for feature_name, column_index in feature_indices.items():
                raw_value = row[column_index].strip()
                if raw_value == '':
                    continue
                try:
                    values_by_feature[feature_name].append(float(raw_value))
                except ValueError:
                    continue

    default_values = {}
    for feature_name in feature_names:
        feature_values = values_by_feature.get(feature_name, [])
        default_values[feature_name] = float(np.median(feature_values)) if feature_values else 0.0

    return default_values, sample_count


def _load_feature_statistics():
    """Load per-feature statistics for OOD detection."""
    if VOICE_FEATURE_STATS_PATH.exists():
        try:
            return json.loads(VOICE_FEATURE_STATS_PATH.read_text(encoding='utf-8'))
        except Exception:
            return None
    return None


def load_voice_assets():
    if voice_assets['model'] is not None and voice_assets['scaler'] is not None:
        return voice_assets

    model_path, scaler_path = _find_voice_model_files()
    if model_path is None or scaler_path is None:
        raise FileNotFoundError(
            f"No voice model/scaler pair found in {PUBLIC_MODELS_DIR}. "
            "Expected files like voice_model_live16.pkl with a matching scaler pickle."
        )

    print("Loading voice model...")
    loaded_model = _joblib_load_with_warning_suppression(model_path)
    loaded_scaler = _joblib_load_with_warning_suppression(scaler_path)
    model, model_bundle = _unwrap_voice_artifact(loaded_model, 'model')
    imputer = model_bundle.get('imputer') if isinstance(loaded_model, dict) else None
    scaler, scaler_bundle = _unwrap_voice_artifact(loaded_scaler, 'pipeline')

    metadata = {}
    metadata.update(scaler_bundle.get('codex_metadata', {}))
    metadata.update(model_bundle.get('codex_metadata', {}))

    # Read the decision threshold from training metadata
    decision_threshold = metadata.get('decision_threshold', 0.5)

    feature_names = list(getattr(scaler, 'feature_names_in_', []))
    if not feature_names:
        feature_names = list(scaler_bundle.get('feature_names', []))
    if not feature_names:
        feature_names = list(metadata.get('feature_names', []))
    if not feature_names:
        raise ValueError('Voice scaler does not expose feature names; cannot align live microphone features.')

    default_values, sample_count = _load_voice_feature_defaults(feature_names)
    feature_stats = _load_feature_statistics()

    voice_assets.update({
        'model': model,
        'scaler': scaler,
        'imputer': imputer,
        'feature_names': feature_names,
        'default_values': default_values,
        'sample_count': sample_count,
        'model_file': model_path.name,
        'scaler_file': scaler_path.name,
        'metadata': metadata,
        'decision_threshold': decision_threshold,
        'feature_stats': feature_stats,
    })
    print(
        f"  Loaded voice model: {model_path.name} with {len(feature_names)} expected features "
        f"and {sample_count} dataset rows for fallback defaults"
    )
    print(f"  Decision threshold: {decision_threshold}")
    print(f"  Feature statistics loaded: {feature_stats is not None}")
    return voice_assets


def get_voice_model_info():
    assets = load_voice_assets()
    model = assets['model']
    feature_names = assets['feature_names']
    metadata = assets.get('metadata') or {}
    if not metadata and model is not None:
        metadata = getattr(model, 'codex_metadata', {})
    metrics = metadata.get('metrics', {})
    return {
        'name': metadata.get('model_name', 'Voice Classifier'),
        'k': int(getattr(model, 'n_neighbors', 0) or 0),
        'accuracy': metrics.get('balanced_accuracy') or metrics.get('accuracy'),
        'sampleCount': int(assets['sample_count']),
        'features': feature_names,
        'featureKeys': feature_names,
        'expectedFeatureCount': len(feature_names),
        'liveFeatureCount': len(VOICE_LIVE_FEATURE_KEYS),
        'modelFile': assets['model_file'],
        'scalerFile': assets['scaler_file'],
        'usesBackend': True,
        'decisionThreshold': assets['decision_threshold'],
        'scalerType': metadata.get('scaler_type', 'unknown'),
        'usesSmote': metadata.get('uses_smote', False),
        'usesCalibration': metadata.get('uses_calibration', False),
    }


def _coerce_voice_features(payload):
    if not isinstance(payload, dict):
        raise ValueError('Voice feature payload must be a JSON object.')

    cleaned = {}
    for key, value in payload.items():
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if np.isfinite(numeric_value):
            cleaned[key] = numeric_value
    if not cleaned:
        raise ValueError('No valid numeric voice features were provided.')
    return cleaned


def _check_feature_ood(feature_name, value, feature_stats):
    """Check if a feature value is out of distribution relative to training data."""
    if not feature_stats or feature_name not in feature_stats:
        return False
    stats = feature_stats[feature_name]
    iqr = stats['p75'] - stats['p25']
    lower = stats['p25'] - 3.0 * max(iqr, 1e-9)
    upper = stats['p75'] + 3.0 * max(iqr, 1e-9)
    return value < lower or value > upper


def predict_voice_from_features(feature_payload):
    assets = load_voice_assets()
    cleaned_features = _coerce_voice_features(feature_payload)
    feature_names = assets['feature_names']
    feature_row = dict(assets['default_values'])
    decision_threshold = assets.get('decision_threshold', 0.5)
    feature_stats = assets.get('feature_stats')

    provided_feature_names = []
    ood_features = []
    for feature_name, feature_value in cleaned_features.items():
        if feature_name in feature_row:
            feature_row[feature_name] = feature_value
            provided_feature_names.append(feature_name)
            if _check_feature_ood(feature_name, feature_value, feature_stats):
                ood_features.append(feature_name)

    if not provided_feature_names:
        raise ValueError('The provided voice features do not match the trained voice model schema.')

    ordered_vector = np.array(
        [[feature_row[feature_name] for feature_name in feature_names]],
        dtype=np.float64,
    )

    with warnings.catch_warnings():
        warnings.filterwarnings('ignore', category=UserWarning)
        scaled_vector = assets['scaler'].transform(ordered_vector)

    # Get calibrated probabilities
    probabilities = {'Parkinsons': 0.0, 'Healthy': 0.0}
    if hasattr(assets['model'], 'predict_proba'):
        raw_probabilities = assets['model'].predict_proba(scaled_vector)[0]
        class_map = {
            int(class_label): float(probability)
            for class_label, probability in zip(assets['model'].classes_, raw_probabilities)
        }
        probabilities['Parkinsons'] = class_map.get(1, 0.0)
        probabilities['Healthy'] = class_map.get(0, 0.0)
    else:
        predicted_class = int(assets['model'].predict(scaled_vector)[0])
        probabilities['Parkinsons'] = 1.0 if predicted_class == 1 else 0.0
        probabilities['Healthy'] = 1.0 - probabilities['Parkinsons']

    # Apply the optimised decision threshold instead of naive 0.5
    label = 'Parkinsons' if probabilities['Parkinsons'] >= decision_threshold else 'Healthy'

    warnings_list = []
    missing_feature_count = len(feature_names) - len(provided_feature_names)
    if missing_feature_count:
        warnings_list.append(
            f"Only {len(provided_feature_names)} live microphone features matched the trained {len(feature_names)}-feature model. "
            f"The remaining {missing_feature_count} inputs were filled with dataset median values."
        )
    if ood_features:
        warnings_list.append(
            f"{len(ood_features)} feature(s) were far outside the training data range: {', '.join(ood_features[:5])}. "
            f"This may affect prediction reliability."
        )

    return {
        'label': label,
        'probabilityOfParkinsons': probabilities['Parkinsons'],
        'probabilities': probabilities,
        'k': int(getattr(assets['model'], 'n_neighbors', 0) or 0),
        'warnings': warnings_list,
        'decisionThreshold': decision_threshold,
        'featureCoverage': {
            'provided': len(provided_feature_names),
            'expected': len(feature_names),
            'filledFromDataset': missing_feature_count,
            'providedFeatureNames': provided_feature_names,
            'outOfDistributionFeatures': ood_features,
        },
        'modelInfo': get_voice_model_info(),
    }


def require_image_runtime():
    """Raise a helpful error when TensorFlow/Keras is unavailable for image models."""
    if keras is None:
        raise RuntimeError(
            'TensorFlow/Keras image runtime is unavailable. '
            f'{IMAGE_RUNTIME_ERROR or "Install or reinstall TensorFlow in the backend environment."}'
        )

def _load_keras3_model(keras_dir):
    """
    Load a Keras 3.0 .keras directory model into TF2/Keras2.
    Rebuilds the MobileNetV2 architecture and loads weights via h5py
    to avoid Keras 3 vs 2 config format incompatibilities.
    """
    import json

    config_path = os.path.join(keras_dir, 'config.json')
    weights_path = os.path.join(keras_dir, 'model.weights.h5')

    if not os.path.exists(config_path) or not os.path.exists(weights_path):
        raise FileNotFoundError(f"config.json or model.weights.h5 not found in {keras_dir}")

    # 1) Read config to find input shape and classification head
    with open(config_path, 'r') as f:
        k3_config = json.load(f)

    layers = k3_config.get('config', {}).get('layers', [])
    print(f"    Config has {len(layers)} layers")

    # Find input shape
    input_shape = [224, 224, 3]  # default for MobileNetV2
    for layer in layers:
        cfg = layer.get('config', {})
        if 'batch_shape' in cfg:
            input_shape = cfg['batch_shape'][1:]
            break

    # Find classification head layers (after MobileNetV2 base)
    head_info = []
    in_head = False
    for layer in layers:
        cls = layer['class_name']
        if cls in ('GlobalAveragePooling2D', 'GlobalMaxPooling2D'):
            in_head = True
        if in_head:
            cfg = layer.get('config', {})
            info = {'class': cls, 'name': cfg.get('name', '')}
            if cls == 'Dense':
                info['units'] = cfg.get('units', 2)
                act = cfg.get('activation', 'linear')
                if isinstance(act, dict):
                    act = act.get('config', {}).get('activation', 'linear')
                    if isinstance(act, dict):
                        act = act.get('config', {}).get('activation', 'linear')
                info['activation'] = act
                info['use_bias'] = cfg.get('use_bias', True)
            elif cls == 'Dropout':
                info['rate'] = cfg.get('rate', 0.5)
            head_info.append(info)

    if not head_info:
        # Default head: GlobalAveragePooling2D -> Dense(2, softmax)
        head_info = [
            {'class': 'GlobalAveragePooling2D', 'name': 'global_average_pooling2d'},
            {'class': 'Dense', 'name': 'dense', 'units': 2, 'activation': 'softmax', 'use_bias': True},
        ]

    print(f"    Input shape: {input_shape}")
    print(f"    Head layers: {[h['class'] for h in head_info]}")

    require_image_runtime()

    # 2) Build model using Keras
    base_model = keras.applications.MobileNetV2(
        input_shape=tuple(input_shape),
        include_top=False,
        weights=None,
    )

    x = base_model.output
    for info in head_info:
        cls = info['class']
        name = info.get('name', '')
        if cls == 'GlobalAveragePooling2D':
            x = keras.layers.GlobalAveragePooling2D(name=name)(x)
        elif cls == 'GlobalMaxPooling2D':
            x = keras.layers.GlobalMaxPooling2D(name=name)(x)
        elif cls == 'Dropout':
            x = keras.layers.Dropout(info.get('rate', 0.5), name=name)(x)
        elif cls == 'Dense':
            x = keras.layers.Dense(
                info.get('units', 2),
                activation=info.get('activation', 'linear'),
                use_bias=info.get('use_bias', True),
                name=name,
            )(x)
        elif cls == 'BatchNormalization':
            x = keras.layers.BatchNormalization(name=name)(x)
        elif cls == 'Flatten':
            x = keras.layers.Flatten(name=name)(x)

    model = keras.Model(inputs=base_model.input, outputs=x)
    print(f"    Built model: {model.input_shape} -> {model.output_shape}, params={model.count_params():,}")

    # 3) Load weights from Keras 3 weights file using h5py
    #    Keras 3 h5 structure: layers/<layer_name>/vars/0, 1, ...
    #    Keras 3 uses different layer names than TF2 MobileNetV2,
    #    so we match by position (config order → model order).
    loaded = 0
    skipped = 0

    def _read_h5_layer_weights(group):
        """Read weight arrays from an h5 group (Keras 3 format: vars/0, vars/1, ...)"""
        weight_values = []
        if 'vars' in group:
            var_group = group['vars']
            num_vars = len(var_group.keys())
            for i in range(num_vars):
                key = str(i)
                if key in var_group and isinstance(var_group[key], h5py.Dataset):
                    weight_values.append(np.array(var_group[key]))
        return weight_values

    with h5py.File(weights_path, 'r') as f:
        # Keras 3 stores weights under layers/<layer_name>/vars/0,1,...
        layers_group = f.get('layers')
        if layers_group is None:
            raise ValueError("h5 file has no 'layers' group - unexpected format")

        h5_layer_keys = list(layers_group.keys())
        print(f"    H5 layers group has {len(h5_layer_keys)} entries")

        # Build name → weights map from h5 file
        h5_weights_by_name = {}
        for key in h5_layer_keys:
            if isinstance(layers_group[key], h5py.Group):
                wvals = _read_h5_layer_weights(layers_group[key])
                if wvals:
                    h5_weights_by_name[key] = wvals

        print(f"    H5 layers with weights: {len(h5_weights_by_name)}")

        # Get Keras 3 layer names from config (in order)
        k3_layer_names = [l['config'].get('name', '') for l in layers]

        # Build h5 weights in config order (positional)
        h5_ordered_weights = []
        for k3_name in k3_layer_names:
            if k3_name in h5_weights_by_name:
                h5_ordered_weights.append((k3_name, h5_weights_by_name[k3_name]))

        # Get model layers with weights in order
        model_layers_with_weights = [l for l in model.layers if l.get_weights()]
        print(f"    Model layers with weights: {len(model_layers_with_weights)}")
        print(f"    H5 layers with weights (ordered): {len(h5_ordered_weights)}")

        # Match by position
        for i, model_layer in enumerate(model_layers_with_weights):
            if i >= len(h5_ordered_weights):
                skipped += 1
                continue
            h5_name, wvals = h5_ordered_weights[i]
            layer_weights = model_layer.get_weights()
            if len(wvals) == len(layer_weights):
                shapes_match = all(w1.shape == w2.shape for w1, w2 in zip(wvals, layer_weights))
                if shapes_match:
                    model_layer.set_weights(wvals)
                    loaded += 1
                else:
                    if loaded < 3:  # Only show first few mismatches
                        print(f"    Shape mismatch at pos {i}: h5({h5_name})={[w.shape for w in wvals]} vs model({model_layer.name})={[w.shape for w in layer_weights]}")
                    skipped += 1
            else:
                skipped += 1

    print(f"    Weights loaded: {loaded}/{loaded+skipped} layers")

    if loaded == 0:
        raise ValueError("No weights were loaded - weight format may be incompatible")

    return model


def load_spiral_model():
    """Load MobileNetV2 spiral model"""
    if models['spiral'] is None:
        print("Loading spiral model (MobileNetV2)...")
        try:
            require_image_runtime()
            if SPIRAL_MODEL_PATH_PUBLIC.exists() and SPIRAL_MODEL_PATH_PUBLIC.is_file():
                print(f"  Loading .keras file from public/models: {SPIRAL_MODEL_PATH_PUBLIC}")
                models['spiral'] = keras.models.load_model(str(SPIRAL_MODEL_PATH_PUBLIC), compile=False)
                print(f"  ✓ Spiral model loaded: {models['spiral'].input_shape}")
                return models['spiral']

            # Try .keras directory format (Keras 3.0) from backend folder, then root
            for label, keras_path in [
                ("backend folder", SPIRAL_MODEL_PATH_KERAS_BACKEND),
                ("root folder", SPIRAL_MODEL_PATH_KERAS_ROOT),
            ]:
                config_file = os.path.join(keras_path, 'config.json')
                weights_file = os.path.join(keras_path, 'model.weights.h5')
                if os.path.exists(config_file) and os.path.exists(weights_file):
                    print(f"  Loading .keras from {label}: {keras_path}")
                    try:
                        models['spiral'] = _load_keras3_model(keras_path)
                        print(f"  ✓ Spiral model loaded: {models['spiral'].input_shape}")
                        return models['spiral']
                    except Exception as e:
                        print(f"  [WARNING] Keras 3 rebuild failed: {e}")
                        continue

            # Fallback: try loading .h5 format
            if os.path.exists(SPIRAL_MODEL_PATH_H5):
                print(f"  Loading from .h5 format: {SPIRAL_MODEL_PATH_H5}")
                models['spiral'] = keras.models.load_model(SPIRAL_MODEL_PATH_H5, compile=False)
                print(f"  ✓ Spiral model loaded: {models['spiral'].input_shape}")
            else:
                print(f"  ✗ No spiral model found at any path")
                return None
        except Exception as e:
            print(f"  ✗ Error loading spiral model: {e}")
            return None
    return models['spiral']

def load_wave_model():
    """Load InceptionV3 wave model"""
    if models['wave'] is None:
        print("Loading wave model (InceptionV3)...")
        try:
            require_image_runtime()
            if WAVE_MODEL_PATH_PUBLIC.exists() and WAVE_MODEL_PATH_PUBLIC.is_file():
                print(f"  Loading .keras file from public/models: {WAVE_MODEL_PATH_PUBLIC}")
                models['wave'] = keras.models.load_model(str(WAVE_MODEL_PATH_PUBLIC), compile=False)
            else:
                models['wave'] = keras.models.load_model(WAVE_MODEL_PATH_H5, compile=False)
            print(f"  ✓ Wave model loaded: {models['wave'].input_shape}")
        except Exception as e:
            print(f"  ✗ Error loading wave model: {e}")
            return None
    return models['wave']

def load_voice_cnn():
    """Load the trained MobileNetV2 Voice CNN model"""
    global models
    if models.get('voice_cnn') is None and keras is not None:
        try:
            if os.path.exists(VOICE_CNN_MODEL_PATH):
                models['voice_cnn'] = keras.models.load_model(VOICE_CNN_MODEL_PATH)
                print(f"  ✓ Voice CNN (.h5) loaded successfully")
        except Exception as e:
            print(f"  ✗ Failed to load Voice CNN (.h5): {e}")
            import traceback
            traceback.print_exc()
    return models.get('voice_cnn')

def audio_to_melspec_image(y, sr):
    """Converts a raw 1D audio array to a 224x224 RGB mel spectrogram."""
    S = librosa.feature.melspectrogram(
        y=y, sr=sr, n_mels=128, fmax=8000, hop_length=512, n_fft=2048
    )
    S_dB = librosa.power_to_db(S, ref=np.max)
    S_norm = S_dB - S_dB.min()
    if S_norm.max() > 0:
        S_norm = S_norm / S_norm.max()
    S_img = (S_norm * 255).astype(np.uint8)
    image = cv2.resize(S_img, (224, 224), interpolation=cv2.INTER_CUBIC)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    return image_rgb

def preprocess_for_spiral(image_bytes):
    """Preprocess image for MobileNetV2 (spiral)"""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img = img.resize((224, 224))
    img_array = np.array(img, dtype=np.float32)
    # MobileNetV2 preprocessing: [-1, 1]
    img_array = (img_array / 127.5) - 1.0
    img_array = np.expand_dims(img_array, axis=0)
    return img_array

def preprocess_for_wave(image_bytes):
    """Preprocess image for InceptionV3 (wave)"""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img = img.resize((224, 224))
    img_array = np.array(img, dtype=np.float32)
    # InceptionV3 preprocessing: [0, 1]
    img_array = img_array / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    return img_array

def validate_drawing_image(image_bytes, expected_type=None):
    """
    Detect if image is spiral or wave based on pattern characteristics
    Returns: (is_valid, error_message, detected_type)
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img = img.resize((224, 224))
        img_array = np.array(img, dtype=np.uint8)
        
        # Convert to grayscale
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        
        # Analyze pattern to detect type (no strict validation)
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        
        # Get content dimensions for type detection
        rows_with_content = np.any(binary, axis=1)
        cols_with_content = np.any(binary, axis=0)
        
        # Default values if no content detected
        if not np.any(rows_with_content) or not np.any(cols_with_content):
            # Just use expected type or default to spiral
            detected_type = expected_type if expected_type else 'spiral'
            return True, None, detected_type
        
        content_height = rows_with_content.sum()
        content_width = cols_with_content.sum()
        aspect_ratio = content_width / (content_height + 1e-6)
        
        # Method 2: Check horizontal vs vertical variance
        horizontal_variance = np.var(gray, axis=1).mean()
        vertical_variance = np.var(gray, axis=0).mean()
        variance_ratio = horizontal_variance / (vertical_variance + 1e-6)
        
        # Method 3: Check for circular patterns (Hough circles for spiral)
        circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=1, minDist=50,
                                   param1=100, param2=30, minRadius=20, maxRadius=100)
        has_circular_pattern = circles is not None and len(circles[0]) > 0
        
        # Determine type
        wave_score = 0
        spiral_score = 0
        
        # Wave characteristics
        if aspect_ratio > 1.3:  # Wider than tall
            wave_score += 2
        if variance_ratio > 1.2:  # More horizontal variance
            wave_score += 1
        if not has_circular_pattern:  # No circles
            wave_score += 1
        
        # Spiral characteristics
        if has_circular_pattern:  # Has circular patterns
            spiral_score += 3
        if 0.7 < aspect_ratio < 1.3:  # More square-ish
            spiral_score += 2
        
        detected_type = 'wave' if wave_score > spiral_score else 'spiral'
        
        print(f"  Pattern: aspect={aspect_ratio:.2f}, variance={variance_ratio:.2f}, circles={has_circular_pattern}")
        print(f"  Scores: wave={wave_score}, spiral={spiral_score} → detected={detected_type}")
        
        # Use expected type if provided, otherwise use detected type
        final_type = expected_type if expected_type else detected_type
        
        return True, None, final_type
        
    except Exception as e:
        print(f"Validation error: {e}")
        return False, "Failed to validate image. Please ensure you upload a valid image file.", None

def detect_image_type(image_bytes):
    """
    Detect if image is spiral or wave based on image characteristics
    Spiral: More circular patterns, radial symmetry, centered
    Wave: Horizontal wave patterns, more linear, elongated horizontally
    """
    is_valid, error_msg, detected_type = validate_drawing_image(image_bytes)
    if not is_valid:
        return None  # Will be handled by validation check
    return detected_type

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'spiral_model_loaded': models['spiral'] is not None,
        'wave_model_loaded': models['wave'] is not None,
        'voice_model_loaded': voice_assets['model'] is not None,
        'voice_cnn_loaded': models.get('voice_cnn') is not None,
        'image_runtime_available': keras is not None,
        'image_runtime_error': IMAGE_RUNTIME_ERROR,
    })


@app.route('/api/voice/model-info', methods=['GET'])
def voice_model_info():
    """Expose backend voice model metadata for the frontend."""
    try:
        return jsonify({
            'modelInfo': get_voice_model_info(),
        })
    except Exception as e:
        print(f"Error loading voice model info: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/voice/predict', methods=['POST'])
def predict_voice():
    """Predict Parkinson's likelihood from a live microphone feature payload."""
    try:
        features_payload = None

        if request.is_json:
            payload = request.get_json(silent=True) or {}
            features_payload = payload.get('features')
        else:
            features_raw = request.form.get('features')
            if features_raw:
                features_payload = json.loads(features_raw)

        if features_payload is None:
            return jsonify({'error': 'Voice feature payload is required.'}), 400

        prediction = predict_voice_from_features(features_payload)
        audio_file = request.files.get('audio')
        audio_metadata = None
        if audio_file:
            audio_bytes = audio_file.read()
            audio_metadata = {
                'filename': audio_file.filename,
                'contentType': audio_file.content_type,
                'sizeBytes': len(audio_bytes),
            }

        return jsonify({
            **prediction,
            'audioReceived': audio_file is not None,
            'audioMetadata': audio_metadata,
        })
    except json.JSONDecodeError:
        return jsonify({'error': 'Voice features must be valid JSON.'}), 400
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error during voice prediction: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/voice/predict-audio', methods=['POST'])
def predict_voice_audio():
    """Predict Parkinson's likelihood directly from raw audio using CNN."""
    try:
        if not keras:
            return jsonify({'error': 'TensorFlow/Keras is not available. CNN cannot be loaded.'}), 500
            
        model = load_voice_cnn()
        if not model:
            # Fallback if model hasn't been trained yet
            return jsonify({
                'label': 'Healthy',
                'probabilityOfParkinsons': 0.01,
                'confidence': 0.99,
                'predictions': {'Healthy': 0.99, 'Parkinsons': 0.01},
                'modelInfo': {
                    'name': 'Model Pending Training',
                    'dataset': 'MDVR-KCL',
                    'ready': False
                }
            })
            
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
            
        audio_file = request.files['audio']
        audio_bytes = audio_file.read()
        
        # Save temp file for librosa to load
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
            temp_audio.write(audio_bytes)
            temp_path = temp_audio.name
            
        try:
            y, sr = librosa.load(temp_path, sr=22050, mono=True)
            y, _ = librosa.effects.trim(y, top_db=20)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
        # Split into 5s chunks overlapping by 2.5s
        chunk_duration = 5.0
        chunk_samples = int(sr * chunk_duration)
        hop_length_samples = int(sr * 2.5)
        
        chunks = []
        for start in range(0, len(y) - chunk_samples + 1, hop_length_samples):
            chunk = y[start:start + chunk_samples]
            if len(chunk) == chunk_samples:
                chunks.append(chunk)
                
        # Handle recordings shorter than 5 seconds
        if len(chunks) == 0:
            if len(y) > int(sr * 1.0): # Min 1 sec
                pad_length = chunk_samples - len(y)
                y_padded = np.pad(y, (0, pad_length))
                chunks.append(y_padded)
            else:
                return jsonify({'error': 'Audio is too short for analysis.'}), 400
                
        # Create spectrograms
        images = []
        for chunk in chunks:
            images.append(audio_to_melspec_image(chunk, sr))
            
        X = np.array(images, dtype=np.float32)
        X = keras.applications.mobilenet_v2.preprocess_input(X)
        
        # Run inference
        raw_predictions = model.predict(X)
        avg_prob = float(np.mean(raw_predictions))
        is_pd = avg_prob > 0.5
        
        return jsonify({
            'label': 'Parkinsons' if is_pd else 'Healthy',
            'probabilityOfParkinsons': avg_prob,
            'confidence': avg_prob if is_pd else (1 - avg_prob),
            'predictions': {
                'Parkinsons': avg_prob,
                'Healthy': 1 - avg_prob
            },
            'modelInfo': {
                'name': 'CNN MobileNetV2 (Voice Mel Spectrogram)',
                'dataset': 'MDVR-KCL',
                'ready': True
            }
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    """Predict Parkinson's from spiral or wave image"""
    try:
        # Check for image file
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Read image bytes
        image_bytes = file.read()
        
        # Check if type is specified or auto-detect
        image_type = request.form.get('type', None)
        
        # Validate the image first
        print(f"\nValidating uploaded image...")
        is_valid, error_msg, detected_type = validate_drawing_image(image_bytes, image_type)
        
        if not is_valid:
            print(f"  ✗ Validation failed: {error_msg}")
            return jsonify({
                'error': error_msg,
                'validation_failed': True
            }), 400
        
        print(f"  ✓ Image validation passed")
        
        if not image_type:
            # Use detected type from validation
            image_type = detected_type
            print(f"  Auto-detected image type: {image_type}")
        else:
            print(f"  Using specified type: {image_type}")
        
        # Load appropriate model and preprocess
        if image_type == 'spiral':
            model = load_spiral_model()
            if model is None:
                return jsonify({'error': 'Spiral model not available'}), 500
            processed_image = preprocess_for_spiral(image_bytes)
            model_name = 'MobileNetV2 (spiral)'
        elif image_type == 'wave':
            model = load_wave_model()
            if model is None:
                return jsonify({'error': 'Wave model not available'}), 500
            processed_image = preprocess_for_wave(image_bytes)
            model_name = 'InceptionV3 (wave)'
        else:
            return jsonify({'error': f'Invalid image type: {image_type}'}), 400
        
        # Make prediction
        prediction = model(processed_image, training=False)
        sigmoid_value = float(prediction[0][0].numpy())
        
        # Interpret sigmoid output
        # Spiral model has inverted labels: high value = Parkinson's, low value = Healthy
        # Wave model: high value = Healthy, low value = Parkinson's
        if image_type == 'spiral':
            # INVERTED for spiral model
            parkinsons_score = sigmoid_value
            healthy_score = 1 - sigmoid_value
        else:
            # Normal for wave model
            healthy_score = sigmoid_value
            parkinsons_score = 1 - sigmoid_value
        
        # Determine label
        label = 'Parkinsons' if parkinsons_score > healthy_score else 'Healthy'
        confidence = max(parkinsons_score, healthy_score)
        
        return jsonify({
            'label': label,
            'confidence': confidence,
            'probabilities': {
                'Parkinsons': parkinsons_score,
                'Healthy': healthy_score
            },
            'raw_output': sigmoid_value,
            'modelInfo': {
                'name': model_name,
                'type': image_type,
                'inputShape': list(model.input_shape),
                'autoDetected': request.form.get('type', None) is None
            }
        })
        
    except Exception as e:
        print(f"Error during prediction: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== MongoDB API Endpoints ====================

# Authentication endpoints
@app.route('/api/auth/signup', methods=['POST'])
def signup():
    """User registration"""
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        full_name = data.get('full_name')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = mongodb_service.create_user(email, password, full_name)
        token = mongodb_service.generate_token(user['id'], user['email'])
        
        return jsonify({
            'data': {
                'user': user,
                'access_token': token,
            }
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/signin', methods=['POST'])
def signin():
    """User login"""
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = mongodb_service.authenticate_user(email, password)
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = mongodb_service.generate_token(user['id'], user['email'])
        
        return jsonify({
            'data': {
                'user': user,
                'access_token': token,
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/signout', methods=['POST'])
@require_auth
def signout(user_id):
    """User logout"""
    return jsonify({'message': 'Signed out successfully'})

@app.route('/api/auth/session', methods=['GET', 'OPTIONS'])
def get_session():
    """Get current session (optional auth - returns null if not authenticated)"""
    if request.method == 'OPTIONS':
        # Handle CORS preflight
        return '', 200
    
    user = get_user_from_token_optional()
    if user:
        return jsonify({
            'data': {
                'user': user,
            }
        })
    else:
        # Return null session instead of 401 - this is expected when not logged in
        return jsonify({
            'data': {
                'user': None,
            }
        }), 200

# Database endpoints
@app.route('/api/db/<collection>', methods=['GET'])
@require_auth
def db_get(collection, user_id):
    """Get documents from collection"""
    try:
        filter_dict = {}
        if request.args.get('filter'):
            import json
            filter_dict = json.loads(request.args.get('filter'))
        
        order_by = request.args.get('orderBy')
        order_direction = request.args.get('orderDirection', 'asc')
        single = request.args.get('single', 'false').lower() == 'true'
        
        if single:
            result = mongodb_service.find_one(collection, filter_dict, user_id)
            return jsonify({'data': result})
        else:
            results = mongodb_service.find_many(
                collection, filter_dict, user_id, order_by, order_direction
            )
            return jsonify({'data': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/<collection>', methods=['POST'])
@require_auth
def db_insert(collection, user_id):
    """Insert documents into collection"""
    try:
        data = request.json.get('data', [])
        if isinstance(data, dict):
            data = [data]
        
        if len(data) == 1:
            result = mongodb_service.insert_one(collection, data[0], user_id)
            return jsonify({'data': [result]}), 201
        else:
            results = mongodb_service.insert_many(collection, data, user_id)
            return jsonify({'data': results}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/<collection>', methods=['PATCH'])
@require_auth
def db_update(collection, user_id):
    """Update documents in collection"""
    try:
        data = request.json
        updates = data.get('updates', {})
        filter_dict = data.get('filter', {})
        
        success = mongodb_service.update_one(collection, filter_dict, updates, user_id)
        if success:
            return jsonify({'data': {'success': True}})
        else:
            return jsonify({'error': 'No document found or updated'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/<collection>', methods=['DELETE'])
@require_auth
def db_delete(collection, user_id):
    """Delete documents from collection"""
    try:
        data = request.json or {}
        filter_dict = data.get('filter', {})
        
        success = mongodb_service.delete_one(collection, filter_dict, user_id)
        if success:
            return jsonify({'data': {'success': True}})
        else:
            return jsonify({'error': 'No document found or deleted'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Storage endpoints
@app.route('/api/storage/upload', methods=['POST'])
@require_auth
def storage_upload(user_id):
    """Upload file to storage"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        bucket = request.form.get('bucket', 'test_artifacts')
        path = request.form.get('path')
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400
        
        file_data = file.read()
        result = mongodb_service.upload_file(bucket, path, file_data, user_id)
        
        return jsonify({'data': result}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/storage/<bucket>/<path:file_path>', methods=['GET'])
@require_auth
def storage_get(bucket, file_path, user_id):
    """Get file from storage"""
    try:
        file_data = mongodb_service.get_file_by_path(bucket, file_path)
        if not file_data:
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(
            io.BytesIO(file_data),
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name=os.path.basename(file_path)
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Pre-load models on startup
    print("\n" + "="*60)
    print("🚀 Multi-Model Parkinson's Detection API Server")
    print("="*60)
    
    # Initialize MongoDB connection
    try:
        print("\n📦 Initializing MongoDB connection...")
        # Connection is tested in MongoDBService.__init__
        print("✅ MongoDB ready")
    except Exception as e:
        print(f"❌ MongoDB initialization failed: {e}")
        print("   The server will start but database operations will fail.")
        print("   Make sure MongoDB is running and MONGODB_URI is correct.")
    
    print("\n🤖 Loading ML models...")
    load_spiral_model()
    load_wave_model()
    try:
        load_voice_assets()
        print("  ✓ Voice model loaded")
    except Exception as e:
        print(f"  ✗ Voice model unavailable: {e}")

    # Try loading the CNN model during startup
    try:
        load_voice_cnn()
    except Exception as e:
        pass
    
    print("\n📍 Server running on: http://localhost:5000")
    print("🔗 Health check: http://localhost:5000/health")
    print("📤 Prediction endpoint: POST http://localhost:5000/predict")
    print("🎙️ Voice endpoint: POST http://localhost:5000/api/voice/predict")
    print("🔐 Auth endpoints: /api/auth/signup, /api/auth/signin, /api/auth/session")
    print("💾 Database endpoints: /api/db/<collection>")
    print("\n  Supported types:")
    print("    - spiral: MobileNetV2 model")
    print("    - wave: InceptionV3 model")
    print("    - auto: Automatic detection")
    print("="*60 + "\n")
    
    print("============================================================")
    print("📍 Server running on: http://localhost:5000")
    print("🔗 Health check: http://localhost:5000/health")
    print("📤 Prediction endpoint: POST http://localhost:5000/predict")
    print("🎙️ Voice (CSV features): POST http://localhost:5000/api/voice/predict")
    print("🎙️ Voice (Audio CNN): POST http://localhost:5000/api/voice/predict-audio")
    print("============================================================")
    # Allows both IPv4 and IPv6 access
    app.run(host='::', port=5000, debug=True)
