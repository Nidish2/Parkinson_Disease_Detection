import { useEffect, useRef, useState } from 'react';
import { X, LoaderCircle, AlertCircle, Scan, Upload, Mic, Square, RefreshCw } from 'lucide-react';
import { insertTestRecord } from '../services/testPersistence';
import { useAuth } from '../hooks/useAuth';
import { predictVoice, type VoicePrediction } from '../services/voiceModel';

type VoiceMode = 'record' | 'upload';
type VoiceAnalysisMethod = 'neural';

const SPEAKING_PROMPTS = [
  'Today I am speaking clearly for this short voice screening.',
  'My hands feel steady and my breathing is calm and even.',
  'NeuroCare helps me track voice and movement changes over time.',
];

const getSupportedRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
};

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
};

const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const convertRecordedBlobToWav = async (blob: Blob) => {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error('This browser cannot convert the recorded audio to WAV.');
  }

  const audioContext = new AudioContextConstructor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const mixedSamples = new Float32Array(audioBuffer.length);

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      const channelData = audioBuffer.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
        mixedSamples[sampleIndex] += channelData[sampleIndex] / audioBuffer.numberOfChannels;
      }
    }

    return encodeWav(mixedSamples, audioBuffer.sampleRate);
  } finally {
    await audioContext.close();
  }
};

const getVoiceResultTone = (prediction: VoicePrediction) => {
  const parkinsonsPercent = prediction.probabilities.Parkinsons * 100;
  const healthyPercent = prediction.probabilities.Healthy * 100;
  const threshold = prediction.assessment?.threshold ?? 0.65;
  const borderlineFloor = threshold - (prediction.assessment?.borderlineMargin ?? 0.12);
  const status =
    prediction.assessment?.status ??
    (prediction.probabilities.Parkinsons >= threshold
      ? 'high_risk'
      : prediction.probabilities.Parkinsons >= borderlineFloor
        ? 'borderline'
        : 'healthy_range');

  if (status === 'high_risk') {
    return {
      title: 'Follow-up recommended',
      summary: `This sample showed Parkinsonian speech markers with ${parkinsonsPercent.toFixed(1)}% probability.`,
      badge: 'Needs attention',
      accentPanel: 'border-secondary/30 bg-secondary/10',
      accentIcon: 'bg-secondary/15 text-secondary',
      accentBadge: 'border-secondary/25 bg-secondary/15 text-secondary',
      primaryMetric: 'text-secondary',
      riskBar: 'from-secondary/60 to-secondary',
      healthyBar: 'from-primary/40 to-primary/70',
    };
  }

  if (status === 'borderline') {
    return {
      title: 'Borderline result',
      summary: `This sample is near the clinical decision threshold (${threshold.toFixed(2)}). Please re-record in a quiet room for a clearer result.`,
      badge: 'Retake suggested',
      accentPanel: 'border-amber-400/30 bg-amber-400/10',
      accentIcon: 'bg-amber-400/15 text-amber-300',
      accentBadge: 'border-amber-400/25 bg-amber-400/15 text-amber-300',
      primaryMetric: 'text-amber-300',
      riskBar: 'from-amber-300 to-secondary',
      healthyBar: 'from-primary/40 to-primary/70',
    };
  }

  return {
    title: 'Within healthy range',
    summary: `This sample stayed closer to healthy voice patterns with ${healthyPercent.toFixed(1)}% healthy probability.`,
    badge: 'Stable screening',
    accentPanel: 'border-primary/25 bg-primary/10',
    accentIcon: 'bg-primary/15 text-primary',
    accentBadge: 'border-primary/20 bg-primary/10 text-primary',
    primaryMetric: 'text-primary',
    riskBar: 'from-secondary/45 to-secondary/75',
    healthyBar: 'from-primary/50 to-primary',
  };
};

