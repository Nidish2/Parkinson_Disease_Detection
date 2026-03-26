"""
Train Parkinson's Voice Model (Mel Spectrogram + CNN)
Requires MDVR-KCL dataset in dataset_audio/ReadText/HC and dataset_audio/ReadText/PD
"""
import os
import glob
import numpy as np
import librosa
import cv2
import json
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.models import Model
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.preprocessing.image import ImageDataGenerator


# --- CONFIGURATION ---
DATASET_DIRS = [
    "dataset_audio/ReadText",
    "dataset_audio/SpontaneousDialogue"
]
MODEL_SAVE_PATH = "../public/models/voice_melspec_mobilenetv2.h5"
METADATA_SAVE_PATH = "../public/models/voice_melspec_metadata.json"

# Audio parameters
SAMPLE_RATE = 22050
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

def load_and_chunk_audio(filepath):
    """Loads audio, trims silence, and splits into 5-second overlapping chunks."""
    try:
        y, sr = librosa.load(filepath, sr=SAMPLE_RATE, mono=True)
        # Trim leading/trailing silence
        y, _ = librosa.effects.trim(y, top_db=20)
        
        chunks = []
        for start in range(0, len(y) - CHUNK_SAMPLES + 1, HOP_LENGTH_SAMPLES):
            chunk = y[start:start + CHUNK_SAMPLES]
            if len(chunk) == CHUNK_SAMPLES:
                chunks.append(chunk)
        return chunks
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return []

def audio_to_melspec_image(y):
    """Converts raw audio chunk to 224x224 RGB mel spectrogram image."""
    # 1. Extract Mel Spectrogram
    S = librosa.feature.melspectrogram(
        y=y, 
        sr=SAMPLE_RATE, 
        n_mels=N_MELS, 
        fmax=FMAX,
        hop_length=512,
        n_fft=2048
    )
    
    # 2. Convert to log scale (dB)
    S_dB = librosa.power_to_db(S, ref=np.max)
    
    # 3. Normalize to [0, 255] for image representation
    S_norm = S_dB - S_dB.min()
    if S_norm.max() > 0:
        S_norm = S_norm / S_norm.max()
    S_img = (S_norm * 255).astype(np.uint8)
    
    # 4. Resize to 224x224
    image = cv2.resize(S_img, IMAGE_SIZE, interpolation=cv2.INTER_CUBIC)
    
    # 5. Convert to 3 channels (RGB) for MobileNetV2
    image_rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    
    return image_rgb


def prepare_dataset():
    """Reads the dataset directory, chunks audio, and generates spectrograms."""
    print("Preparing dataset...")
    X = []
    y = []
    
    classes = {'HC': 0, 'PD': 1}
    for label_name, label_idx in classes.items():
        wav_files = []
        for dataset_dir in DATASET_DIRS:
            folder_path = os.path.join(dataset_dir, label_name)
            if not os.path.exists(folder_path):
                print(f"Directory not found: {folder_path}")
                continue
            wav_files.extend(glob.glob(os.path.join(folder_path, "*.wav")))
            
        print(f"Found {len(wav_files)} {label_name} audio files across all dataset directories.")
        
        for idx, filepath in enumerate(wav_files):
            if idx % 5 == 0:
                print(f"  Processing {label_name} file {idx+1}/{len(wav_files)}...")
                
            chunks = load_and_chunk_audio(filepath)
            for chunk in chunks:
                img = audio_to_melspec_image(chunk)
                X.append(img)
                y.append(label_idx)
                
    X = np.array(X, dtype=np.float32)
    # Preprocess for MobileNetV2 (scales pixels from [0, 255] to [-1, 1])
    X = tf.keras.applications.mobilenet_v2.preprocess_input(X)
    y = np.array(y)
    
    print(f"Dataset preparation complete. Total 5s chunks: {len(X)}")
    print(f"Shape of X: {X.shape}")
    print(f"Class distribution - HC: {np.sum(y==0)}, PD: {np.sum(y==1)}")
    
    return X, y

