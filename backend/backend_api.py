"""
Multi-Model Backend API for Parkinson's Detection
Supports both Spiral (MobileNetV2) and Wave (InceptionV3) models
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import tensorflow as tf
import numpy as np
from PIL import Image
import io
import os
import cv2
import h5py
import json
import sys
import warnings
from datetime import datetime
from mongodb_service import mongodb_service
from functools import wraps
from pathlib import Path
import importlib
import librosa
from therapy_service import therapy_service, TherapySession
from exercise_definitions import get_exercise_by_id, get_exercises_by_type, ExerciseType, get_default_session_plan
from exercise_validator import ExerciseValidator
from pose_detection import PoseDetector
import base64

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

tf_module, keras, KERAS_RUNTIME_MESSAGES = _initialise_keras_runtime()
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
PUBLIC_MODELS_DIR = ROOT_DIR / 'frontend'/ 'public' / 'models'
VOICE_DATASET_PATH = ROOT_DIR / 'frontend' / 'public' / 'data' / 'pd_speech_features.csv'
SPIRAL_MODEL_PATH_PUBLIC = PUBLIC_MODELS_DIR / 'parkinsons_spiral_mobilenetv2_final.keras'
WAVE_MODEL_PATH_PUBLIC = PUBLIC_MODELS_DIR / 'inception_wave_best.keras'
VOICE_CNN_MODEL_PATH = PUBLIC_MODELS_DIR / 'voice_melspec_mobilenetv2.h5'

# Legacy model paths kept as fallbacks
SPIRAL_MODEL_PATH_H5 = os.path.join(os.path.dirname(__file__), 'models', 'spiral', 'mobilenet_spiral_robust.h5')
WAVE_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'wave', 'inception_wave_v2.h5')

# Global model cache
models = {
    'spiral': None,
    'wave': None,
    'voice_cnn': None,
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

    # 2) Build model using tf.keras
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=tuple(input_shape),
        include_top=False,
        weights=None,
    )

    x = base_model.output
    for info in head_info:
        cls = info['class']
        name = info.get('name', '')
        if cls == 'GlobalAveragePooling2D':
            x = tf.keras.layers.GlobalAveragePooling2D(name=name)(x)
        elif cls == 'GlobalMaxPooling2D':
            x = tf.keras.layers.GlobalMaxPooling2D(name=name)(x)
        elif cls == 'Dropout':
            x = tf.keras.layers.Dropout(info.get('rate', 0.5), name=name)(x)
        elif cls == 'Dense':
            x = tf.keras.layers.Dense(
                info.get('units', 2),
                activation=info.get('activation', 'linear'),
                use_bias=info.get('use_bias', True),
                name=name,
            )(x)
        elif cls == 'BatchNormalization':
            x = tf.keras.layers.BatchNormalization(name=name)(x)
        elif cls == 'Flatten':
            x = tf.keras.layers.Flatten(name=name)(x)

    model = tf.keras.Model(inputs=base_model.input, outputs=x)
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
        print("Loading spiral model (MobileNetV2 Robust)...")
        try:
            if os.path.exists(SPIRAL_MODEL_PATH_H5):
                print(f"  Loading from .h5 format: {SPIRAL_MODEL_PATH_H5}")
                models['spiral'] = tf.keras.models.load_model(SPIRAL_MODEL_PATH_H5, compile=False)
                print(f"  ✓ Spiral model loaded: {models['spiral'].input_shape}")
            else:
                print(f"  ✗ No spiral model found at {SPIRAL_MODEL_PATH_H5}")
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
            models['wave'] = tf.keras.models.load_model(WAVE_MODEL_PATH, compile=False)
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

def __composite_with_white_bg(img):
    print("  [Pre-processing] Checking for transparency and composing with white background...")
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        alpha = img.convert('RGBA').split()[-1]
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=alpha)
        return bg
    if img.mode != 'RGB':
        return img.convert('RGB')
    return img

def enhance_image_quality(img):
    """
    Enhance drawing image quality visually (for metrics/reporting only, NOT for model inference).
    This should NOT be used as input to the AI neural networks since grayscale conversion
    and brightness manipulation change the pixel distribution and break the inversion check.
    """
    # 1. Resize to expected dimension
    print("  [Pre-processing] Resizing image to 224x224...")
    img = img.resize((224, 224))
    img_array = np.array(img, dtype=np.uint8)
    
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array
        
    # 2. Remove background noise (Non-Local Means Denoising)
    # Lowered h=5 so we don't accidentally smooth out Parkinsonian micro-tremors!
    print("  [Pre-processing] Applying gentle OpenCV Fast Non-Local Means Denoising to preserve pen tremors...")
    denoised = cv2.fastNlMeansDenoising(gray, None, h=5, templateWindowSize=7, searchWindowSize=21)
    
    # 3. Brighten background and increase contrast
    print("  [Pre-processing] Optimizing brightness and contrast (alpha=1.1, beta=15)...")
    # alpha configures contrast (1.1), beta configures brightness (15)
    enhanced = cv2.convertScaleAbs(denoised, alpha=1.1, beta=15)
    
    # Convert back to 3 channels since models expect RGB
    final_img = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB)
    
    print("  [Pre-processing] Image optimization complete ✅")
    return final_img

def preprocess_for_spiral(image_bytes):
    """Preprocess image for MobileNetV2 (spiral)"""
    img = Image.open(io.BytesIO(image_bytes))
    img = __composite_with_white_bg(img)
    print("  [Pre-processing] Resizing image to 224x224 (LANCZOS high quality)...")
    img = img.resize((224, 224), Image.LANCZOS)  # High-quality downsampling
    img_array = np.array(img, dtype=np.float32)
    
    # The robust spiral model was trained on black backgrounds with white lines.
    # If the uploaded image has a light/white background, invert it.
    mean_val = np.mean(img_array)
    print(f"  [Pre-processing] Image mean pixel value: {mean_val:.1f} — {'inverting (white bg detected)' if mean_val > 127 else 'keeping as-is (dark bg detected)'}")
    if mean_val > 127:
        img_array = 255.0 - img_array
        
    # MobileNetV2 preprocessing: normalize to [-1, 1]
    img_array = (img_array / 127.5) - 1.0
    img_array = np.expand_dims(img_array, axis=0)
    print("  [Pre-processing] Spiral pre-processing complete ✅")
    return img_array

def preprocess_for_wave(image_bytes):
    """Preprocess image for InceptionV3 (wave)"""
    img = Image.open(io.BytesIO(image_bytes))
    img = __composite_with_white_bg(img)
    print("  [Pre-processing] Resizing image to 224x224 (LANCZOS high quality)...")
    img = img.resize((224, 224), Image.LANCZOS)  # High-quality downsampling
    img_array = np.array(img, dtype=np.float32)
    # InceptionV3 preprocessing: normalize to [0, 1]
    img_array = img_array / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    print("  [Pre-processing] Wave pre-processing complete ✅")
    return img_array

def extract_drawing_metrics(image_bytes):
    """Extract physical metrics from the drawing using OpenCV to enrich the clinical reasoning"""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = __composite_with_white_bg(img)
        img = img.resize((400, 400))
        img_array = np.array(img, dtype=np.uint8)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        
        # Binarize strokes (adaptive for different drawing styles)
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
        
        # Density (line thickness/pressure)
        total_pixels = binary.shape[0] * binary.shape[1]
        stroke_pixels = cv2.countNonZero(binary)
        density = (stroke_pixels / total_pixels) * 100
        
        # Jitter/Tremor (amount of jagged edges compared to solid area)
        edges = cv2.Canny(gray, 50, 150)
        edge_pixels = cv2.countNonZero(edges)
        jitter = (edge_pixels / stroke_pixels) if stroke_pixels > 0 else 0
        
        # Fragmentation (broken lines)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        significant_contours = [c for c in contours if cv2.contourArea(c) > 20]
        fragmentation = len(significant_contours)
        
        return {
            'density': density,
            'jitter': jitter,
            'fragmentation': fragmentation
        }
    except Exception:
        return None

def validate_drawing_image(image_bytes, expected_type=None):
    """
    Detect if image is spiral or wave based on pattern characteristics
    Returns: (is_valid, error_message, detected_type)
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = __composite_with_white_bg(img)
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
        'voice_cnn_loaded': models.get('voice_cnn') is not None,
        'image_runtime_available': keras is not None,
        'image_runtime_error': IMAGE_RUNTIME_ERROR,
    })

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
        
        # Extract extension safely, default to .webm
        filename = audio_file.filename or 'recording.webm'
        ext = os.path.splitext(filename)[1].lower()
        if not ext:
            ext = '.webm'
            
        # Save temp file for librosa to load
        import tempfile
        import subprocess
        
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as temp_in:
            temp_in.write(audio_bytes)
            in_path = temp_in.name
            
        wav_path = in_path + '_converted.wav'
        target_audio_path = in_path
        
        try:
            # Try FFmpeg first for perfect conversion
            try:
                result = subprocess.run([
                    'ffmpeg', '-y', '-i', in_path, 
                    '-ar', '44100', '-ac', '1', wav_path
                ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if result.returncode == 0:
                    target_audio_path = wav_path
            except FileNotFoundError:
                # FFmpeg not installed, fallback to direct librosa loading
                pass
                
            y, sr = librosa.load(target_audio_path, sr=44100, mono=True)
            y, _ = librosa.effects.trim(y, top_db=20)
        finally:
            if os.path.exists(in_path):
                try: os.remove(in_path)
                except: pass
            if os.path.exists(wav_path):
                try: os.remove(wav_path)
                except: pass
                
        # Split into 5s chunks overlapping by 2.5s
        chunk_duration = 5.0
        chunk_samples = int(sr * chunk_duration)
        hop_length_samples = int(sr * 2.5)
        
        chunks = []
        
        # Handle recordings exactly as the training script does
        if len(y) < chunk_samples:
            pad_length = chunk_samples - len(y)
            y_padded = np.pad(y, (0, pad_length))
            chunks.append(y_padded)
        else:
            start = 0
            for start in range(0, len(y) - chunk_samples + 1, hop_length_samples):
                chunk = y[start:start + chunk_samples]
                if len(chunk) == chunk_samples:
                    chunks.append(chunk)

            # Capture the very end if more than 1 second of unique audio is left over
            if len(y) > chunk_samples and (len(y) - start - chunk_samples) > int(sr * 1.0):
                tail_start = len(y) - chunk_samples
                chunks.append(y[tail_start:])
                
        if len(chunks) == 0:
            return jsonify({'error': 'Audio is too short for analysis.'}), 400
                
        # Create spectrograms
        images = []
        for chunk in chunks:
            images.append(audio_to_melspec_image(chunk, sr))
            
        X = np.array(images, dtype=np.float32)
        X = keras.applications.mobilenet_v2.preprocess_input(X)
        
        # Run inference
        raw_predictions = model.predict(X)
        
        # Calculate Ensemble Majority Voting
        votes = (raw_predictions > 0.5).astype(int).flatten()
        pd_votes = int(np.sum(votes))
        total_votes = len(votes)
        
        avg_prob = float(np.mean(raw_predictions))
        is_pd = pd_votes > (total_votes / 2)
        
        return jsonify({
            'label': 'Parkinsons' if is_pd else 'Healthy',
            'probabilityOfParkinsons': avg_prob,
            'confidence': avg_prob if is_pd else (1 - avg_prob),
            'chunkVotes': {
                'total': total_votes,
                'parkinsons': pd_votes,
                'healthy': total_votes - pd_votes
            },
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
        # Spiral model: HIGH sigmoid = Parkinson's, LOW = Healthy
        # Wave model:   HIGH sigmoid = Healthy, LOW = Parkinson's
        print(f"  [Model] Raw sigmoid output: {sigmoid_value:.4f}")
        if image_type == 'spiral':
            parkinsons_score = sigmoid_value
            healthy_score = 1 - sigmoid_value
        else:
            healthy_score = sigmoid_value
            parkinsons_score = 1 - sigmoid_value
        print(f"  [Model] Parkinsons score: {parkinsons_score:.4f}, Healthy score: {healthy_score:.4f}")
        
        # Determine label
        label = 'Parkinsons' if parkinsons_score > healthy_score else 'Healthy'
        confidence = max(parkinsons_score, healthy_score)
        
        # Extract CV metrics for hyper-dynamic reasoning
        metrics = extract_drawing_metrics(image_bytes)
        jitter = metrics['jitter'] if metrics else 0.5
        frag = metrics['fragmentation'] if metrics else 1
        
        # Generate reasoning based on prediction confidence AND visual metrics
        reasoning = ""
        if image_type == 'spiral':
            if label == 'Parkinsons':
                frag_text = f" and {frag} fragmented stroke breaks" if frag > 2 else ""
                jitter_text = "high-frequency edge jitter" if jitter > 0.8 else "irregular wobble patterns"
                
                if confidence > 0.90:
                    reasoning = f"The model detected severe {jitter_text}{frag_text} across multiple turns. These dense, highly irregular spacings are strong clinical indicators of Parkinsonian micrographics (Confidence: {confidence*100:.1f}%)."
                elif confidence > 0.70:
                    reasoning = f"Moderate irregularities were identified, specifically {jitter_text}{frag_text}. This suggests mild, early-stage Parkinson's disease resting tremors affecting fine motor control (Confidence: {confidence*100:.1f}%)."
                else:
                    reasoning = f"Slight spatial deviations and sporadic {jitter_text} were observed in the radial tracking, indicating borderline or preliminary signs of Parkinson's (Confidence: {confidence*100:.1f}%)."
            else:
                flow_text = "excellent continuous flow" if frag <= 2 else "generally consistent strokes"
                if confidence > 0.90:
                    reasoning = f"The spiral exhibits solid radial tracking, {flow_text}, and absolutely no disease-related tremors, strongly indicating healthy fine motor control (Confidence: {confidence*100:.1f}%)."
                elif confidence > 0.70:
                    reasoning = f"The drawing maintains good overall smoothness ({flow_text}). While minor natural hesitancies were found, no clinical Parkinsonian tremors were detected (Confidence: {confidence*100:.1f}%)."
                else:
                    reasoning = f"The analysis ruled out significant rest tremors, though minor {jitter > 0.8 and 'edge jitters' or 'spatial irregularities'} dropped the confidence slightly. Overall motor control appears healthy (Confidence: {confidence*100:.1f}%)."
        else:
            if label == 'Parkinsons':
                frag_text = f" {frag} distinct freezing artifacts" if frag > 1 else "micrographic patterns"
                if confidence > 0.90:
                    reasoning = f"The model detected severe irregular amplitude and{frag_text} in the sine wave. These jagged accelerations strongly indicate Parkinson's disease (Confidence: {confidence*100:.1f}%)."
                elif confidence > 0.70:
                    reasoning = f"Moderate amplitude variations were detected along with suspected freezing hesitations, suggesting mild Parkinsonian symptoms in handwriting (Confidence: {confidence*100:.1f}%)."
                else:
                    reasoning = f"Slight vertical irregularities were observed in the wave amplitude, indicating early or borderline signs of Parkinson's rather than smooth action tremors (Confidence: {confidence*100:.1f}%)."
            else:
                if confidence > 0.90:
                    reasoning = f"The wave pattern is beautifully preserved with consistent amplitude and minimal edge jitter. This smoothly continuous flow strongly indicates healthy motor control (Confidence: {confidence*100:.1f}%)."
                elif confidence > 0.70:
                    reasoning = f"The wave maintains good overall vertical consistency with only natural, non-clinical variations in amplitude (Confidence: {confidence*100:.1f}%)."
                else:
                    reasoning = f"While generally consistent in amplitude, some minor hesitations occur; however, no significant disease-related freezing artifacts were evaluated (Confidence: {confidence*100:.1f}%)."
        
        return jsonify({
            'label': label,
            'confidence': confidence,
            'reasoning': reasoning,
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
        gender = data.get('gender')
        date_of_birth = data.get('date_of_birth')
        weight = data.get('weight')
        height = data.get('height')
        clinical_stage = data.get('clinical_stage')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = mongodb_service.create_user(email, password, full_name, gender, date_of_birth, weight, height, clinical_stage)
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
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        mongodb_service.revoke_token(token)
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
    print(f"\n[DB API] Received GET request for collection: {collection}, user_id: {user_id}")
    try:
        filter_dict = {}
        if request.args.get('filter'):
            import json
            filter_dict = json.loads(request.args.get('filter'))
            print(f"  [DB API] filter: {filter_dict}")
        
        order_by = request.args.get('orderBy')
        order_direction = request.args.get('orderDirection', 'asc')
        single = request.args.get('single', 'false').lower() == 'true'
        
        if single:
            result = mongodb_service.find_one(collection, filter_dict, user_id)
            print(f"  [DB API] Returning 1 item")
            return jsonify({'data': result})
        else:
            results = mongodb_service.find_many(
                collection, filter_dict, user_id, order_by, order_direction
            )
            print(f"  [DB API] Returning {len(results)} items")
            return jsonify({'data': results})
    except Exception as e:
        print(f"  [DB API] ERROR in GET: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/<collection>', methods=['POST'])
@require_auth
def db_insert(collection, user_id):
    """Insert documents into collection"""
    print(f"\n[DB API] Received insert request for collection: {collection}")
    try:
        data = request.json.get('data', [])
        if isinstance(data, dict):
            data = [data]
            
        print(f"  [DB API] Payload size: {len(data)} items")
        
        if len(data) == 1:
            result = mongodb_service.insert_one(collection, data[0], user_id)
            print(f"  [DB API] Insert successful, ID: {result.get('id')}")
            return jsonify({'data': [result]}), 201
        else:
            results = mongodb_service.insert_many(collection, data, user_id)
            print(f"  [DB API] Insert many successful, {len(results)} items")
            return jsonify({'data': results}), 201
    except Exception as e:
        print(f"  [DB API] ERROR during insert: {str(e)}")
        import traceback
        traceback.print_exc()
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

# ============================================================================
# THERAPY API ENDPOINTS
# ============================================================================

@app.route('/api/therapy/exercises', methods=['GET'])
@require_auth
def get_exercises(user_id):
    """Get all available exercises"""
    try:
        exercise_type = request.args.get('type')  # 'warm_up', 'main', 'cool_down'
        
        if exercise_type:
            ex_type = ExerciseType(exercise_type)
            exercises = get_exercises_by_type(ex_type)
        else:
            from exercise_definitions import EXERCISES
            exercises = list(EXERCISES.values())
        
        exercises_data = [
            {
                'id': ex.id,
                'name': ex.name,
                'description': ex.description,
                'type': ex.type.value,
                'duration_seconds': ex.duration_seconds,
                'target_reps': ex.target_reps,
                'angle_ranges': ex.angle_ranges,
                'posture_rules': ex.posture_rules
            }
            for ex in exercises
        ]
        
        return jsonify({'data': exercises_data}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/therapy/session/start', methods=['POST'])
@require_auth
def start_therapy_session(user_id):
    """Start a new therapy session"""
    try:
        data = request.get_json() or {}
        exercise_ids = data.get('exercise_ids')  # Optional: custom exercise list
        
        session = therapy_service.create_session(user_id, exercise_ids)
        
        current_ex = session.get_current_exercise()
        
        return jsonify({
            'data': {
                'session_id': session.session_id,
                'current_exercise': {
                    'id': current_ex.id,
                    'name': current_ex.name,
                    'description': current_ex.description,
                    'target_reps': current_ex.target_reps,
                    'duration_seconds': current_ex.duration_seconds
                } if current_ex else None,
                'total_exercises': len(session.exercises),
                'start_time': session.start_time.isoformat()
            }
        }), 201
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error starting therapy session: {error_trace}")
        return jsonify({'error': str(e), 'traceback': error_trace}), 500

@app.route('/api/therapy/session/<session_id>/analyze', methods=['POST'])
@require_auth
def analyze_pose(user_id, session_id):
    """Analyze pose from video frame and provide feedback"""
    try:
        session = therapy_service.get_session(session_id)
        if not session:
            print(f"[ANALYZE] Session not found: {session_id}")
            print(f"[ANALYZE] Active sessions: {list(therapy_service.active_sessions.keys())}")
            return jsonify({'error': 'Session not found', 'code': 'SESSION_NOT_FOUND'}), 404
        
        if session.user_id != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'error': 'Image data required'}), 400
        
        # Decode base64 image
        image_data = data['image']
        if image_data.startswith('data:image'):
            image_data = image_data.split(',')[1]
        
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({'error': 'Invalid image data'}), 400
        
        # Detect pose
        result = session.pose_detector.detect_landmarks(image)
        
        # Get current exercise info for response
        current_ex = session.get_current_exercise()
        current_reps = current_ex.completed_reps if current_ex else 0
        target_reps = current_ex.target_reps if current_ex else 0
        
        if not result:
            return jsonify({
                'data': {
                    'status': 'no_pose',
                    'message': 'Please position yourself in front of the camera',
                    'feedback_type': None,
                    'is_valid': False,
                    'rep_completed': False,
                    'current_reps': current_reps,
                    'target_reps': target_reps,
                    'progress': session.validator.get_progress()
                }
            }), 200
        
        landmarks = result['landmarks']
        
        # Check visibility
        if not session.pose_detector.check_visibility(landmarks):
            return jsonify({
                'data': {
                    'status': 'low_visibility',
                    'message': 'Please move closer to the camera so I can see your shoulders and hips',
                    'feedback_type': None,
                    'is_valid': False,
                    'rep_completed': False,
                    'current_reps': current_reps,
                    'target_reps': target_reps,
                    'progress': session.validator.get_progress()
                }
            }), 200
        
        # Calculate angles
        angles = session.pose_detector.get_joint_angles(landmarks)
        
        # Get feedback
        prev_angles = session.validator.last_angles
        feedback = session.validator.get_feedback(angles, landmarks, prev_angles)
        session.validator.last_angles = angles.copy()
        
        # Log feedback periodically
        total_feedback = session.feedback_count['correct'] + session.feedback_count['needs_correction']
        if total_feedback % 10 == 0:  # Log every 10th frame
            ex_name = current_ex.name if current_ex else 'none'
            print(f"[ANALYZE] Exercise: {ex_name} | Status: {feedback['status']} | Reps: {current_reps}/{target_reps} | Angles: {dict(list(angles.items())[:3])}")
        
        # Update feedback count
        if feedback['status'] == 'correct' or feedback['status'] == 'rep_completed':
            session.feedback_count['correct'] += 1
        elif feedback['status'] == 'needs_correction':
            session.feedback_count['needs_correction'] += 1
        
        # Check if exercise is complete
        exercise_complete = False
        if current_ex:
            # Complete if target reps reached
            if current_ex.completed_reps >= current_ex.target_reps:
                exercise_complete = True
                print(f"[ANALYZE] Exercise '{current_ex.name}' complete! Reps: {current_ex.completed_reps}")
            # Or time exceeded
            elif current_ex.start_time:
                elapsed = (datetime.now() - current_ex.start_time).total_seconds()
                if elapsed >= current_ex.duration_seconds:
                    exercise_complete = True
                    print(f"[ANALYZE] Exercise '{current_ex.name}' time up! Elapsed: {elapsed:.0f}s / {current_ex.duration_seconds}s")
        
        # Encode annotated image
        annotated_image = result['image']
        _, buffer = cv2.imencode('.jpg', annotated_image)
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'data': {
                **feedback,
                'exercise_complete': exercise_complete,
                'annotated_image': f'data:image/jpeg;base64,{annotated_base64}',
                'angles': angles,
                'progress': session.validator.get_progress()
            }
        }), 200
    except Exception as e:
        import traceback
        print(f"[ANALYZE] Error: {traceback.format_exc()}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/therapy/session/<session_id>/next', methods=['POST'])
@require_auth
def next_exercise(user_id, session_id):
    """Move to next exercise in session"""
    try:
        session = therapy_service.get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        if session.user_id != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        has_next = session.move_to_next_exercise()
        current_ex = session.get_current_exercise()
        
        return jsonify({
            'data': {
                'has_next': has_next,
                'session_complete': not has_next,
                'current_exercise': {
                    'id': current_ex.id,
                    'name': current_ex.name,
                    'description': current_ex.description,
                    'target_reps': current_ex.target_reps,
                    'duration_seconds': current_ex.duration_seconds
                } if current_ex else None,
                'exercise_index': session.current_exercise_index,
                'total_exercises': len(session.exercises)
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/therapy/session/<session_id>/end', methods=['POST'])
@require_auth
def end_therapy_session(user_id, session_id):
    """End therapy session and get summary"""
    try:
        session = therapy_service.get_session(session_id)
        if not session:
            # Session doesn't exist - return a basic summary instead of error
            return jsonify({
                'data': {
                    'session': None,
                    'milestones': [],
                    'summary': {
                        'total_reps': 0,
                        'total_duration_minutes': 0,
                        'accuracy_score': 0,
                        'exercises_completed': 0
                    }
                }
            }), 200
        
        if session.user_id != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        # Complete session
        session.complete_session()
        
        # Detect milestones
        milestones = therapy_service.detect_milestones(user_id, session)
        
        # Save session data before removing it
        session_data = session.to_dict()
        exercises_completed = len([ex for ex in session.exercises if hasattr(ex.status, 'value') and ex.status.value == 'completed'])
        
        # End session (removes from active_sessions)
        therapy_service.end_session(session_id)
        
        return jsonify({
            'data': {
                'session': session_data,
                'milestones': milestones,
                'summary': {
                    'total_reps': session_data.get('total_reps', 0),
                    'total_duration_minutes': round(session_data.get('total_duration_seconds', 0) / 60, 1),
                    'accuracy_score': round(session_data.get('accuracy_score', 0), 1),
                    'exercises_completed': exercises_completed
                }
            }
        }), 200
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error ending therapy session: {error_trace}")
        return jsonify({'error': str(e), 'traceback': error_trace}), 500

@app.route('/api/therapy/session/<session_id>/progress', methods=['GET'])
@require_auth
def get_session_progress(user_id, session_id):
    """Get current session progress"""
    try:
        session = therapy_service.get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        if session.user_id != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        current_ex = session.get_current_exercise()
        elapsed = (datetime.now() - session.start_time).total_seconds()
        
        return jsonify({
            'data': {
                'session_id': session.session_id,
                'status': session.status,
                'elapsed_seconds': elapsed,
                'current_exercise': {
                    'id': current_ex.id,
                    'name': current_ex.name,
                    'completed_reps': current_ex.completed_reps,
                    'target_reps': current_ex.target_reps
                } if current_ex else None,
                'exercise_index': session.current_exercise_index,
                'total_exercises': len(session.exercises),
                'progress': session.validator.get_progress()
            }
        }), 200
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
    
    # Try loading the CNN model during startup
    try:
        load_voice_cnn()
        if models.get('voice_cnn') is not None:
             print("  ✓ Voice CNN model loaded")
        else:
             print("  ⚠ Voice CNN model file not found")
    except Exception as e:
        print(f"  ⚠ Voice CNN model unavailable: {e}")
    
    print("\n📍 Server running on: http://localhost:5000")
    print("🔗 Health check: http://localhost:5000/health")
    print("📤 Prediction endpoint: POST http://localhost:5000/predict")
    print("🎙️ Voice CNN endpoint: POST http://localhost:5000/api/voice/predict-audio")
    print("🔐 Auth endpoints: /api/auth/signup, /api/auth/signin, /api/auth/session")
    print("💾 Database endpoints: /api/db/<collection>")
    print("\n  Supported types:")
    print("    - spiral: MobileNetV2 model")
    print("    - wave: InceptionV3 model")
    print("    - auto: Automatic detection")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
