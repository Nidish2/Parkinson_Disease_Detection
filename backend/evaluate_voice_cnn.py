import os
import glob
import numpy as np
import librosa
import cv2
import csv
import tensorflow as tf
from tensorflow import keras
from sklearn.metrics import classification_report, confusion_matrix

def audio_to_melspec_image(y, sr):
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

def predict_audio_file(model, file_path):
    try:
        y, sr = librosa.load(file_path, sr=44100, mono=True)
        y, _ = librosa.effects.trim(y, top_db=20)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None
        
    chunk_duration = 5.0
    chunk_samples = int(sr * chunk_duration)
    hop_length_samples = int(sr * 2.5)
    
    chunks = []
    
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

        if len(y) > chunk_samples and (len(y) - start - chunk_samples) > int(sr * 1.0):
            tail_start = len(y) - chunk_samples
            chunks.append(y[tail_start:])
            
    if len(chunks) == 0:
        return None
            
    images = []
    for chunk in chunks:
        images.append(audio_to_melspec_image(chunk, sr))
        
    X = np.array(images, dtype=np.float32)
    X = keras.applications.mobilenet_v2.preprocess_input(X)
    
    raw_predictions = model.predict(X, verbose=0)
    
    # Calculate Ensemble Majority Voting
    votes = (raw_predictions > 0.5).astype(int).flatten()
    pd_votes = int(np.sum(votes))
    total_votes = len(votes)
    
    is_pd = pd_votes > (total_votes / 2)
    return int(is_pd)

def evaluate():
    from backend_api import load_voice_cnn
    
    print("Loading model for evaluation...")
    model = load_voice_cnn()
        
    if not model:
        print("Failed to load model.")
        return

    METADATA_CSV = "dataset_metadata.csv"
    if not os.path.exists(METADATA_CSV):
        print("Metadata CSV not found! Please run generate_metadata.py first.")
        return

    y_true = []
    y_pred = []
    
    print(f"\nScanning {METADATA_CSV} to check file-level accuracy...")
    
    count = 0
    with open(METADATA_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            file_path = row['file_path']
            label = int(row['label_idx'])
            
            predicted_class = predict_audio_file(model, file_path)
            if predicted_class is not None:
                y_true.append(label)
                y_pred.append(predicted_class)
                
                count += 1
                if count % 20 == 0:
                    print(f"  Processed {count} valid audio files...")
                    
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    
    accuracy = np.mean(y_true == y_pred)
    
    print("\n" + "="*50)
    print("      FILE-LEVEL EVALUATION RESULTS")
    print("      (Ensemble Majority Voting)")
    print("="*50)
    print(f"Total Audio Files Analyzed: {len(y_true)}")
    print(f"File-Level Accuracy:        {accuracy*100:.2f}%")
    print("-" * 50)
    print("Confusion Matrix:")
    print(confusion_matrix(y_true, y_pred))
    print("-" * 50)
    print("Classification Report:")
    try:
        print(classification_report(y_true, y_pred, target_names=['Healthy', 'Parkinsons']))
    except Exception as e:
        print(classification_report(y_true, y_pred))
    print("="*50)

if __name__ == "__main__":
    evaluate()
