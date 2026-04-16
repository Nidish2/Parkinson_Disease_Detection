import logging
import os
import threading
import time
import uuid
from html import escape
from typing import Any

from flask import Flask, jsonify, request

from model import VoiceRiskAnalyzer


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("voice-agent")

app = Flask(__name__)
analyzer = VoiceRiskAnalyzer()
CALL_SESSIONS: dict[str, dict[str, Any]] = {}
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "3600"))
RINGCX_VERIFY_TOKEN = os.getenv("RINGCX_VERIFY_TOKEN", "").strip()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")


def _normalize_public_base_url(url: str) -> str:
    normalized = url.strip().rstrip("/")
    if normalized.startswith("http://") and "ngrok-free.app" in normalized:
        logger.warning("PUBLIC_BASE_URL used http for an ngrok tunnel; upgrading to https automatically.")
        normalized = "https://" + normalized[len("http://") :]
    return normalized


PUBLIC_BASE_URL = _normalize_public_base_url(PUBLIC_BASE_URL)
ASSISTANT_GREETING = os.getenv(
    "ASSISTANT_GREETING",
    "Hello, I am your Parkinson's screening assistant.",
).strip()
VOICE_TASK_PROMPT = os.getenv(
    "VOICE_TASK_PROMPT",
    "Please say aaaah for 5 seconds after the beep.",
).strip()
SYMPTOM_PROMPT = os.getenv(
    "SYMPTOM_PROMPT",
    "Do you experience tremors or voice weakness? Please say yes, no, or describe it briefly.",
).strip()
FOLLOWUP_WEBSITE_MESSAGE = os.getenv(
    "FOLLOWUP_WEBSITE_MESSAGE",
    "For further screening, please visit our website and complete the spiral and wave drawing checks.",
).strip()


def _cleanup_sessions() -> None:
    now = time.time()
    expired_call_ids = [
        call_id
        for call_id, session in CALL_SESSIONS.items()
        if now - session.get("updated_at", now) > SESSION_TTL_SECONDS
    ]
    for call_id in expired_call_ids:
        CALL_SESSIONS.pop(call_id, None)


def _safe_get(payload: Any, *path: str) -> Any:
    current = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current


def _first_value(payload: dict[str, Any], candidates: list[tuple[str, ...]]) -> Any:
    for path in candidates:
        value = _safe_get(payload, *path)
        if value not in (None, "", []):
            return value
    return None


def _extract_call_id(payload: dict[str, Any]) -> str:
    return str(
        _first_value(
            payload,
            [
                ("call_id",),
                ("callId",),
                ("session_id",),
                ("sessionId",),
                ("conversationId",),
                ("telephonySessionId",),
                ("call", "id"),
                ("session", "id"),
                ("state", "call_id"),
            ],
        )
        or uuid.uuid4()
    )


def _extract_audio_url(payload: dict[str, Any]) -> str | None:
    audio_url = _first_value(
        payload,
        [
            ("audio_url",),
            ("audioUrl",),
            ("recording_url",),
            ("recordingUrl",),
            ("mediaUrl",),
            ("media_url",),
            ("recording", "url"),
            ("recording", "contentUri"),
            ("recording", "audio_url"),
            ("attachments", "audio_url"),
        ],
    )
    return str(audio_url).strip() if audio_url else None


def _extract_transcript(payload: dict[str, Any]) -> str | None:
    transcript = _first_value(
        payload,
        [
            ("text",),
            ("transcript",),
            ("utterance",),
            ("speech", "text"),
            ("speech", "transcript"),
            ("message", "text"),
        ],
    )
    return str(transcript).strip() if transcript else None


def _ensure_session(call_id: str) -> dict[str, Any]:
    session = CALL_SESSIONS.setdefault(
        call_id,
        {
            "call_id": call_id,
            "stage": "start",
            "created_at": time.time(),
            "updated_at": time.time(),
            "audio_url": None,
            "text_answers": [],
        },
    )
    session["updated_at"] = time.time()
    return session


def _absolute_url(path: str) -> str:
    base_url = PUBLIC_BASE_URL or request.url_root.rstrip("/")
    return f"{base_url}{path}"