def build_model():
    """Builds MobileNetV2 model for binary classification."""
    base_model = MobileNetV2(
        weights='imagenet', 
        include_top=False, 
        input_shape=(224, 224, 3)
    )
    
    # Freeze the base model layers
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
    missing_dirs = [d for d in DATASET_DIRS if not os.path.exists(d)]
    if len(missing_dirs) == len(DATASET_DIRS):
        print("="*60)
        print("ERROR: MDVR-KCL dataset not found in any specified directories!")
        print(f"Please place the .wav files in at least one of these:")
        for d in DATASET_DIRS:
            print(f"  {os.path.abspath(d)}/HC/")
            print(f"  {os.path.abspath(d)}/PD/")
        print("="*60)
        return

    # 1. Load Data
    X, y = prepare_dataset()
    if len(X) == 0:
        print("Failed to load dataset. Aborting.")
        return

    # 2. Split Data (Keep patients separate ideally, but chunk random split for now)
    # Stratify ensures balance in train/val
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.3, stratify=y, random_state=42)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.5, stratify=y_temp, random_state=42)
    
    print(f"Train samples: {len(X_train)}")
    print(f"Validation samples: {len(X_val)}")
    print(f"Test samples: {len(X_test)}")

    # 3. Build Model
    model = build_model()
    model.summary()

    # 4. Callbacks
    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    
    callbacks = [
        ModelCheckpoint(MODEL_SAVE_PATH, save_best_only=True, monitor='val_auc', mode='max', verbose=1),
        EarlyStopping(monitor='val_auc', mode='max', patience=10, restore_best_weights=True),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6)
    ]

    # Data augmentation for training (optional, typical for spectrograms)
    # Note: Traditional image augmentation like rotation is bad for spectrograms.
    # We mainly rely on time/frequency shifting if needed, but we keep it simple here.
    
    # 5. Train Model
    print("Starting training...")
    # Calculate class weights for imbalanced data
    weight_for_0 = (1 / np.sum(y_train==0)) * (len(y_train) / 2.0)
    weight_for_1 = (1 / np.sum(y_train==1)) * (len(y_train) / 2.0)
    class_weight = {0: weight_for_0, 1: weight_for_1}
    
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        class_weight=class_weight
    )

    # 6. Fine-tuning (Unfreeze top layers of MobileNetV2)
    print("Fine-tuning base model layers...")
    base_model = model.layers[1]
    base_model.trainable = True
    # Freeze first 100 layers, train the rest
    for layer in base_model.layers[:100]:
        layer.trainable = False
        
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE / 10), # Lower learning rate
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    
    history_fine = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=20,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        class_weight=class_weight
    )

    # 7. Evaluate on Test Set
    print("\nEvaluating best model on test set...")
    # The ModelCheckpoint callback ensures the saved model is the best one
    # But we can also test the current weights
    test_loss, test_acc, test_auc = model.evaluate(X_test, y_test)
    
    # Predictions
    y_pred_probs = model.predict(X_test)
    y_pred = (y_pred_probs > 0.5).astype(int).flatten()
    
    print("\n=== Test Results ===")
    print(f"Accuracy: {test_acc:.4f}")
    print(f"AUC:      {test_auc:.4f}")
    
    print("\nConfusion Matrix:")
    print(confusion_matrix(y_test, y_pred))
    
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=['Healthy (0)', 'Parkinsons (1)']))

    # 8. Save Metadata
    metadata = {
        "modelType": "mobilenetv2_melspec",
        "modelFile": os.path.basename(MODEL_SAVE_PATH),
        "expectedAudio": {
            "sampleRate": SAMPLE_RATE,
            "duration": "Dynamic (chunked into 5s windows)",
            "hopLength": "2.5s"
        },
        "spectrogram": {
            "nMels": N_MELS,
            "fmax": FMAX,
            "imageSize": IMAGE_SIZE
        },
        "performance": {
            "testAccuracy": float(test_acc),
            "testAuc": float(test_auc)
        }
    }
    
    with open(METADATA_SAVE_PATH, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved metadata to {METADATA_SAVE_PATH}")

if __name__ == "__main__":
    main()
