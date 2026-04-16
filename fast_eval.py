import os, sys
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    print('Loading Spiral Module...', flush=True)
    from train_spiral_model import SpiralDataGenerator

    def preprocess_mobilenetv2(X):
        return (X.astype(np.float32) / 127.5) - 1.0

    print('Loading Spiral Model...')
    spiral_model = tf.keras.models.load_model('backend/models/spiral/mobilenet_spiral_robust.h5', compile=False)
    
    print('Generating Spiral Dataset (200 samples)...', flush=True)
    spiral_gen = SpiralDataGenerator()
    X_spiral, y_spiral = spiral_gen.generate_dataset(num_samples_per_class=100)
    X_sp_processed = preprocess_mobilenetv2(X_spiral)

    print('Evaluating Spiral Model...', flush=True)
    sp_pred = spiral_model.predict(X_sp_processed, verbose=0)
    sp_pred_class = (sp_pred > 0.5).astype(int).flatten()

    print('\n=== REAL SPIRAL CONFUSION MATRIX ===', flush=True)
    print(confusion_matrix(y_spiral, sp_pred_class))
    print(classification_report(y_spiral, sp_pred_class, target_names=['Healthy', 'Parkinsons']))

except Exception as e:
    print('Error with Spiral:', e)

try:
    print('\nLoading Wave Module...', flush=True)
    from train_improved_wave_model import RealisticWaveGenerator
    print('Loading Wave Model...')
    wave_model = tf.keras.models.load_model('backend/models/wave/inception_wave_v2.h5', compile=False)
    
    print('Generating Wave Dataset (200 samples)...', flush=True)
    wave_gen = RealisticWaveGenerator()
    X_wave, y_wave = wave_gen.generate_balanced_dataset(num_per_class=100)
    X_wa_processed = (X_wave.astype(np.float32) / 255.0)

    print('Evaluating Wave Model...', flush=True)
    wa_pred = wave_model.predict(X_wa_processed, verbose=0)
    # Wave returns healthy=sigmoid. So predict Parkinsons (1) if sigmoid < 0.5
    wa_pred_class = (wa_pred < 0.5).astype(int).flatten()

    print('\n=== REAL WAVE CONFUSION MATRIX ===', flush=True)
    print(confusion_matrix(y_wave, wa_pred_class))
    print(classification_report(y_wave, wa_pred_class, target_names=['Healthy', 'Parkinsons']))

except Exception as e:
    print('Error with Wave:', e)

print('\nVoice model has no synthetic generator; accuracy metrics rely on static voice recordings dataset.', flush=True)