def _twiml_response(*verbs: str) -> Any:
    xml = '<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(verbs) + "</Response>"
    return app.response_class(xml, status=200, mimetype="text/xml")


def _say(text: str) -> str:
    return f"<Say>{escape(text)}</Say>"


def _pause(length: int) -> str:
    return f'<Pause length="{length}"/>'


def _redirect(url: str, method: str = "POST") -> str:
    return f'<Redirect method="{escape(method)}">{escape(url)}</Redirect>'


def _record(action_url: str, callback_url: str) -> str:
    return (
        f'<Record action="{escape(action_url)}" method="POST" maxLength="8" timeout="2" '
        f'playBeep="true" trim="trim-silence" recordingStatusCallback="{escape(callback_url)}" '
        'recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>'
    )


def _gather_speech(action_url: str, prompt: str) -> str:
    return (
        f'<Gather input="speech" action="{escape(action_url)}" method="POST" speechTimeout="auto">'
        f"{_say(prompt)}"
        "</Gather>"
    )


def _hangup() -> str:
    return "<Hangup/>"


def _run_twilio_analysis(call_id: str) -> None:
    session = CALL_SESSIONS.get(call_id)
    if not session:
        return

    try:
        result = analyzer.analyze(
            audio_url=session.get("audio_url"),
            text=" ".join(session.get("text_answers", [])),
        )
        session["result"] = result
        session["analysis_status"] = "complete"
        session["stage"] = "complete"
        logger.info(
            "Twilio analysis complete for CallSid=%s risk=%s confidence=%s model_used=%s",
            call_id,
            result["risk"],
            result["confidence"],
            result.get("model_used"),
        )
    except Exception as exc:
        logger.exception("Twilio analysis failed for CallSid=%s: %s", call_id, exc)
        session["analysis_status"] = "failed"
        session["analysis_error"] = str(exc)
        session["result"] = {
            "risk": "Moderate",
            "confidence": 50,
            "message": "I could not fully analyze the voice sample, so this result is limited.",
            "model_used": "twilio_failure_fallback",
            "audio_error": str(exc),
        }
    finally:
        session["updated_at"] = time.time()


