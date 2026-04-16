# Parkinson's Voice Agent Prototype

This directory contains a backend-only voice AI prototype for Parkinson's early-risk screening over telephony.

## Files

- `app.py`: Flask routes for `/analyze`, `/health`, and the telephony webhook
- `app.py`: Flask routes for `/analyze`, `/health`, `/webhooks/ring-ai`, and Twilio voice endpoints
- `model.py`: model loading, fallback scoring, and risk classification
- `utils/audio_processing.py`: audio download, waveform loading, feature extraction, and mel preprocessing
- `requirements.txt`: Python dependencies

## API Endpoints

### `POST /analyze`

Request:

```json
{
  "audio_url": "https://example.com/call-recording.wav",
  "text": "Yes, I have tremors and sometimes a weak voice."
}
```

Response:

```json
{
  "risk": "Moderate",
  "confidence": 72,
  "message": "Risk level is Moderate",
  "parkinsons_score": 0.58,
  "model_used": "keras_h5+text_fallback",
  "audio_source": "https://example.com/call-recording.wav",
  "text": "Yes, I have tremors and sometimes a weak voice.",
  "features": {
    "duration_seconds": 5.012,
    "pitch_mean_hz": 187.213,
    "pitch_std_hz": 14.422,
    "pitch_range_hz": 42.861,
    "jitter_ratio": 0.03124,
    "voiced_ratio": 0.00851,
    "mfcc_mean": -14.20889,
    "mfcc_std": 49.13111,
    "spectral_centroid_mean": 1124.45911,
    "spectral_bandwidth_mean": 1569.32019,
    "rolloff_mean": 1986.41853,
    "zcr_mean": 0.08412,
    "rms_mean": 0.02812
  },
  "text_flags": [
    "tremors",
    "weak voice"
  ]
}
```

### `POST /webhooks/voice-agent`

Alias: `POST /webhooks/ring-ai`

This is a simple telephony-facing webhook for prompt-by-prompt call orchestration.

It also supports:

- RingCentral `Validation-Token` response headers during webhook setup
- optional `GET` verification with `hub.challenge` and `hub.verify_token`

Initial request:

```json
{
  "call_id": "call-001",
  "event": "call_started"
}
```

Initial response:

```json
{
  "call_id": "call-001",
  "reply": "Hello, I am your AI health assistant. Please say aaaah for 5 seconds after the tone.",
  "say": "Hello, I am your AI health assistant. Please say aaaah for 5 seconds after the tone.",
  "messages": [
    {
      "type": "text",
      "text": "Hello, I am your AI health assistant. Please say aaaah for 5 seconds after the tone."
    }
  ],
  "next_action": "collect_input",
  "expect_input": "audio",
  "end_call": false,
  "state": {
    "call_id": "call-001",
    "stage": "await_vowel"
  }
}
```

### Twilio Voice Endpoints

- `GET|POST /twilio/voice`: initial TwiML for inbound calls
- `POST /twilio/recording-complete`: receives `RecordingUrl` after the 5-second vowel task
- `POST /twilio/recording-status`: stores the final recording callback from Twilio
- `POST /twilio/symptoms`: receives Twilio `SpeechResult`
- `GET|POST /twilio/finalize`: analyzes the recording and speaks the risk level

For Twilio, point your phone number voice webhook to:

```text
https://your-ngrok-url.ngrok-free.app/twilio/voice
```

Follow-up request after the sustained vowel task:

```json
{
  "call_id": "call-001",
  "audio_url": "https://example.com/recordings/call-001.wav",
  "state": {
    "stage": "await_vowel"
  }
}
```

Follow-up request after the symptom question:

```json
{
  "call_id": "call-001",
  "transcript": "Yes, I experience tremors and voice weakness.",
  "state": {
    "stage": "await_symptoms"
  }
}
```

Final response:

```json
{
  "call_id": "call-001",
  "reply": "Based on your voice, your risk level is Moderate. Risk level is Moderate",
  "say": "Based on your voice, your risk level is Moderate. Risk level is Moderate",
  "messages": [
    {
      "type": "text",
      "text": "Based on your voice, your risk level is Moderate. Risk level is Moderate"
    }
  ],
  "next_action": "end_call",
  "expect_input": null,
  "end_call": true,
  "state": {
    "call_id": "call-001",
    "stage": "complete"
  },
  "analysis": {
    "risk": "Moderate",
    "confidence": 72,
    "message": "Risk level is Moderate"
  }
}
```

## Ring AI / RingCentral-style Mapping

Map incoming telephony payload fields into the backend like this:

- `audio_url`: a call recording URL or media URL
- `transcript`: ASR transcript of the caller's answer
- `call_id`: telephony session id, conversation id, or call id

The webhook already checks common aliases such as:

- `audioUrl`, `recording_url`, `recording.contentUri`, `mediaUrl`
- `text`, `transcript`, `utterance`, `speech.transcript`
- `telephonySessionId`, `sessionId`, `conversationId`

## Local Setup

1. Create and activate a virtual environment:

```bash
cd backend/voice_agent
python -m venv .venv
.venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Optional environment variables:

```bash
set VOICE_MODEL_PATH=..\models\Voice\voice_melspec_mobilenetv2.h5
set PORT=5050
set LOG_LEVEL=INFO
set PUBLIC_BASE_URL=https://abc123.ngrok-free.app
set RINGCX_VERIFY_TOKEN=my-verify-token
set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
set TWILIO_AUTH_TOKEN=your_twilio_auth_token
```

4. Run Flask locally:

```bash
python app.py
```

5. Confirm health check:

```bash
curl http://localhost:5050/health
```

## Ngrok Setup

1. Start the Flask app on port `5050`
2. In a separate terminal, expose it:

```bash
ngrok http 5050
```

3. Copy the public HTTPS URL from ngrok, for example:

```text
https://abc123.ngrok-free.app
```

4. Configure your telephony platform webhook to:

```text
https://abc123.ngrok-free.app/webhooks/ring-ai
```

For Twilio inbound voice calls, use:

```text
https://abc123.ngrok-free.app/twilio/voice
```

5. For direct backend testing without the full voice flow, point any server-side integration to:

```text
https://abc123.ngrok-free.app/analyze
```

## RingCentral Notes

- RingCentral webhooks can deliver telephony session events to your webhook URL.
- RingCentral call recordings can be fetched from the recording `contentUri` once a recording is available.
- RingCentral webhook docs show use of a `Validation-Token` header during setup, and this backend now echoes that header back.
- If your Ring AI builder expects a different response envelope, keep the analysis logic as-is and adapt `_agent_response()` in `app.py`.

## Quick Test

Direct analysis:

```bash
curl -X POST http://localhost:5050/analyze ^
  -H "Content-Type: application/json" ^
  -d "{\"audio_url\":\"https://example.com/call.wav\",\"text\":\"I have tremors and a weak voice\"}"
```

Telephony greeting step:

```bash
curl -X POST http://localhost:5050/webhooks/voice-agent ^
  -H "Content-Type: application/json" ^
  -d "{\"call_id\":\"demo-call\",\"event\":\"call_started\"}"
```

Twilio voice XML test:

```bash
curl -X POST http://localhost:5050/twilio/voice
```

## Notes

- If no audio is provided, the system falls back to text-only screening.
- Twilio recording downloads use HTTP Basic Auth when `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set.
- If the `.h5` model cannot be loaded, the backend still runs with a heuristic scorer based on pitch variation, jitter, voiced ratio, and energy.
- This is a prototype for early-risk screening, not a clinical diagnosis system.
