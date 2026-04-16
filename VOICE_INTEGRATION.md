# Voice Model Integration - Setup & Usage

## ✅ What's Been Added

### Backend Integration
1. **TensorFlow Model Loading** (`backend_api.py`):
   - Added `load_voice_model()` function to load the trained MobileNetV2 voice model
   - Added `/api/voice/predict` endpoint for voice screening

2. **Audio Processing** (`backend_api.py`):
   - Added `preprocess_for_voice()` function that:
     - Loads audio files (.wav, .mp3, .m4a, etc.)
     - Converts to melspectrogram (128x128 features)
     - Normalizes to [0, 1] scale
     - Formats for model input

### Frontend Integration
1. **Neural Network Service** (`frontend/src/services/voiceModel.ts`):
   - `predictVoice()` - uploads audio blob to backend for ML prediction
   - Returns structured prediction with confidence, reasoning, and probabilities

2. **Enhanced Voice Capture Modal** (`frontend/src/components/VoiceCaptureModal.tsx`):
   - New mode selector: **Record** or **Upload**
   - **Record Mode**: Real-time KNN analysis (existing, still available)
   - **Upload Mode**: Neural network model prediction (NEW!)
   - Unified result saving for both methods
   - Shows prediction results with:
     - Label (Parkinsons / Healthy)
     - Confidence score
     - Probability distribution (Parkinsons vs Healthy)
     - Clinical reasoning

## 🚀 How to Use

### Option 1: Record Voice (KNN Analysis)
1. Go to `/new-test`
2. Click **Capture Voice**
3. Select **Record** tab
4. Click the microphone button
5. Read the prompt that appears
6. Stop when done (minimum 3 seconds required)
7. Results show via KNN model with detailed feature breakdown

### Option 2: Upload Voice File (Neural Network)
1. Go to `/new-test`
2. Click **Capture Voice**
3. Select **Upload** tab
4. Click the upload area or drag-and-drop an audio file
5. Audio automatically processes with trained MobileNetV2 model
6. Results show confidence score and reasoning

Both methods save results to:
- **MongoDB** (if authenticated)
- **localStorage** (offline backup)

## 📋 Requirements

### Python Backend
The backend now requires:
```bash
pip install librosa soundfile
```

**Already installed and available:**
- tensorflow >= 2.0
- flask
- flask-cors
- pillow
- opencv-python
- h5py
- numpy

## 🏗️ Architecture

### Voice Model (MobileNetV2)
- **Path**: `backend/models/Voice/voice_melspec_mobilenetv2.h5`
- **Input**: Mel-spectrogram (128×128 pixels)
- **Output**: Binary classification (Parkinsons / Healthy)
- **Training Data**: Professional medical-grade recordings

### KNN Model (Real-time)
- **Path**: `frontend/src/services/voiceKnnModel.ts`
- **Data**: `frontend/public/data/pd_speech_features.csv` (188 samples)
- **Method**: K-Nearest Neighbors (k=5)
- **Analysis**: Voice feature extraction (jitter, shimmer, harmonicity, etc.)

## 📊 API Endpoints

### New Endpoint
```
POST /api/voice/predict
Content-Type: multipart/form-data

Body:
  - audio: <audio_file_blob>

Response:
{
  "label": "Parkinsons" | "Healthy",
  "confidence": 0.0-1.0,
  "reasoning": "Clinical interpretation...",
  "probabilities": {
    "Parkinsons": 0.0-1.0,
    "Healthy": 0.0-1.0
  },
  "raw_output": 0.0-1.0,
  "modelInfo": {
    "name": "MobileNetV2-Melspectrogram",
    "type": "voice",
    "inputShape": [1, 128, 128, 1]
  }
}
```

## 🔄 Data Flow

### Upload Voice File
```
User selects audio → Frontend (voiceModel.ts)
↓
POST to backend /api/voice/predict
↓
Backend preprocessing (librosa) → Melspectrogram
↓
TensorFlow model inference → Prediction
↓
Frontend displays results + saves to DB
```

### Record & Analyze
```
User records audio → Frontend (VoiceCaptureModal)
↓
Extract voice features (KNN service)
↓
K-Nearest Neighbors classification (k=5)
↓
Generate clinical reasoning
↓
Save to database
```

## ⚠️ Important Notes

1. **Training Data Scale**: The neural network was trained on professional medical-grade equipment. Consumer microphones may produce different feature scales, potentially affecting accuracy. Results are for demonstration purposes only.

2. **Both Methods Available**: Users can choose between:
   - KNN (transparent feature extraction, real-time)
   - Neural Network (trained model, potentially more robust)

3. **Results Saved Together**: Both methods store in the same database schema, making them comparable in the dashboard.

4. **Error Handling**: If the neural network fails to load or preprocess fails, clear error messages are shown to users.

## 🧪 Testing

To manually test the new endpoint:
```bash
curl -X POST http://localhost:5000/api/voice/predict \
  -F "audio=@test_audio.wav"
```

Expected response:
```json
{
  "label": "Healthy",
  "confidence": 0.85,
  "probabilities": {
    "Parkinsons": 0.15,
    "Healthy": 0.85
  }
}
```

## 📝 Files Modified/Created

### Created
- `frontend/src/services/voiceModel.ts` - Neural network service

### Updated
- `backend/backend_api.py` - Added voice model loading and endpoint
- `frontend/src/components/VoiceCaptureModal.tsx` - Mode selector & upload UI

## ✨ Future Enhancements

- [ ] Add audio preprocessing options (normalization, background noise removal)
- [ ] Support batch processing multiple audio files
- [ ] Visualize melspectrogram for uploaded audio
- [ ] Compare predictions between KNN and neural network
- [ ] Store extracted features for trend analysis
