"""
Multi-Model Backend API for Parkinson's Detection
Supports both Spiral (MobileNetV2) and Wave (InceptionV3) models
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import tensorflow as tf
import numpy as np
from PIL import Image
import io
import os
import re
import time
import requests
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
from dotenv import load_dotenv

_backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_backend_dir, '.env'))

try:
    from sklearn.exceptions import InconsistentVersionWarning
except Exception:
    InconsistentVersionWarning = Warning

app = Flask(__name__)
CORS(
    app,
    resources={r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}},
    methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
socketio = SocketIO(
    app,
    cors_allowed_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    async_mode='threading',
)
connected_socket_users = {}

def _cors_preflight_response():
    response = jsonify({'ok': True})
    response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', 'http://localhost:5173'))
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    return response

@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS' and request.path.startswith('/api/'):
        return _cors_preflight_response()

@app.after_request
def add_cors_headers(response):
    if request.path.startswith('/api/'):
        response.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', 'http://localhost:5173')
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,OPTIONS'
    return response

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

def get_user_from_token_value(token):
    """Resolve a user from a raw bearer token value."""
    if not token:
        return None
    if token.startswith('Bearer '):
        token = token.split(' ', 1)[1]
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

def require_role(*roles):
    """Decorator to require one of the specified roles."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user = get_user_from_token()
            if not user:
                return jsonify({'error': 'Unauthorized'}), 401
            if user.get('role') not in roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs, user_id=user['id'], current_user=user)
        return decorated_function
    return decorator

def _build_patient_snapshot(patient_id):
    user = mongodb_service.get_user_by_id(patient_id) or {}
    profile = mongodb_service.get_patient_profile_details(patient_id) or {}
    return {
        'id': patient_id,
        'full_name': user.get('full_name') or profile.get('full_name') or 'Patient',
        'email': user.get('email'),
        'phone': user.get('phone') or profile.get('phone'),
        'gender': profile.get('gender'),
        'date_of_birth': profile.get('date_of_birth'),
        'age': profile.get('age'),
        'weightKg': profile.get('weightKg'),
        'heightCm': profile.get('heightCm'),
        'stage': profile.get('stage'),
        'bmi': profile.get('bmi'),
        'bmiClass': profile.get('bmiClass'),
    }

def _build_doctor_snapshot(doctor_id):
    doctor = mongodb_service.get_user_by_id(doctor_id) or {}
    return {
        'id': doctor_id,
        'full_name': doctor.get('full_name') or 'Doctor',
        'email': doctor.get('email'),
        'phone': doctor.get('phone'),
        'hospital': doctor.get('hospital'),
        'specialties': doctor.get('specialties', []),
        'doctor_identifier': doctor.get('doctor_identifier'),
        'age': doctor.get('age'),
        'gender': doctor.get('gender'),
        'qualification': doctor.get('qualification'),
        'years_experience': doctor.get('years_experience'),
        'availability_slots': doctor.get('availability_slots', []),
        'approval_status': doctor.get('approval_status'),
    }

def _appointment_status_rank(status):
    normalized = (status or '').strip().lower()
    priority = {
        'accepted': 7,
        'rescheduled': 6,
        'pending': 5,
        'reviewed': 4,
        'completed': 3,
        'rejected': 1,
        'cancelled': 0,
    }
    return priority.get(normalized, 2)

def _appointment_timestamp_value(appointment):
    raw_value = appointment.get('updated_at') or appointment.get('created_at')
    if isinstance(raw_value, datetime):
        return raw_value.timestamp()
    if isinstance(raw_value, str):
        try:
            return datetime.fromisoformat(raw_value.replace('Z', '+00:00')).timestamp()
        except Exception:
            return 0
    return 0

def _select_primary_appointment(appointments):
    if not appointments:
        return None

    return sorted(
        appointments,
        key=lambda item: (_appointment_status_rank(item.get('status')), _appointment_timestamp_value(item)),
        reverse=True,
    )[0]

def _collapse_appointments(appointments):
    grouped = {}
    for appointment in appointments:
        key = appointment.get('report_id') or appointment.get('id')
        if not key:
            continue
        existing = grouped.get(key)
        if not existing:
            grouped[key] = appointment
            continue
        grouped[key] = _select_primary_appointment([existing, appointment])

    return sorted(grouped.values(), key=lambda item: _appointment_timestamp_value(item), reverse=True)

def _build_ai_results(patient_id, preferred_test_id=None):
    tests = mongodb_service.list_tests_for_patient(patient_id, limit=20)
    if not tests:
        return None, None

    source_test = None
    if preferred_test_id:
        source_test = next((test for test in tests if test.get('id') == preferred_test_id), None)

    if source_test is None:
        source_test = next((test for test in tests if test.get('test_type') == 'fusion'), None)

    if source_test is None:
        source_test = tests[0]

    recent_tests = []
    for test in tests[:5]:
        recent_tests.append({
            'id': test.get('id'),
            'test_type': test.get('test_type'),
            'created_at': test.get('created_at'),
            'confidence': test.get('confidence'),
            'result': test.get('result'),
            'model_versions': test.get('model_versions'),
        })

    result = source_test.get('result') or {}
    ai_results = {
        'sourceTestId': source_test.get('id'),
        'sourceTestType': source_test.get('test_type'),
        'generatedAt': source_test.get('created_at'),
        'summary': {
            'label': result.get('label'),
            'riskLevel': result.get('riskLevel'),
            'riskScore': result.get('riskScore'),
            'confidence': result.get('confidence', source_test.get('confidence')),
        },
        'fusion': result if source_test.get('test_type') == 'fusion' else None,
        'recentTests': recent_tests,
    }
    return ai_results, source_test

