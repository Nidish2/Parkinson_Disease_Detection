"""
Train Parkinson's Voice Model (Mel Spectrogram + CNN)
Requires dataset_metadata.csv mapped to actual patient audio.
"""
import os
import glob
import numpy as np
import librosa
import cv2
import json
import csv
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.models import Model
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.preprocessing.image import ImageDataGenerator

# --- CONFIGURATION ---
METADATA_CSV = "dataset_metadata.csv"
MODEL_SAVE_PATH = "../public/models/voice_melspec_mobilenetv2.h5"
METADATA_SAVE_PATH = "../public/models/voice_melspec_metadata.json"

# Audio parameters (Aligned to 44.1kHz WebM standard for production)
SAMPLE_RATE = 44100
CHUNK_DURATION = 5.0 # seconds
CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_DURATION)
HOP_LENGTH_SAMPLES = int(SAMPLE_RATE * 2.5) # 2.5s overlap

# Spectrogram parameters
N_MELS = 128
FMAX = 8000
IMAGE_SIZE = (224, 224) # MobileNetV2 input size

# Training parameters
BATCH_SIZE = 16
EPOCHS = 40
LEARNING_RATE = 1e-4

def augment_audio(y, sr):
    """Applies time stretching, pitch shifting, and white noise."""
    augmented = [y] # Include original
    try:
        y_fast = librosa.effects.time_stretch(y, rate=1.1)
        augmented.append(y_fast)
    except Exception: pass
    try:
        y_pitch = librosa.effects.pitch_shift(y, sr=sr, n_steps=2)
        augmented.append(y_pitch)
    except Exception: pass
    noise = np.random.normal(0, 0.005, len(y))
    augmented.append(y + noise)
    return augmented

def chunk_audio(y):
    """Splits audio into 5-second overlapping chunks. Pads if < 5s."""
    chunks = []
    if len(y) < CHUNK_SAMPLES:
        pad_length = CHUNK_SAMPLES - len(y)
        y_padded = np.pad(y, (0, pad_length))
        chunks.append(y_padded)
        return chunks
    start = 0
    for start in range(0, len(y) - CHUNK_SAMPLES + 1, HOP_LENGTH_SAMPLES):
        chunk = y[start:start + CHUNK_SAMPLES]
        if len(chunk) == CHUNK_SAMPLES:
            chunks.append(chunk)
    if len(y) > CHUNK_SAMPLES and (len(y) - start - CHUNK_SAMPLES) > int(SAMPLE_RATE * 1.0):
        tail_start = len(y) - CHUNK_SAMPLES
        chunks.append(y[tail_start:])
    return chunks

def audio_to_melspec_image(y):
    """Converts raw audio chunk to 224x224 RGB mel spectrogram image."""
    S = librosa.feature.melspectrogram(
        y=y, sr=SAMPLE_RATE, n_mels=N_MELS, fmax=FMAX, hop_length=512, n_fft=2048
    )
    S_dB = librosa.power_to_db(S, ref=np.max)
    S_norm = S_dB - S_dB.min()
    if S_norm.max() > 0:
        S_norm = S_norm / S_norm.max()
    S_img = (S_norm * 255).astype(np.uint8)
    image = cv2.resize(S_img, IMAGE_SIZE, interpolation=cv2.INTER_CUBIC)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    return image_rgb

