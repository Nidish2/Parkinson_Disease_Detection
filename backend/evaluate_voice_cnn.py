import os
import glob
import numpy as np
import librosa
import cv2
import tensorflow as tf
from tensorflow import keras

# Adjust paths based on your structure
MODEL_PATH = "../public/models/voice_melspec_mobilenetv2.h5"

DATASET_DIRS = [
    "dataset_audio/ReadText",
    "dataset_audio/SpontaneousDialogue"
]

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
    # Load and process exactly like backend_api.py
    y, sr = librosa.load(file_path, sr=22050, mono=True)
    y, _ = librosa.effects.trim(y, top_db=20)
    
    chunk_duration = 5.0
    chunk_samples = int(sr * chunk_duration)
    hop_length_samples = int(sr * 2.5)
    
    chunks = []
    for start in range(0, len(y) - chunk_samples + 1, hop_length_samples):
        chunk = y[start:start + chunk_samples]
        if len(chunk) == chunk_samples:
            chunks.append(chunk)
            
    if len(chunks) == 0:
        if len(y) > int(sr * 1.0):
            pad_length = chunk_samples - len(y)
            y_padded = np.pad(y, (0, pad_length))
            chunks.append(y_padded)
        else:
            return None # Too short
            
    images = []
    for chunk in chunks:
        images.append(audio_to_melspec_image(chunk, sr))
        
    X = np.array(images, dtype=np.float32)
    X = keras.applications.mobilenet_v2.preprocess_input(X)
    
    preds = model.predict(X, verbose=0)
    avg_prob = float(np.mean(preds))
    return avg_prob

def evaluate():
    print("Loading model from", MODEL_PATH)
    model = keras.models.load_model(MODEL_PATH)
    
    y_true = []
    y_pred_probs = []
    
    for dataset_dir in DATASET_DIRS:
        print(f"\nScanning directory: {dataset_dir}")
        for label, idx in [("HC", 0), ("PD", 1)]:
            folder = os.path.join(dataset_dir, label)
            if not os.path.exists(folder):
                continue
                
            files = glob.glob(os.path.join(folder, "*.wav"))
            print(f"  Found {len(files)} {label} files...")
            
            for f in files:
                prob = predict_audio_file(model, f)
                if prob is not None:
                    y_true.append(idx)
                    y_pred_probs.append(prob)
                    
    y_true = np.array(y_true)
    y_pred_probs = np.array(y_pred_probs)
    y_pred = (y_pred_probs > 0.5).astype(int)
    
    # Calculate metrics
    accuracy = np.mean(y_true == y_pred)
    
    tp = np.sum((y_true == 1) & (y_pred == 1))
    tn = np.sum((y_true == 0) & (y_pred == 0))
    fp = np.sum((y_true == 0) & (y_pred == 1))
    fn = np.sum((y_true == 1) & (y_pred == 0))
    
    print("\n" + "="*40)
    print("      EVALUATION RESULTS")
    print("="*40)
    print(f"Total Files Tested: {len(y_true)}")
    print(f"Overall Accuracy:   {accuracy*100:.2f}%")
    print(f"True Positive (PD correctly classified): {tp}")
    print(f"True Negative (HC correctly classified): {tn}")
    print(f"False Positive (HC misclassified as PD): {fp}")
    print(f"False Negative (PD misclassified as HC): {fn}")
    
    if tp + fn > 0:
        sensitivity = tp / (tp + fn)
        print(f"Sensitivity (Recall): {sensitivity*100:.2f}%")
    if tn + fp > 0:
        specificity = tn / (tn + fp)
        print(f"Specificity:          {specificity*100:.2f}%")
    print("="*40)

if __name__ == "__main__":
    evaluate()