def _ensure_unified_report(patient_id, report_id=None, preferred_test_id=None):
    if report_id:
        report = mongodb_service.get_report_by_id(report_id)
        if report and report.get('patient_id') == patient_id:
            return report

    if preferred_test_id:
        existing = mongodb_service.find_report({
            'patient_id': patient_id,
            'test_id': preferred_test_id,
        })
        if existing:
            return existing

    ai_results, source_test = _build_ai_results(patient_id, preferred_test_id)
    if not ai_results or not source_test:
        raise ValueError('No AI results available to build a report')

    existing = mongodb_service.find_report({
        'patient_id': patient_id,
        'test_id': source_test.get('id'),
    })
    if existing:
        merged_updates = {
            'patientDetails': _build_patient_snapshot(patient_id),
            'aiResults': ai_results,
        }
        return mongodb_service.update_report(existing['id'], merged_updates)

    report_doc = {
        'patient_id': patient_id,
        'test_id': source_test.get('id'),
        'patientDetails': _build_patient_snapshot(patient_id),
        'aiResults': ai_results,
        'doctorNotes': '',
        'prescription': [],
        'suggestions': '',
        'status': 'pending',
        'doctor_id': None,
        'doctorDetails': None,
    }
    return mongodb_service.create_report(report_doc)

def _serialize_report_for_user(report):
    if not report:
        return report

    serialized = dict(report)
    linked_appointments = mongodb_service.list_appointments({'report_id': report.get('id')})
    if linked_appointments:
        linked_appointment = _select_primary_appointment(linked_appointments)
        if not serialized.get('appointment_id'):
            serialized['appointment_id'] = linked_appointment.get('id')
        if not serialized.get('doctor_id'):
            serialized['doctor_id'] = linked_appointment.get('doctor_id')
        if not serialized.get('doctorDetails') and linked_appointment.get('doctor_id'):
            serialized['doctorDetails'] = _build_doctor_snapshot(linked_appointment.get('doctor_id'))

    return serialized

def _serialize_appointment_for_user(appointment):
    report = mongodb_service.get_report_by_id(appointment.get('report_id')) if appointment.get('report_id') else None
    patient = _build_patient_snapshot(appointment.get('patient_id'))
    doctor = _build_doctor_snapshot(appointment.get('doctor_id')) if appointment.get('doctor_id') else None
    return {
        **appointment,
        'patientDetails': patient,
        'doctorDetails': doctor,
        'report': _serialize_report_for_user(report) if report else None,
    }

def _can_access_appointment(current_user, appointment):
    if not current_user or not appointment:
        return False
    if current_user.get('role') == 'admin':
        return True
    if current_user.get('role') == 'patient' and appointment.get('patient_id') == current_user.get('id'):
        return True
    if current_user.get('role') == 'doctor' and appointment.get('doctor_id') == current_user.get('id'):
        return True
    return False

def _appointment_allows_live_access(appointment):
    return appointment and appointment.get('status') in ['accepted', 'completed']

def _socket_room_name(appointment_id):
    return f"appointment:{appointment_id}"

@socketio.on('connect')
def handle_socket_connect(auth):
    """Authenticate websocket connections using the same bearer token."""
    token = None
    if isinstance(auth, dict):
        token = auth.get('token')

    if not token:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ', 1)[1]

    user = get_user_from_token_value(token)
    if not user:
        return False

    connected_socket_users[request.sid] = user
    emit('socket_ready', {
        'userId': user.get('id'),
        'role': user.get('role'),
    })

@socketio.on('disconnect')
def handle_socket_disconnect():
    connected_socket_users.pop(request.sid, None)

@socketio.on('join_appointment')
def handle_join_appointment(data):
    """Join an appointment-specific room for live chat."""
    current_user = connected_socket_users.get(request.sid)
    appointment_id = (data or {}).get('appointmentId')

    if not current_user:
        emit('appointment_join_error', {'error': 'Unauthorized'})
        return
    if not appointment_id:
        emit('appointment_join_error', {'error': 'appointmentId is required'})
        return

    appointment = mongodb_service.get_appointment_by_id(appointment_id)
    if not appointment:
        emit('appointment_join_error', {'error': 'Appointment not found'})
        return
    if not _can_access_appointment(current_user, appointment):
        emit('appointment_join_error', {'error': 'Forbidden'})
        return
    if not _appointment_allows_live_access(appointment):
        emit('appointment_join_error', {'error': 'Appointment is awaiting doctor acceptance'})
        return

    join_room(_socket_room_name(appointment_id))
    emit('appointment_joined', {'appointmentId': appointment_id})

@socketio.on('leave_appointment')
def handle_leave_appointment(data):
    appointment_id = (data or {}).get('appointmentId')
    if appointment_id:
        leave_room(_socket_room_name(appointment_id))

@socketio.on('send_appointment_message')
def handle_send_appointment_message(data):
    """Persist and broadcast a live appointment chat message."""
    current_user = connected_socket_users.get(request.sid)
    payload = data or {}
    appointment_id = payload.get('appointmentId')
    message = (payload.get('message') or '').strip()

    if not current_user:
        return {'ok': False, 'error': 'Unauthorized'}
    if not appointment_id:
        return {'ok': False, 'error': 'appointmentId is required'}
    if not message:
        return {'ok': False, 'error': 'Message is required'}

    appointment = mongodb_service.get_appointment_by_id(appointment_id)
    if not appointment:
        return {'ok': False, 'error': 'Appointment not found'}
    if not _can_access_appointment(current_user, appointment):
        return {'ok': False, 'error': 'Forbidden'}
    if not _appointment_allows_live_access(appointment):
        return {'ok': False, 'error': 'Appointment is awaiting doctor acceptance'}

    created = mongodb_service.create_chat_message({
        'appointment_id': appointment_id,
        'report_id': appointment.get('report_id'),
        'sender_id': current_user.get('id'),
        'sender_role': current_user.get('role'),
        'sender_name': current_user.get('full_name') or current_user.get('email') or 'User',
        'message': message,
    })
    socketio.emit('appointment_message', created, room=_socket_room_name(appointment_id))
    return {'ok': True, 'data': created}

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
VOICE_MODEL_PATH_H5 = os.path.join(os.path.dirname(__file__), 'models', 'Voice', 'voice_melspec_mobilenetv2.h5')
VOICE_SAMPLE_RATE = 22050
VOICE_NFFT = 2048
VOICE_HOP_LENGTH = 512
VOICE_TOP_DB = 80.0
VOICE_TRIM_TOP_DB = 45
VOICE_MIN_DURATION_SECONDS = 2.0
VOICE_POSITIVE_THRESHOLD = 0.65
VOICE_BORDERLINE_MARGIN = 0.12
VOICE_SIGMOID_POSITIVE_CLASS = os.getenv('VOICE_SIGMOID_POSITIVE_CLASS', 'parkinsons').strip().lower()
if VOICE_SIGMOID_POSITIVE_CLASS not in ('parkinsons', 'healthy'):
    VOICE_SIGMOID_POSITIVE_CLASS = 'parkinsons'