def load_metadata():
    """Reads CSV to get metadata arrays for splitting before processing."""
    print(f"Reading {METADATA_CSV}...")
    if not os.path.exists(METADATA_CSV):
        print("Error: Metadata CSV not found.")
        return [], [], []
    
    filepaths, labels, patient_ids = [], [], []
    with open(METADATA_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            filepaths.append(row['file_path'])
            labels.append(int(row['label_idx']))
            patient_ids.append(row['true_patient_id'])
            
    return np.array(filepaths), np.array(labels), np.array(patient_ids)

def process_file_list(filepaths, labels, apply_augmentation=False):
    """Loads audio, applies augmentations (only if requested), and generate chunks/spectrograms."""
    X_list, y_list = [], []
    
    for idx, (filepath, label) in enumerate(zip(filepaths, labels)):
        if idx % 10 == 0:
            print(f"  Processing file {idx+1}/{len(filepaths)} (Augment={apply_augmentation})...")
            
        try:
            y, sr = librosa.load(filepath, sr=SAMPLE_RATE, mono=True)
            y, _ = librosa.effects.trim(y, top_db=20)
            
            audios_to_process = augment_audio(y, sr) if apply_augmentation else [y]
            
            for aug_y in audios_to_process:
                chunks = chunk_audio(aug_y)
                for chunk in chunks:
                    img = audio_to_melspec_image(chunk)
                    X_list.append(img)
                    y_list.append(label)
        except Exception as e:
            pass
            
    X_arr = np.array(X_list, dtype=np.float32)
    if len(X_arr) > 0:
        X_arr = tf.keras.applications.mobilenet_v2.preprocess_input(X_arr)
    y_arr = np.array(y_list)
    return X_arr, y_arr

def build_model():
    """Builds completely frozen MobileNetV2 with top dense classifier."""
    base_model = MobileNetV2(weights='imagenet', include_top=False, input_shape=(224, 224, 3))
    base_model.trainable = False
    
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    x = Dense(128, activation='relu')(x)
    x = Dropout(0.5)(x)
    predictions = Dense(1, activation='sigmoid')(x)
    
    model = Model(inputs=base_model.input, outputs=predictions)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    return model

def main():
    # 1. Load Metadata FIRST
    filepaths, labels, patient_ids = load_metadata()
    if len(filepaths) == 0:
        return
        
    print(f"Found {len(filepaths)} total files in metadata.")

    # 2. Split Data (Metadata ONLY) using GroupKFold
    # Split 1: 80% Train+Val / 20% Test
    gkf_outer = GroupKFold(n_splits=5)
    train_val_idx, test_idx = next(gkf_outer.split(filepaths, labels, patient_ids))
    
    fp_train_val = filepaths[train_val_idx]
    lbl_train_val = labels[train_val_idx]
    pid_train_val = patient_ids[train_val_idx]
    
    fp_test = filepaths[test_idx]
    lbl_test = labels[test_idx]
    
    # Split 2: 80% Train / 20% Val from Train+Val
    gkf_inner = GroupKFold(n_splits=5)
    train_idx, val_idx = next(gkf_inner.split(fp_train_val, lbl_train_val, pid_train_val))
    
    fp_train = fp_train_val[train_idx]
    lbl_train = lbl_train_val[train_idx]
    
    fp_val = fp_train_val[val_idx]
    lbl_val = lbl_train_val[val_idx]

    # 3. Process Data
    print(f"\nProcessing TRAIN set ({len(fp_train)} files) WITH Augmentation...")
    X_train, y_train = process_file_list(fp_train, lbl_train, apply_augmentation=True)
    
    print(f"\nProcessing VALIDATION set ({len(fp_val)} files) strictly WITHOUT Augmentation...")
    X_val, y_val = process_file_list(fp_val, lbl_val, apply_augmentation=False)
    
    print(f"\nProcessing TEST set ({len(fp_test)} files) strictly WITHOUT Augmentation...")
    X_test, y_test = process_file_list(fp_test, lbl_test, apply_augmentation=False)

    print(f"\nChunks generated -> Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
    if len(X_train) == 0:
        print("Error: No training data generated.")
        return

    # 4. Build Model
    model = build_model()
    model.summary()

    # 5. Callbacks & Class Weights
    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    callbacks = [
        ModelCheckpoint(MODEL_SAVE_PATH, save_best_only=True, monitor='val_auc', mode='max', verbose=1),
        EarlyStopping(monitor='val_auc', mode='max', patience=10, restore_best_weights=True),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6)
    ]

    count_0, count_1 = np.sum(y_train==0), np.sum(y_train==1)
    w0 = (1 / count_0) * (len(y_train) / 2.0) if count_0 > 0 else 1.0
    w1 = (1 / count_1) * (len(y_train) / 2.0) if count_1 > 0 else 1.0
    class_weight = {0: w0, 1: w1}
    
    # 6. Train Model (Phase 1: Frozen Base)
    print("Starting Phase 1 training on clean architecture (Frozen Base)...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        class_weight=class_weight
    )

    # --- PHASE 2: FINE-TUNING ---
    print("\nStarting Phase 2: Fine-Tuning the top layers of the model...")
    
    # 1. Unfreeze the entire model first
    model.trainable = True
    
    # 2. Freeze everything EXCEPT the top 30 layers
    for layer in model.layers[:-30]:
        layer.trainable = False
        
    # 3. PRO-TIP: Force all BatchNormalization layers to stay frozen 
    # to prevent weight explosion during fine-tuning
    for layer in model.layers[-30:]:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
            
    print("Unfrozen the top 30 layers (BatchNormalization safely kept frozen).")
    
    # Recompile with a microscopic learning rate
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    
    # Fine-tune for 10 epochs
    print("Starting Phase 2 training...")
    history_fine = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=10, # 10 extra epochs
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        class_weight=class_weight
    )

    # 7. Evaluate on Clean Test Set
    print("\nEvaluating best model on Pristine Test Set...")
    test_loss, test_acc, test_auc = model.evaluate(X_test, y_test)
    y_pred_probs = model.predict(X_test)
    y_pred = (y_pred_probs > 0.5).astype(int).flatten()
    
    print("\n=== Test Results ===")
    print(f"Accuracy: {test_acc:.4f}")
    print(f"AUC:      {test_auc:.4f}")
    print("\nConfusion Matrix:")
    print(confusion_matrix(y_test, y_pred))
    
    try:
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=['Healthy (0)', 'Parkinsons (1)']))
    except ValueError as e:
        print(f"Classification report error: {e}")

    # 8. Save Metadata
    metadata = {
        "modelType": "mobilenetv2_melspec",
        "modelFile": os.path.basename(MODEL_SAVE_PATH),
        "expectedAudio": {"sampleRate": SAMPLE_RATE, "duration": "Dynamic", "hopLength": "2.5s"},
        "spectrogram": {"nMels": N_MELS, "fmax": FMAX, "imageSize": IMAGE_SIZE},
        "performance": {"testAccuracy": float(test_acc), "testAuc": float(test_auc)}
    }
    with open(METADATA_SAVE_PATH, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved metadata to {METADATA_SAVE_PATH}")

if __name__ == "__main__":
    main()