def _agent_response(
    *,
    call_id: str,
    reply: str,
    stage: str,
    expect_input: str | None = None,
    end_call: bool = False,
    analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = {
        "call_id": call_id,
        "reply": reply,
        "say": reply,
        "messages": [{"type": "text", "text": reply}],
        "next_action": "end_call" if end_call else "collect_input",
        "expect_input": expect_input,
        "end_call": end_call,
        "state": {
            "call_id": call_id,
            "stage": stage,
        },
    }
    if analysis:
        response["analysis"] = analysis
    return response


def _maybe_add_validation_headers(response: Any) -> Any:
    validation_token = request.headers.get("Validation-Token")
    if validation_token:
        response.headers["Validation-Token"] = validation_token
    return response


def _twilio_call_sid() -> str:
    return request.values.get("CallSid") or str(uuid.uuid4())


def _ensure_twilio_session() -> dict[str, Any]:
    return _ensure_session(_twilio_call_sid())


@app.get("/health")
def health() -> Any:
    return _maybe_add_validation_headers(
        jsonify(
            {
                "status": "ok",
                "service": "parkinsons-voice-agent",
                "model_loaded": analyzer.model_loaded,
                "model_path": str(analyzer.model_path),
            }
        )
    )


@app.post("/analyze")
def analyze() -> Any:
    payload = request.get_json(silent=True) or {}
    logger.info("Received /analyze request")

    try:
        result = analyzer.analyze(
            audio_url=payload.get("audio_url"),
            text=payload.get("text"),
        )
        return _maybe_add_validation_headers(jsonify(result))
    except Exception as exc:
        logger.exception("Analyze request failed: %s", exc)
        response = jsonify({"error": str(exc)})
        response.status_code = 500
        return _maybe_add_validation_headers(response)


@app.route("/webhooks/voice-agent", methods=["GET", "POST"])
@app.route("/webhooks/ring-ai", methods=["GET", "POST"])
def voice_agent_webhook() -> Any:
    if request.method == "GET":
        hub_mode = request.args.get("hub.mode")
        hub_challenge = request.args.get("hub.challenge", "")
        hub_verify_token = request.args.get("hub.verify_token", "")

        if hub_mode == "subscribe" and RINGCX_VERIFY_TOKEN and hub_verify_token == RINGCX_VERIFY_TOKEN:
            response = app.response_class(response=hub_challenge, status=200, mimetype="text/plain")
            return _maybe_add_validation_headers(response)

        response = jsonify({"status": "ok", "message": "voice webhook ready"})
        return _maybe_add_validation_headers(response)

    payload = request.get_json(silent=True) or {}
    _cleanup_sessions()

    call_id = _extract_call_id(payload)
    audio_url = _extract_audio_url(payload)
    transcript = _extract_transcript(payload)

    logger.info(
        "Webhook received",
        extra={
            "call_id": call_id,
            "stage": _safe_get(payload, "state", "stage"),
            "has_audio_url": bool(audio_url),
            "has_transcript": bool(transcript),
        },
    )

    session = _ensure_session(call_id)
    incoming_stage = str(_safe_get(payload, "state", "stage") or session["stage"])
    session["stage"] = incoming_stage

    if audio_url:
        session["audio_url"] = audio_url
    if transcript:
        session["text_answers"].append(transcript)

    if session["stage"] == "start":
        session["stage"] = "await_vowel"
        return _maybe_add_validation_headers(
            jsonify(
                _agent_response(
                    call_id=call_id,
                    reply="Hello, I am your AI health assistant. Please say aaaah for 5 seconds after the tone.",
                    stage=session["stage"],
                    expect_input="audio",
                )
            )
        )

    if session["stage"] == "await_vowel":
        if not session.get("audio_url") and not transcript:
            return _maybe_add_validation_headers(
                jsonify(
                    _agent_response(
                        call_id=call_id,
                        reply="I did not receive your voice sample. Please say aaaah for 5 seconds after the tone.",
                        stage=session["stage"],
                        expect_input="audio",
                    )
                )
            )

        session["stage"] = "await_symptoms"
        return _maybe_add_validation_headers(
            jsonify(
                _agent_response(
                    call_id=call_id,
                    reply="Thank you. Do you experience tremors or voice weakness? Please say yes, no, or describe it briefly.",
                    stage=session["stage"],
                    expect_input="speech",
                )
            )
        )

    if session["stage"] == "await_symptoms":
        try:
            result = analyzer.analyze(
                audio_url=session.get("audio_url") or audio_url,
                text=" ".join(session.get("text_answers", [])),
            )
        except Exception as exc:
            logger.exception("Webhook analysis failed for %s: %s", call_id, exc)
            response = jsonify(
                _agent_response(
                    call_id=call_id,
                    reply="I had trouble analyzing that sample. Please try the call again in a quiet room.",
                    stage=session["stage"],
                    end_call=True,
                )
            )
            response.status_code = 500
            return _maybe_add_validation_headers(response)
        session["stage"] = "complete"
        session["result"] = result
        return _maybe_add_validation_headers(
            jsonify(
                _agent_response(
                    call_id=call_id,
                    reply=f"Based on your voice, your risk level is {result['risk']}. {result['message']}",
                    stage=session["stage"],
                    end_call=True,
                    analysis=result,
                )
            )
        )

    result = session.get("result") or analyzer.analyze(
        audio_url=session.get("audio_url") or audio_url,
        text=" ".join(session.get("text_answers", [])),
    )
    return _maybe_add_validation_headers(
        jsonify(
            _agent_response(
                call_id=call_id,
                reply=f"Based on your voice, your risk level is {result['risk']}. {result['message']}",
                stage="complete",
                end_call=True,
                analysis=result,
            )
        )
    )


@app.route("/twilio/voice", methods=["GET", "POST"])
def twilio_voice() -> Any:
    session = _ensure_twilio_session()
    session["stage"] = "await_vowel"
    logger.info("Twilio voice webhook hit for CallSid=%s", session["call_id"])
    return _twiml_response(
        _say(ASSISTANT_GREETING),
        _say(VOICE_TASK_PROMPT),
        _record(
            _absolute_url("/twilio/recording-complete"),
            _absolute_url("/twilio/recording-status"),
        ),
    )


@app.route("/twilio/recording-status", methods=["GET", "POST"])
def twilio_recording_status() -> Any:
    session = _ensure_twilio_session()
    recording_url = (request.values.get("RecordingUrl") or "").strip()
    if recording_url:
        session["audio_url"] = recording_url
    session["recording_status"] = (request.values.get("RecordingStatus") or "completed").strip()
    session["updated_at"] = time.time()
    logger.info(
        "Twilio recording status callback for CallSid=%s status=%s",
        session["call_id"],
        session.get("recording_status"),
    )
    return _twiml_response()


@app.route("/twilio/recording-complete", methods=["GET", "POST"])
def twilio_recording_complete() -> Any:
    session = _ensure_twilio_session()
    recording_url = (request.values.get("RecordingUrl") or "").strip()
    if recording_url:
        session["audio_url"] = recording_url
    session["stage"] = "await_symptoms"
    session["updated_at"] = time.time()
    logger.info("Twilio recording complete for CallSid=%s", session["call_id"])
    return _twiml_response(
        _gather_speech(
            _absolute_url("/twilio/symptoms"),
            SYMPTOM_PROMPT,
        ),
        _say(f"I did not catch that. {SYMPTOM_PROMPT}"),
        _redirect(_absolute_url("/twilio/recording-complete")),
    )


@app.route("/twilio/symptoms", methods=["GET", "POST"])
def twilio_symptoms() -> Any:
    session = _ensure_twilio_session()
    speech_result = (request.values.get("SpeechResult") or "").strip()
    if not speech_result:
        return _twiml_response(
            _gather_speech(
                _absolute_url("/twilio/symptoms"),
                f"Please say yes, no, or briefly describe whether you experience tremors or voice weakness.",
            ),
            _say("I still did not catch that."),
            _hangup(),
        )

    session.setdefault("text_answers", []).append(speech_result)
    session["stage"] = "finalizing"
    session["updated_at"] = time.time()
    return _twiml_response(_redirect(_absolute_url("/twilio/finalize")))


@app.route("/twilio/finalize", methods=["GET", "POST"])
def twilio_finalize() -> Any:
    session = _ensure_twilio_session()
    analysis_status = session.get("analysis_status")

    if analysis_status not in {"processing", "complete", "failed"}:
        session["analysis_status"] = "processing"
        session["updated_at"] = time.time()
        threading.Thread(
            target=_run_twilio_analysis,
            args=(session["call_id"],),
            daemon=True,
        ).start()
        return _twiml_response(
            _say("Please hold while I process your voice sample."),
            _pause(2),
            _redirect(_absolute_url("/twilio/finalize")),
        )

    if analysis_status == "processing":
        wait_count = int(session.get("twilio_wait_count", 0))
        session["twilio_wait_count"] = wait_count + 1
        if wait_count >= 5:
            session["analysis_status"] = "failed"
            session["result"] = {
                "risk": "Moderate",
                "confidence": 50,
                "message": "I could not complete the voice analysis in time, so this is a limited fallback result.",
                "model_used": "twilio_timeout_fallback",
            }
        else:
            return _twiml_response(
                _say("Please hold while I finish processing your voice sample."),
                _pause(2),
                _redirect(_absolute_url("/twilio/finalize")),
            )

    result = session.get("result") or {
        "risk": "Moderate",
        "confidence": 50,
        "message": "I could not fully analyze the voice sample, so this result is limited.",
        "model_used": "twilio_missing_result_fallback",
    }
    return _twiml_response(
        _say(f"Based on your voice, your risk level is {result['risk']}."),
        _say(result["message"]),
        _say(FOLLOWUP_WEBSITE_MESSAGE),
        _hangup(),
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5050"))
    logger.info("Starting voice agent backend on port %s", port)
    app.run(host="0.0.0.0", port=port, debug=False)