# Global model cache
models = {
    'spiral': None,
    'wave': None,
    'voice': None
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

def load_voice_model():
    """Load MobileNetV2 voice model for melspectrogram classification"""
    if models['voice'] is None:
        print("Loading voice model (MobileNetV2)...")
        try:
            models['voice'] = tf.keras.models.load_model(VOICE_MODEL_PATH_H5, compile=False)
            print(f"  ✓ Voice model loaded: {models['voice'].input_shape}")
        except Exception as e:
            print(f"  ✗ Error loading voice model: {e}")
            return None
    return models['voice']

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

def preprocess_for_voice(audio_bytes, model_input_shape=None):
    """Preprocess audio file to the actual expected input shape for the voice model."""
    try:
        import librosa
        import soundfile as sf
    except ImportError:
        raise ImportError("librosa and soundfile are required for voice processing. Install with: pip install librosa soundfile")

    try:
        print("  [Voice Pre-processing] Loading audio file...")
        audio_data, sr = librosa.load(io.BytesIO(audio_bytes), sr=VOICE_SAMPLE_RATE, mono=True)
        print(f"  [Voice Pre-processing] Audio loaded: {len(audio_data)/sr:.2f}s at {sr}Hz")

        # Remove long leading / trailing silence so quiet room noise does not dominate.
        audio_data, _ = librosa.effects.trim(audio_data, top_db=VOICE_TRIM_TOP_DB)
        print(f"  [Voice Pre-processing] After silence trim: {len(audio_data)/sr:.2f}s")

        min_samples = int(sr * VOICE_MIN_DURATION_SECONDS)
        if len(audio_data) < min_samples:
            # Keep processing by padding short clips instead of failing intermittently.
            pad_amount = min_samples - len(audio_data)
            audio_data = np.pad(audio_data, (0, pad_amount), mode='constant')
            print(f"  [Voice Pre-processing] Padded short sample by {pad_amount} samples")

        peak = float(np.max(np.abs(audio_data))) if len(audio_data) else 0.0
        if peak < 1e-4:
            raise ValueError("Voice sample is too quiet. Please speak closer to the microphone and try again.")

        # Peak-normalize to reduce microphone loudness variation across users.
        audio_data = (audio_data / peak).astype(np.float32)

        # Infer target tensor shape from the loaded model. The current MobileNetV2
        # voice model expects image-like tensors such as (None, 224, 224, 3).
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

        print(f"  [Voice Pre-processing] Target model shape: ({target_height}, {target_width}, {target_channels})")

        # Build a mel image that already matches the model's vertical resolution,
        # then pad/crop only along time to keep the frequency axis semantically stable.
        print("  [Voice Pre-processing] Computing mel-spectrogram...")
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
                mode='constant',
                constant_values=-VOICE_TOP_DB,
            )
        elif current_width > target_width:
            start = (current_width - target_width) // 2
            mel_spec_db = mel_spec_db[:, start:start + target_width]

        # Stable normalization: map [-top_db, 0] -> [0, 1].
        mel_spec_normalized = np.clip((mel_spec_db + VOICE_TOP_DB) / VOICE_TOP_DB, 0.0, 1.0).astype(np.float32)

        # Convert to channel layout expected by the model.
        if target_channels == 1:
            model_input = np.expand_dims(mel_spec_normalized, axis=-1)
            # Keep single-channel tensors normalized to [0, 1].
        else:
            model_input = np.stack([mel_spec_normalized] * target_channels, axis=-1)
            # MobileNet-style backbones are typically trained with preprocess_input.
            model_input = tf.keras.applications.mobilenet_v2.preprocess_input(model_input * 255.0)

        model_input = np.expand_dims(model_input.astype(np.float32), axis=0)

        print(f"  [Voice Pre-processing] Melspectrogram shape: {model_input.shape}")
        print("  [Voice Pre-processing] Voice pre-processing complete ✅")
        return model_input

    except Exception as e:
        print(f"  [Voice Pre-processing] Error: {e}")
        raise

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


def _parse_gemini_text(payload):
    """Extract plain text from Gemini generateContent JSON."""
    candidates = payload.get('candidates') or []
    if not candidates:
        return ''
    parts = (candidates[0].get('content') or {}).get('parts')
    if not isinstance(parts, list):
        return ''
    texts = []
    for p in parts:
        if isinstance(p, dict) and isinstance(p.get('text'), str):
            texts.append(p['text'])
    return ' '.join(texts).strip()


def _gemini_error_message(payload, raw_text):
    if isinstance(payload, dict):
        err = payload.get('error')
        if isinstance(err, dict) and err.get('message'):
            return str(err['message'])
        if isinstance(err, str):
            return err
    return raw_text or ''


def _gemini_quota_zero(error_text):
    t = error_text or ''
    if re.search(r'resource_exhausted|quota exceeded|exceeded your current quota', t, re.I):
        return True
    return bool(
        re.search(r'limit:\s*0\b', t)
        and re.search(r'quota|free_tier|generativelanguage', t, re.I)
    )