const VoiceCaptureModal = ({ onClose }: { onClose: () => void }) => {
  const [mode, setMode] = useState<VoiceMode>('record');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [prediction, setPrediction] = useState<VoicePrediction | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [savingResult, setSavingResult] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [predictionSource, setPredictionSource] = useState<VoiceMode>('record');
  const { user } = useAuth();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);

  useEffect(() => {
    return () => {
      stopRecordingStream();
      clearRecordingTimer();
    };
  }, []);

  const clearRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecordingStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const resetFlow = (nextMode?: VoiceMode) => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setPrediction(null);
    setAnalysisError(null);
    setAnalysisStep('');
    setSaveMessage(null);
    setUploadFile(null);
    setRecordedBlob(null);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setIsRecording(false);
    if (nextMode) {
      setMode(nextMode);
    }
  };

  const saveVoiceResult = async (result: VoicePrediction, method: VoiceAnalysisMethod, sourceMode: VoiceMode) => {
    if (!user) {
      setSaveMessage('Sign in to save results.');
      return;
    }

    setSavingResult(true);
    try {
      const probability = result.probabilities.Parkinsons;
      const riskScore = Number((probability * 10).toFixed(1));

      const resultPayload = {
        label: result.label,
        confidence: result.confidence,
        probability,
        riskScore,
        reasoning: result.reasoning,
        probabilities: result.probabilities,
        createdAt: new Date().toISOString(),
        source: sourceMode === 'record' ? 'voice-screening-live' : 'voice-screening-upload',
        modelType: method,
        modelName: result.modelInfo.name,
      };

      const { id } = await insertTestRecord({
        patient_id: user.id,
        test_type: 'speech',
        raw_storage_path: null,
        status: 'completed',
        result: resultPayload,
        confidence: probability,
        model_versions: {
          voiceNeural: result.modelInfo.name,
        },
      });

      const localKey = 'local_tests';
      const existing = localStorage.getItem(localKey);
      const records: Record<string, unknown>[] = existing ? JSON.parse(existing) : [];
      const testRecord = {
        id: id || `local-${Date.now()}`,
        patient_id: user.id,
        test_type: 'speech',
        raw_storage_path: null,
        status: 'completed',
        created_at: new Date().toISOString(),
        result: resultPayload,
        confidence: probability,
        model_versions: {
          voiceNeural: result.modelInfo.name,
        },
      };

      records.unshift(testRecord);
      localStorage.setItem(localKey, JSON.stringify(records));
      setSaveMessage(id ? 'Saved to dashboard' : 'Saved locally');
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage('Saved locally (offline)');
    } finally {
      setSavingResult(false);
    }
  };

  const runPrediction = async (audioBlob: Blob, sourceMode: VoiceMode) => {
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisStep('');
    setSaveMessage(null);
    setPrediction(null);
    setPredictionSource(sourceMode);

    try {
      setAnalysisStep(sourceMode === 'record' ? 'Preparing recorded sample...' : 'Loading audio file...');
      const blob =
        sourceMode === 'record'
          ? await convertRecordedBlobToWav(audioBlob)
          : new Blob([await audioBlob.arrayBuffer()], { type: audioBlob.type || 'audio/webm' });
      setAnalysisStep('Analyzing with voice model...');
      const result = await predictVoice(blob);

      setAnalysisStep('Saving to database...');
      setPrediction(result);
      await saveVoiceResult(result, 'neural', sourceMode);
      setAnalysisStep('Analysis complete!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze voice sample';
      setAnalysisError(message);
      setPrediction(null);
      console.error('Voice analysis error:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setRecordedBlob(null);
      setAnalysisError(null);
      setTimeout(() => {
        void runPrediction(file, 'upload');
      }, 300);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAnalysisError('Microphone recording is not supported in this browser.');
      return;
    }

    try {
      resetFlow();
      stopRecordingStream();
      clearRecordingTimer();
      recordingChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedRecordingMimeType();
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      setIsRecording(true);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearRecordingTimer();
        setIsRecording(false);
        stopRecordingStream();

        const blob = new Blob(recordingChunksRef.current, {
          type: mimeType || recordingChunksRef.current[0]?.type || 'audio/webm',
        });
        recordingChunksRef.current = [];
        setRecordedBlob(blob);

        if (recordingSecondsRef.current < 3) {
          setAnalysisError('Please speak for at least 3 seconds so the sample is stable enough to analyze.');
          return;
        }

        void runPrediction(blob, 'record');
      };

      mediaRecorder.start();
      timerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (error) {
      stopRecordingStream();
      clearRecordingTimer();
      setIsRecording(false);
      setAnalysisError('Microphone access was denied. Please allow microphone permission and try again.');
      console.error('Recording error:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const resultTone = prediction ? getVoiceResultTone(prediction) : null;
  const activePrompt = SPEAKING_PROMPTS[activePromptIndex];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground/20 px-4 py-6 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center md:items-center">
        <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-background/95 shadow-[0_30px_90px_rgba(44,44,36,0.18)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(193,140,93,0.12),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(93,112,82,0.12),_transparent_36%)]" />

          <div className="relative flex items-start justify-between gap-4 border-b border-border/70 bg-background/90 px-6 py-5">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">Voice Screening</p>
              <h3 className="text-2xl font-bold text-foreground">Capture or upload voice</h3>
              <p className="max-w-lg text-sm text-muted-foreground">
                Record a short spoken sample or upload an audio file. Both use the same compact result view.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative max-h-[calc(88vh-92px)] overflow-y-auto px-6 py-6 md:px-7">
            {!prediction ? (
              <div className="space-y-5">
                <div className="inline-flex rounded-full border border-border bg-muted/60 p-1">
                  <button
                    onClick={() => resetFlow('record')}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      mode === 'record' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    Record
                  </button>
                  <button
                    onClick={() => resetFlow('upload')}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      mode === 'upload' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    Upload
                  </button>
                </div>

                {mode === 'record' ? (
                  <div className="space-y-4">
                    <div className="rounded-[1.75rem] border border-border bg-muted/45 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Read aloud</p>
                          <p className="mt-2 max-w-xl text-lg font-semibold leading-relaxed text-foreground">
                            &ldquo;{activePrompt}&rdquo;
                          </p>
                        </div>
                        <button
                          onClick={() => setActivePromptIndex((current) => (current + 1) % SPEAKING_PROMPTS.length)}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-background"
                        >
                          <RefreshCw size={14} />
                          Next sentence
                        </button>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Speak naturally for 4 to 8 seconds, then stop to predict.
                      </p>
                    </div>

                    <div className="rounded-[1.75rem] border border-dashed border-border bg-background/60 p-8 text-center">
                      <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${isRecording ? 'bg-secondary/15 text-secondary' : 'bg-primary/10 text-primary'}`}>
                        {isRecording ? <Square className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
                      </div>
                      <p className="text-base font-semibold text-foreground">
                        {isRecording ? `Recording... ${recordingSeconds}s` : 'Ready to record'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Live microphone mode converts the recording to WAV and sends it directly to the backend voice model.
                      </p>

                      <div className="mt-5 flex justify-center">
                        {isRecording ? (
                          <button
                            onClick={stopRecording}
                            className="rounded-[1.25rem] bg-secondary px-5 py-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/90"
                          >
                            Stop and predict
                          </button>
                        ) : (
                          <button
                            onClick={() => void startRecording()}
                            disabled={analyzing}
                            className="rounded-[1.25rem] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                          >
                            Start speaking
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/55 p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/75">
                    <input
                      type="file"
                      id="voice-upload"
                      className="hidden"
                      onChange={handleFileUpload}
                      accept="audio/*"
                      disabled={analyzing}
                    />
                    <label htmlFor="voice-upload" className="cursor-pointer">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary">
                        <Upload className="h-8 w-8" />
                      </div>
                      {uploadFile ? (
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">{uploadFile.name}</p>
                          <p className="text-xs text-muted-foreground">Tap to replace the file</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">Choose an audio file</p>
                          <p className="text-xs text-muted-foreground">MP3, WAV, or M4A up to 50MB</p>
                        </div>
                      )}
                    </label>
                  </div>
                )}

                {analyzing && analysisStep && (
                  <div className="rounded-2xl border border-primary/15 bg-primary/10 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <p>{analysisStep}</p>
                    </div>
                  </div>
                )}

                {!isRecording && recordedBlob && mode === 'record' && !analyzing ? (
                  <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                    Recorded sample ready. A new recording will replace it.
                  </div>
                ) : null}

                {analysisError && (
                  <div className="flex items-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-destructive">
                    <AlertCircle size={16} />
                    <p className="text-xs font-medium">{analysisError}</p>
                  </div>
                )}
              </div>
            ) : resultTone ? (
              <div className="space-y-5">
                <div className={`rounded-[1.75rem] border p-5 ${resultTone.accentPanel}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-4">
                      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] ${resultTone.accentIcon}`}>
                        <Scan className="h-7 w-7" />
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${resultTone.accentBadge}`}>
                            {resultTone.badge}
                          </span>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            {predictionSource === 'record' ? 'Live speaking' : 'Uploaded audio'}
                          </span>
                        </div>
                        <div>
                          <h4 className="text-2xl font-bold text-foreground">{resultTone.title}</h4>
                          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{resultTone.summary}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.25rem] border border-border/70 bg-background/70 px-4 py-3 text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Confidence</p>
                      <p className={`mt-1 text-2xl font-bold ${resultTone.primaryMetric}`}>
                        {(prediction.confidence * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">Parkinson&apos;s</span>
                        <span className="font-semibold text-secondary">
                          {(prediction.probabilities.Parkinsons * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-accent/70">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${resultTone.riskBar}`}
                          style={{ width: `${prediction.probabilities.Parkinsons * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">Healthy</span>
                        <span className="font-semibold text-primary">
                          {(prediction.probabilities.Healthy * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-accent/70">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${resultTone.healthyBar}`}
                          style={{ width: `${prediction.probabilities.Healthy * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {prediction.reasoning && (
                  <div className="rounded-[1.5rem] border border-border/70 bg-background/70 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Clinical note</p>
                    <p className="mt-2 text-sm leading-relaxed text-foreground">{prediction.reasoning}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-3 py-1.5">Model: {prediction.modelInfo.name}</span>
                  {prediction.assessment ? (
                    <span className="rounded-full bg-muted px-3 py-1.5">
                      Threshold: {prediction.assessment.threshold.toFixed(2)} ({prediction.assessment.sigmoidPositiveClass})
                    </span>
                  ) : null}
                  {savingResult ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      Saving result
                    </span>
                  ) : null}
                  {saveMessage ? <span className="rounded-full bg-primary/10 px-3 py-1.5 text-primary">{saveMessage}</span> : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => resetFlow(mode)}
                    className="rounded-[1.25rem] border border-border bg-background/80 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    Analyze another
                  </button>
                  <button
                    onClick={onClose}
                    className="rounded-[1.25rem] bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceCaptureModal;