def _parse_retry_seconds(error_text):
    if not error_text:
        return None
    m = re.search(r'retry\s+in\s+([\d.]+)\s*s', error_text, re.I)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def _gemini_model_candidates():
    """Ordered list of model ids to try (404 on one id is common as Google renames/retires models)."""
    primary = (os.environ.get('GEMINI_MODEL') or 'gemini-2.0-flash-lite').strip()
    built_in = [
        primary,
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash',
    ]
    extra = (os.environ.get('GEMINI_MODEL_FALLBACKS') or '').split(',')
    for x in extra:
        x = x.strip()
        if x:
            built_in.append(x)
    seen = set()
    out = []
    for m in built_in:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _quota_offline_fallback_enabled():
    """When Gemini returns no quota, return a canned reply instead of HTTP 503 (default: on)."""
    v = (os.environ.get('GEMINI_OFFLINE_FALLBACK_ON_QUOTA') or 'true').strip().lower()
    return v not in ('0', 'false', 'no', 'off')


def _last_user_message_text(slice_messages):
    for m in reversed(slice_messages or []):
        if m.get('from') == 'user':
            return (m.get('text') or '').strip()
    return ''


def _offline_chat_reply(user_text: str) -> str:
    """Simple keyword-based reply when Gemini API has no quota (not a substitute for care)."""
    t = (user_text or '').lower()
    note = (
        'Note: Google Gemini is not available for this API key right now (quota or billing). '
        'See https://aistudio.google.com/ and https://ai.google.dev/gemini-api/docs/rate-limits '
        'to fix it. Below is general information only.\n\n'
    )
    disclaimer = (
        '\n\nThis is general wellness information, not medical advice. '
        'Always follow your neurologist or care team.'
    )
    if any(k in t for k in ('exercise', 'physio', 'therapy', 'stretch', 'walk')):
        body = (
            'Regular movement and balance-friendly exercise often help stiffness and mobility in Parkinson\'s. '
            'Short daily sessions can be enough to start. Ask your clinician for a plan that fits your stage and goals.'
        )
    elif any(k in t for k in ('sleep', 'insomnia', 'tired', 'fatigue')):
        body = (
            'Sleep issues are common. A steady schedule, morning light, and limiting screens before bed can help. '
            'Some Parkinson\'s medicines affect sleep—worth reviewing timing and side effects with your doctor.'
        )
    elif any(k in t for k in ('tremor', 'shake', 'shaking')):
        body = (
            'Tremor is a frequent symptom; treatment options vary by person. '
            'Stress and caffeine can worsen tremor for some people. Discuss medication adjustments only with your specialist.'
        )
    elif any(k in t for k in ('medication', 'medicine', 'pill', 'dose', 'levodopa')):
        body = (
            'Taking medications on time matters for many people with Parkinson\'s. '
            'Do not change doses yourself—use reminders and talk to your prescriber about wearing-off or side effects.'
        )
    elif any(k in t for k in ('fall', 'balance', 'freeze', 'freezing')):
        body = (
            'Balance and freezing episodes need attention. Remove trip hazards at home, use good lighting, '
            'and ask about physiotherapy or assistive devices. Report falls to your care team.'
        )
    elif any(k in t for k in ('caregiver', 'carer', 'family', 'spouse')):
        body = (
            'Caregivers benefit from respite, clear communication with clinicians, and realistic daily routines. '
            'Local Parkinson\'s associations often run support groups and practical resources.'
        )
    elif any(k in t for k in ('diet', 'eat', 'nutrition', 'swallow')):
        body = (
            'Fiber and fluids can help constipation (common in Parkinson\'s). '
            'If swallowing is difficult, ask for a speech-language evaluation—meal texture changes can reduce risk.'
        )
    elif any(k in t for k in ('stress', 'anxiety', 'mood', 'depression')):
        body = (
            'Mood symptoms are common and treatable. Mindfulness, counseling, and medication reviews can all play a role. '
            'Tell your doctor if anxiety or depression is affecting daily life.'
        )
    elif any(k in t for k in ('appointment', 'doctor', 'neurologist', 'visit')):
        body = (
            'Before visits, note symptom changes, medication times, and questions about side effects or sleep. '
            'Bring an updated medication list and, if helpful, a family member for another perspective.'
        )
    else:
        body = (
            'Parkinson\'s care is personal: movement, medications, sleep, mood, and safety at home all connect. '
            'Ask about exercise, fall prevention, and medication timing. '
            'If you mention a topic (sleep, exercise, tremor, medications, falls), I can give more focused general tips.'
        )
    return note + body + disclaimer


@app.route('/api/chat', methods=['POST'])
def chat_gemini():
    """Parkinson assistant chat via Google Gemini (API key on server only)."""
    api_key = (os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY') or '').strip()
    if not api_key:
        return jsonify({
            'error': (
                'Chat is not configured. Set GEMINI_API_KEY in backend/.env and restart the Flask server.'
            ),
        }), 503

    env_system = (os.environ.get('GEMINI_SYSTEM_PROMPT') or '').strip()

    default_system = (
        'You are an empathetic medical assistant specifically focused on Parkinson\'s disease. '
        'You MUST politely decline any questions or commands that are entirely completely unrelated to Parkinson\'s disease, '
        'its symptoms, treatment, or caregiving. Please be highly tolerant of spelling mistakes and typos (e.g., "arkinon" means Parkinson\'s). '
        'For queries, provide concise, supportive answers and remind users to seek professional medical advice.'
    )
    system_base = env_system or default_system

    data = request.get_json(force=True, silent=True) or {}
    messages = data.get('messages') or []
    options = data.get('options') or {}

    first_user_idx = 0
    while first_user_idx < len(messages) and messages[first_user_idx].get('from') != 'user':
        first_user_idx += 1
    slice_messages = messages[first_user_idx:]

    extra = (options.get('systemInstruction') or '').strip()
    if extra:
        system_prompt = f'{system_base} {extra}'.strip()
    else:
        system_prompt = system_base

    contents = []
    for m in slice_messages:
        role = 'user' if m.get('from') == 'user' else 'model'
        contents.append({'role': role, 'parts': [{'text': m.get('text', '')}]})

    if not contents:
        return jsonify({'error': 'No user messages to send.'}), 400

    temp = options.get('temperature')
    max_tokens = options.get('maxTokens')
    try:
        temperature = float(temp) if temp is not None else 0.7
    except (TypeError, ValueError):
        temperature = 0.7
    try:
        max_output = int(max_tokens) if max_tokens is not None else 1024
    except (TypeError, ValueError):
        max_output = 1024

    body = {
        'contents': contents,
        'systemInstruction': {'parts': [{'text': system_prompt}]},
        'generationConfig': {
            'temperature': temperature,
            'maxOutputTokens': max_output,
        },
    }

    # Fallback to Pollinations AI (100% free, no API key required) to bypass all Gemini/OpenRouter Quotas
    or_messages = [{'role': 'system', 'content': system_prompt}]
    for m in slice_messages:
        role = 'user' if m.get('from') == 'user' else 'assistant'
        or_messages.append({'role': role, 'content': m.get('text', '')})
        
    or_body = {
        'model': 'openai',
        'messages': or_messages,
        'temperature': temperature,
    }
    
    headers = {
        'Content-Type': 'application/json'
    }
    
    try:
        r = requests.post('https://text.pollinations.ai/openai', headers=headers, json=or_body, timeout=90)
        if r.status_code == 200:
            j = r.json()
            text = j.get('choices', [{}])[0].get('message', {}).get('content', '')
            if text:
                return jsonify({'choices': [{'message': {'content': text}}]})
    except Exception as e:
        print(f"Fallback AI exception: {e}")
            
    params = {'key': api_key}
    models_to_try = _gemini_model_candidates()
    last_error = ''
    last_status = None

    for model in models_to_try:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'

        for attempt in range(5):
            try:
                r = requests.post(url, params=params, json=body, timeout=90)
            except requests.RequestException as exc:
                return jsonify({'error': f'Could not reach Google Gemini: {exc}'}), 502

            raw_text = r.text or ''
            try:
                j = r.json() if raw_text else {}
            except ValueError:
                j = {}

            err_msg = _gemini_error_message(j, raw_text)
            last_status = r.status_code

            if r.status_code == 200:
                text = _parse_gemini_text(j)
                if text:
                    return jsonify({'choices': [{'message': {'content': text}}]})
                block_reason = (j.get('promptFeedback') or {}).get('blockReason')
                finish_reason = (j.get('candidates') or [{}])[0].get('finishReason')
                if block_reason or finish_reason == 'SAFETY':
                    return jsonify({
                        'choices': [{
                            'message': {
                                'content': (
                                    'I could not answer that in this mode. Please ask a short question about '
                                    'Parkinson\'s care, symptoms, or daily living.'
                                ),
                            },
                        }],
                    })
                if err_msg:
                    return jsonify({'error': err_msg}), 502
                return jsonify({'error': 'Gemini returned an empty response. Try rephrasing your question.'}), 502

            if r.status_code in (401, 403):
                return jsonify({'error': 'Gemini API key rejected. Check GEMINI_API_KEY in backend/.env.'}), 502

            if r.status_code == 404:
                last_error = err_msg or f'Model not found: {model}'
                break

            if r.status_code == 400:
                return jsonify({'error': err_msg or 'Bad request to Gemini.'}), 400

            if r.status_code == 429 and _gemini_quota_zero(err_msg):
                if _quota_offline_fallback_enabled():
                    utext = _last_user_message_text(slice_messages)
                    return jsonify({
                        'choices': [{'message': {'content': _offline_chat_reply(utext)}}],
                    })
                return jsonify({
                    'error': (
                        'Gemini quota for this Google project or model is not available (often free tier limit: 0). '
                        'Enable billing for the Generative Language API in Google AI Studio / Google Cloud, or create a '
                        'new API key with quota. You can set GEMINI_MODEL to another model that has quota. '
                        'See https://ai.google.dev/gemini-api/docs/rate-limits'
                    ),
                }), 503

            if r.status_code in (429, 503, 500) and attempt < 4:
                delay = _parse_retry_seconds(err_msg) or (0.7 * (attempt + 1))
                time.sleep(delay)
                continue

            last_error = err_msg or raw_text or f'HTTP {r.status_code}'
            break

    tried = ', '.join(models_to_try)
    detail = last_error or (f'HTTP {last_status}' if last_status is not None else 'unknown error')
    return jsonify({
        'error': (
            f'Gemini could not complete the request after trying models: {tried}. '
            f'Last error: {detail}. Set GEMINI_MODEL in backend/.env to a model id from '
            f'https://ai.google.dev/gemini-api/docs/models or add GEMINI_MODEL_FALLBACKS=comma,separated,ids'
        ),
    }), 502


@app.route('/api/predict', methods=['POST', 'OPTIONS'])
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

@app.route('/api/voice/predict', methods=['POST'])
def predict_voice():
    """Voice screening using trained MobileNetV2 model on melspectrogram"""
    try:
        print("\n" + "="*60)
        print("VOICE SCREENING REQUEST")
        print("="*60)

        # Load model
        model = load_voice_model()
        if model is None:
            return jsonify({'error': 'Failed to load voice model'}), 500

        # Check for audio file
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        print(f"\nProcessing audio file: {audio_file.filename}")

        # Read audio bytes
        audio_bytes = audio_file.read()
        print(f"Audio file size: {len(audio_bytes)} bytes")

        # Preprocess audio to melspectrogram
        print("\nPreprocessing audio...")
        mel_spec = preprocess_for_voice(audio_bytes, model.input_shape)

        # Run inference
        print("\nRunning voice model inference...")
        predictions = model.predict(mel_spec, verbose=0)

        # Extract probabilities robustly for sigmoid or softmax outputs.
        predictions = np.asarray(predictions)
        if predictions.ndim == 2 and predictions.shape[1] == 1:
            raw_sigmoid = float(predictions[0][0])
            if VOICE_SIGMOID_POSITIVE_CLASS == 'healthy':
                healthy_score = raw_sigmoid
                parkinsons_score = 1.0 - healthy_score
            else:
                parkinsons_score = raw_sigmoid
                healthy_score = 1.0 - parkinsons_score
        elif predictions.ndim == 2 and predictions.shape[1] >= 2:
            # For two-output voice classifiers, assume [Parkinsons, Healthy].
            parkinsons_score = float(predictions[0][0])
            healthy_score = float(predictions[0][1])
        else:
            raise ValueError(f"Unexpected voice model output shape: {predictions.shape}")

        parkinsons_score = float(np.clip(parkinsons_score, 0.0, 1.0))
        healthy_score = float(np.clip(healthy_score, 0.0, 1.0))

        # Use a slightly conservative threshold to reduce false positives on
        # borderline healthy samples captured with consumer microphones.
        label = 'Parkinsons' if parkinsons_score >= VOICE_POSITIVE_THRESHOLD else 'Healthy'
        confidence = max(parkinsons_score, healthy_score)

        if parkinsons_score >= VOICE_POSITIVE_THRESHOLD:
            assessment_status = 'high_risk'
        elif parkinsons_score >= (VOICE_POSITIVE_THRESHOLD - VOICE_BORDERLINE_MARGIN):
            assessment_status = 'borderline'
        else:
            assessment_status = 'healthy_range'

        # Generate clinical reasoning
        reasoning = ""
        if assessment_status == 'high_risk':
            if parkinsons_score >= 0.8:
                reasoning = "Voice analysis shows strong indicators of Parkinsonian speech patterns including vocal instability, tremor, and dysarthria."
            elif parkinsons_score >= VOICE_POSITIVE_THRESHOLD:
                reasoning = "Voice screening indicates moderate concerns with vocal characteristics potentially consistent with Parkinson's disease."
            else:
                reasoning = "Voice analysis shows mild concerning patterns that warrant further clinical evaluation."
        elif assessment_status == 'borderline':
            reasoning = "Voice sample is in a borderline range. Please repeat with a clearer 5 to 10 second sample in a quiet room before drawing conclusions."
        else:
            if healthy_score >= 0.95:
                reasoning = "Voice parameters appear consistent with healthy, normal speech production."
            else:
                reasoning = "Voice characteristics are mostly within expected ranges, though some variability was detected."

        print(f"\nResults:")
        print(f"  Label: {label}")
        print(f"  Confidence: {confidence:.1%}")
        print(f"  Parkinsons: {parkinsons_score:.1%}")
        print(f"  Healthy: {healthy_score:.1%}")
        print(f"  Threshold: {VOICE_POSITIVE_THRESHOLD:.2f}")
        print(f"  Assessment: {assessment_status}")

        return jsonify({
            'label': label,
            'confidence': confidence,
            'reasoning': reasoning,
            'probabilities': {
                'Parkinsons': parkinsons_score,
                'Healthy': healthy_score
            },
            'raw_output': float(predictions[0][0]),
            'assessment': {
                'status': assessment_status,
                'threshold': VOICE_POSITIVE_THRESHOLD,
                'borderlineMargin': VOICE_BORDERLINE_MARGIN,
                'sigmoidPositiveClass': VOICE_SIGMOID_POSITIVE_CLASS,
            },
            'modelInfo': {
                'name': 'MobileNetV2-Melspectrogram',
                'type': 'voice',
                'inputShape': list(model.input_shape)
            }
        })

    except ImportError as e:
        print(f"Import error: {str(e)}")
        return jsonify({'error': f'Missing dependency: {str(e)}'}), 500
    except Exception as e:
        print(f"Error during voice prediction: {str(e)}")
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
        role = data.get('role', 'patient')
        phone = data.get('phone')
        hospital = data.get('hospital')
        specialties = data.get('specialties')
        doctor_identifier = data.get('doctor_identifier')
        age = data.get('age')
        doctor_gender = data.get('doctor_gender')
        qualification = data.get('qualification')
        years_experience = data.get('years_experience')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = mongodb_service.create_user(
            email,
            password,
            full_name,
            gender,
            date_of_birth,
            weight,
            height,
            clinical_stage,
            role,
            phone,
            hospital,
            specialties,
            doctor_identifier,
            age,
            doctor_gender,
            qualification,
            years_experience,
        )
        token = None
        if not (user.get('role') == 'doctor' and user.get('approval_status') == 'pending'):
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

        if user.get('role') == 'admin':
            return jsonify({'error': 'Use the hidden admin login portal'}), 403

        if user.get('role') == 'doctor' and user.get('approval_status') == 'pending':
            return jsonify({'error': 'Doctor account is waiting for admin approval. Please sign in after approval.'}), 403

        if user.get('role') == 'doctor' and user.get('approval_status') == 'rejected':
            return jsonify({'error': 'Your doctor account was rejected by the admin'}), 403
        
        token = mongodb_service.generate_token(user['id'], user['email'])
        
        return jsonify({
            'data': {
                'user': user,
                'access_token': token,
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/admin-signin', methods=['POST', 'OPTIONS'])
def admin_signin():
    """Hidden admin login"""
    try:
        if request.method == 'OPTIONS':
            return '', 200

        data = request.json
        email = data.get('email')
        password = data.get('password')

        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400

        user = mongodb_service.authenticate_user(email, password)
        if not user or user.get('role') != 'admin':
            return jsonify({'error': 'Invalid admin credentials'}), 401

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

@app.route('/api/doctors', methods=['GET'])
@require_auth
def list_doctors(user_id):
    """List approved doctors for patient booking."""
    doctors = mongodb_service.list_approved_doctors()
    return jsonify({'data': doctors}), 200

@app.route('/api/doctors/me/availability', methods=['PATCH'])
@require_role('doctor')
def update_doctor_availability(user_id, current_user):
    """Doctor: update availability slots shown to patients."""
    try:
        if current_user.get('approval_status') != 'approved':
            return jsonify({'error': 'Doctor account is pending admin approval'}), 403

        data = request.get_json() or {}
        availability_slots = data.get('availabilitySlots', [])
        updated_user = mongodb_service.update_user(user_id, {'availability_slots': availability_slots})
        return jsonify({'data': updated_user}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reports/ensure', methods=['POST'])
@require_auth
def ensure_report(user_id):
    """Create or reuse a unified report for the current patient."""
    try:
        data = request.get_json() or {}
        report_id = data.get('reportId')
        test_id = data.get('testId')
        report = _ensure_unified_report(user_id, report_id=report_id, preferred_test_id=test_id)
        return jsonify({'data': _serialize_report_for_user(report)}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reports', methods=['GET'])
@require_auth
def list_reports(user_id):
    """List reports based on current role."""
    try:
        user = mongodb_service.get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'Unauthorized'}), 401

        if user.get('role') == 'patient':
            reports = mongodb_service.list_reports({'patient_id': user_id})
        elif user.get('role') == 'doctor':
            appointments = mongodb_service.list_appointments({'doctor_id': user_id})
            report_ids = [appointment.get('report_id') for appointment in appointments if appointment.get('report_id')]
            reports = [mongodb_service.get_report_by_id(report_id) for report_id in report_ids]
            reports = [report for report in reports if report]
        else:
            reports = mongodb_service.list_reports()

        return jsonify({'data': [_serialize_report_for_user(report) for report in reports]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reports/<report_id>', methods=['GET'])
@require_auth
def get_report(report_id, user_id):
    """Get a single unified report with role-based access checks."""
    try:
        user = mongodb_service.get_user_by_id(user_id)
        report = mongodb_service.get_report_by_id(report_id)
        if not user or not report:
            return jsonify({'error': 'Report not found'}), 404

        allowed = user.get('role') == 'admin'
        if user.get('role') == 'patient' and report.get('patient_id') == user_id:
            allowed = True
        if user.get('role') == 'doctor':
            appointments = mongodb_service.list_appointments({
                'doctor_id': user_id,
                'report_id': report_id,
            })
            allowed = len(appointments) > 0 or report.get('doctor_id') == user_id

        if not allowed:
            return jsonify({'error': 'Forbidden'}), 403

        return jsonify({'data': _serialize_report_for_user(report)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reports/<report_id>/doctor-review', methods=['PATCH'])
@require_role('doctor')
def update_report_by_doctor(report_id, user_id, current_user):
    """Update a report in-place with doctor notes and prescription."""
    try:
        if current_user.get('approval_status') != 'approved':
            return jsonify({'error': 'Doctor account is pending admin approval'}), 403

        report = mongodb_service.get_report_by_id(report_id)
        if not report:
            return jsonify({'error': 'Report not found'}), 404

        appointments = mongodb_service.list_appointments({
            'doctor_id': user_id,
            'report_id': report_id,
        })
        if not appointments:
            return jsonify({'error': 'This report is not assigned to you'}), 403

        data = request.get_json() or {}
        updates = {
            'doctorNotes': data.get('doctorNotes', report.get('doctorNotes') or ''),
            'prescription': data.get('prescription', report.get('prescription') or []),
            'suggestions': data.get('suggestions', report.get('suggestions') or ''),
            'status': data.get('status', 'reviewed'),
            'doctor_id': user_id,
            'doctorDetails': _build_doctor_snapshot(user_id),
            'reviewed_at': datetime.utcnow().isoformat(),
        }
        updated_report = mongodb_service.update_report(report_id, updates)

        if updates['status'] == 'completed':
            for appointment in appointments:
                mongodb_service.update_appointment(appointment['id'], {'status': 'completed'})

        return jsonify({'data': _serialize_report_for_user(updated_report)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments', methods=['GET'])
@require_auth
def list_appointments(user_id):
    """List appointments for the current user role."""
    try:
        user = mongodb_service.get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'Unauthorized'}), 401

        if user.get('role') == 'patient':
            appointments = mongodb_service.list_appointments({'patient_id': user_id})
        elif user.get('role') == 'doctor':
            appointments = mongodb_service.list_appointments({'doctor_id': user_id})
        else:
            appointments = mongodb_service.list_appointments()

        return jsonify({'data': [_serialize_appointment_for_user(appointment) for appointment in _collapse_appointments(appointments)]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments', methods=['POST'])
@require_role('patient')
def create_appointment(user_id, current_user):
    """Create an appointment linked to a unified report."""
    try:
        data = request.get_json() or {}
        doctor_id = data.get('doctorId')
        appointment_date = data.get('appointmentDate')
        appointment_time = data.get('appointmentTime')
        consultation_type = data.get('consultationType', 'video')
        notes = data.get('notes')
        previous_prescription_path = data.get('previousPrescriptionPath')
        requested_report_id = data.get('reportId')
        test_id = data.get('testId')
        status = data.get('status') or 'pending'

        if not doctor_id:
            return jsonify({'error': 'doctorId is required'}), 400

        doctor = mongodb_service.get_user_by_id(doctor_id)
        if not doctor or doctor.get('role') != 'doctor':
            return jsonify({'error': 'Selected doctor was not found'}), 404
        if doctor.get('approval_status') != 'approved':
            return jsonify({'error': 'Selected doctor is not available for appointments'}), 400

        report = _ensure_unified_report(user_id, report_id=requested_report_id, preferred_test_id=test_id)
        room_seed = f"neurocare-{user_id[:6]}-{doctor_id[:6]}-{int(datetime.utcnow().timestamp())}"
        call_url = f"https://meet.jit.si/{room_seed}"
        consultation_type = data.get('consultationType', consultation_type)

        existing_appointments = mongodb_service.list_appointments({
            'patient_id': user_id,
            'doctor_id': doctor_id,
            'report_id': report['id'],
        })
        existing_appointment = _select_primary_appointment([
            item for item in existing_appointments
            if (item.get('status') or '').strip().lower() not in ['rejected', 'cancelled']
        ])

        appointment_doc = {
            'patient_id': user_id,
            'doctor_id': doctor_id,
            'doctor_name': doctor.get('full_name'),
            'doctor_hospital': doctor.get('hospital'),
            'appointment_date': appointment_date or datetime.utcnow().date().isoformat(),
            'appointment_time': appointment_time or '10:00',
            'requested_appointment_date': appointment_date or datetime.utcnow().date().isoformat(),
            'requested_appointment_time': appointment_time or '10:00',
            'status': status,
            'consultation_type': consultation_type,
            'notes': notes,
            'doctor_response_notes': None,
            'prescription_storage_path': previous_prescription_path,
            'report_id': report['id'],
            'call_room': room_seed,
            'call_url': call_url,
        }
        if existing_appointment:
            appointment = mongodb_service.update_appointment(existing_appointment['id'], appointment_doc)
        else:
            appointment = mongodb_service.create_appointment(appointment_doc)
        updated_report = mongodb_service.update_report(report['id'], {
            'doctor_id': doctor_id,
            'doctorDetails': _build_doctor_snapshot(doctor_id),
            'appointment_id': appointment['id'],
        })

        payload = _serialize_appointment_for_user(appointment)
        payload['report'] = updated_report
        return jsonify({'data': payload}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments/<appointment_id>/review', methods=['PATCH'])
@require_role('doctor')
def review_appointment_by_doctor(appointment_id, user_id, current_user):
    """Doctor accepts, rejects, or reschedules an appointment."""
    try:
        if current_user.get('approval_status') != 'approved':
            return jsonify({'error': 'Doctor account is pending admin approval'}), 403

        appointment = mongodb_service.get_appointment_by_id(appointment_id)
        if not appointment:
            return jsonify({'error': 'Appointment not found'}), 404
        if appointment.get('doctor_id') != user_id:
            return jsonify({'error': 'Forbidden'}), 403

        data = request.get_json() or {}
        next_status = data.get('status')
        if next_status not in ['accepted', 'rejected', 'rescheduled']:
            return jsonify({'error': 'Invalid appointment status'}), 400

        updates = {
            'status': next_status,
            'doctor_response_notes': data.get('doctorResponseNotes') or appointment.get('doctor_response_notes'),
        }

        if next_status in ['accepted', 'rescheduled']:
            updates['appointment_date'] = data.get('appointmentDate') or appointment.get('appointment_date')
            updates['appointment_time'] = data.get('appointmentTime') or appointment.get('appointment_time')

        updated_appointment = mongodb_service.update_appointment(appointment_id, updates)
        return jsonify({'data': _serialize_appointment_for_user(updated_appointment)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments/<appointment_id>/messages', methods=['GET'])
@require_auth
def get_appointment_messages(appointment_id, user_id):
    """List chat messages for an appointment."""
    try:
        current_user = mongodb_service.get_user_by_id(user_id)
        appointment = mongodb_service.get_appointment_by_id(appointment_id)
        if not appointment:
            return jsonify({'error': 'Appointment not found'}), 404
        if not _can_access_appointment(current_user, appointment):
            return jsonify({'error': 'Forbidden'}), 403
        if not _appointment_allows_live_access(appointment):
            return jsonify({'error': 'Appointment is awaiting doctor acceptance'}), 403

        messages = mongodb_service.list_chat_messages({'appointment_id': appointment_id})
        return jsonify({'data': messages}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments/<appointment_id>/messages', methods=['POST'])
@require_auth
def send_appointment_message(appointment_id, user_id):
    """Send a chat message between doctor and patient."""
    try:
        current_user = mongodb_service.get_user_by_id(user_id)
        appointment = mongodb_service.get_appointment_by_id(appointment_id)
        if not appointment:
            return jsonify({'error': 'Appointment not found'}), 404
        if not _can_access_appointment(current_user, appointment):
            return jsonify({'error': 'Forbidden'}), 403
        if not _appointment_allows_live_access(appointment):
            return jsonify({'error': 'Appointment is awaiting doctor acceptance'}), 403

        data = request.get_json() or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({'error': 'Message is required'}), 400

        created = mongodb_service.create_chat_message({
            'appointment_id': appointment_id,
            'report_id': appointment.get('report_id'),
            'sender_id': current_user.get('id'),
            'sender_role': current_user.get('role'),
            'sender_name': current_user.get('full_name') or current_user.get('email') or 'User',
            'message': message,
        })
        return jsonify({'data': created}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/users', methods=['GET'])
@require_role('admin')
def admin_list_users(user_id, current_user):
    """Admin: view all users."""
    try:
        return jsonify({'data': mongodb_service.list_users()}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/doctors', methods=['GET'])
@require_role('admin')
def admin_list_doctors(user_id, current_user):
    """Admin: list doctors for approval workflow."""
    try:
        doctors = mongodb_service.list_users({'role': 'doctor'})
        return jsonify({'data': doctors}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/doctors/<doctor_id>/approval', methods=['PATCH'])
@require_role('admin')
def admin_update_doctor_approval(doctor_id, user_id, current_user):
    """Admin: approve or reject a doctor."""
    try:
        data = request.get_json() or {}
        approval_status = data.get('approvalStatus')
        if approval_status not in ['approved', 'rejected', 'pending']:
            return jsonify({'error': 'Invalid approvalStatus'}), 400

        doctor = mongodb_service.get_user_by_id(doctor_id)
        if not doctor or doctor.get('role') != 'doctor':
            return jsonify({'error': 'Doctor not found'}), 404

        updated = mongodb_service.update_user(doctor_id, {'approval_status': approval_status})
        return jsonify({'data': updated}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False, allow_unsafe_werkzeug=True)
