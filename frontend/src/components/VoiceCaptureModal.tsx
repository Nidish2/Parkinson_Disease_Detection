
import { useState, useRef, useEffect } from 'react';
import Card from './Card';
import { Mic, X, LoaderCircle, AlertCircle, Square, Scan, Play, Pause, UploadCloud, FileAudio } from 'lucide-react';
import { mongodb } from '../lib/mongodbClient';
import { useAuth } from '../hooks/useAuth';
import { predictFromAudioBlob, AudioPredictionResponse } from '../services/voiceService';

type PrescriptionPlan = {
  summary: string;
  symptomFlags: string[];
  recommendations: string[];
};

type SaveMessageTone = 'success' | 'warning';

const deriveRiskLevel = (probability: number): 'High' | 'Medium' | 'Low' => {
  if (probability >= 0.7) return 'High';
  if (probability >= 0.4) return 'Medium';
  return 'Low';
};

const generatePrescriptionPlan = (result: AudioPredictionResponse): PrescriptionPlan => {
  if (result.modelInfo.ready === false) {
    return {
      summary: "This sample was processed successfully, but the AI model is pending training with the MDVR-KCL dataset.",
      symptomFlags: [
        "Result is simulated for testing the frontend-to-backend pipeline.",
        "Model training requires Kaggle raw audio data."
      ],
      recommendations: [
        "Do not treat this screen as a medical finding.",
        "Wait for the backend CNN model to finish training on mel spectrograms."
      ]
    };
  }

  if (result.probabilityOfParkinsons > 0.6) {
    return {
      summary: 'Analysis detected vocal patterns consistent with Parkinsonian dysarthria.',
      symptomFlags: [
        'Mel spectrograms indicate potential acoustic instability or tremor.',
        'Possible reductions in vocal frequency or amplitude control.'
      ],
      recommendations: [
        'Consult a neurologist or speech-language pathologist.',
        'Perform follow-up assessments for a comprehensive clinical evaluation.'
      ],
    };
  } else {
    return {
      summary: 'Analysis indicates vocal patterns within healthy normative ranges.',
      symptomFlags: [
        'Spectrograms do not show significant signs of Parkinsonian tremor or dysarthria.'
      ],
      recommendations: [
        'Maintain routine health check-ups.',
        'Repeat this screening in 6-12 months as part of normal monitoring.'
      ],
    };
  }
};

const RECORDING_DURATION_MAX_SECONDS = 30; // Max 30 seconds
const RECORDING_DURATION_MIN_SECONDS = 10; // Advise at least 10s

// Reading passage from standard voice assessments
const READING_PASSAGE = "The North Wind and the Sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveler take his cloak off should be considered stronger than the other.";
// Helper function to encode WebM blob into 16-bit PCM WAV for backend compatibility
async function convertToWav(blob: Blob): Promise<Blob> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const numOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length * numOfChannels * 2;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChannels * 2, true);
  view.setUint16(32, numOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);
  
  const channelData = [];
  for (let c = 0; c < numOfChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }
  
  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numOfChannels; channel++) {
      let sample = channelData[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

const VoiceCaptureModal = ({ onClose }: { onClose: () => void }) => {
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [inputMode, setInputMode] = useState<'record' | 'upload'>('record');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AudioPredictionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [savingResult, setSavingResult] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveMessageTone, setSaveMessageTone] = useState<SaveMessageTone>('success');

  const [isPlayingPassage, setIsPlayingPassage] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { user } = useAuth();

  // Initialize SpeechSynthesis
  useEffect(() => {
    utteranceRef.current = new SpeechSynthesisUtterance(READING_PASSAGE);
    utteranceRef.current.rate = 0.9; // Slightly slower for clarity
    utteranceRef.current.pitch = 1;
    
    utteranceRef.current.onend = () => setIsPlayingPassage(false);
    
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const togglePlayback = () => {
    if (isPlayingPassage) {
      window.speechSynthesis.cancel();
      setIsPlayingPassage(false);
    } else {
      if (utteranceRef.current) {
        window.speechSynthesis.speak(utteranceRef.current);
        setIsPlayingPassage(true);
      }
    }
  };

  const startRecording = async () => {
    try {
      setResult(null);
      setError(null);
      setSaveMessage(null);
      setSaveMessageTone('success');
      setRecordingDuration(0);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecordingStatus('recording');
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.onstop = async () => {
        try {
          const webmBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          // Convert the browser's WebM/Opus output into a standard 16-bit PCM WAV to prevent backend libsndfile/FFmpeg errors.
          const wavBlob = await convertToWav(webmBlob);
          
          setAudioBlob(wavBlob);
          setAudioUrl(URL.createObjectURL(wavBlob));
          audioChunksRef.current = [];
          setRecordingStatus('recorded');
          stream.getTracks().forEach(track => track.stop()); // Stop mic access

          // Clear timers
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          if (autoStopTimerRef.current) {
            clearTimeout(autoStopTimerRef.current);
            autoStopTimerRef.current = null;
          }

          // Automatically trigger backend analysis after recording
          setTimeout(() => {
            if (wavBlob) {
              triggerAnalysis(wavBlob);
            }
          }, 500);
        } catch (convertErr) {
          console.error('Audio conversion failed:', convertErr);
          setError('Failed to process recording codec. Please restart the browser or try another device.');
          setRecordingStatus('idle');
          stream.getTracks().forEach(track => track.stop());
        }
      };
      mediaRecorderRef.current.start();

      // Start duration counter
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Auto-stop after max duration
      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, RECORDING_DURATION_MAX_SECONDS * 1000);
    } catch (err) {
      setError('Microphone access was denied. Please enable it in your browser settings.');
      console.error("Error accessing microphone:", err);
    }
  };

  const persistScreeningResult = async (
    result: AudioPredictionResponse,
    plan: PrescriptionPlan,
  ) => {
    if (!user) {
      setSaveMessageTone('warning');
      setSaveMessage('Sign in to save results to your dashboard.');
      return;
    }
    setSavingResult(true);
    setSaveMessage(null);
    setSaveMessageTone('success');
    const riskScore = Number((result.probabilityOfParkinsons * 10).toFixed(1));
    const riskLevel = deriveRiskLevel(result.probabilityOfParkinsons);
    const resultPayload = {
      label: result.label,
      probability: result.probabilityOfParkinsons,
      riskScore,
      riskLevel,
      prescription: plan,
      createdAt: new Date().toISOString(),
      source: 'voice-cnn',
      warnings: result.warnings ?? [],
      modelInfo: result.modelInfo,
    };

    try {
      let mongodbSuccess = false;
      const { data, error: insertError } = await mongodb
        .from('tests')
        .insert({
          patient_id: user.id,
          test_type: 'speech',
          raw_storage_path: null, // Raw audio blob is not stored directly in DB, but sent to backend
          result: resultPayload,
          confidence: result.probabilityOfParkinsons,
          model_versions: {
            voiceCnn: result.modelInfo?.name ?? 'unknown',
            dataset: result.modelInfo?.dataset ?? 'MDVR-KCL',
          },
        });
      const insertedRecord = Array.isArray(data) ? data[0] : data;
      if (!insertError && insertedRecord?.id) {
        mongodbSuccess = true;
      }
      if (mongodbSuccess) {
        setSaveMessageTone('success');
        setSaveMessage('Screening saved to dashboard.');
      } else {
        // Fallback: Save to localStorage under `local_tests` to match other components
        const localKey = 'local_tests';
        const existing = localStorage.getItem(localKey);
        let arr: any[] = [];
        if (existing) {
          try { arr = JSON.parse(existing); } catch { arr = []; }
        }
        const localId = `local-${Date.now()}`;
        const testRecord = {
          id: localId,
          patient_id: user?.id || 'local',
          test_type: 'speech',
          raw_storage_path: null,
          status: 'completed',
          created_at: new Date().toISOString(),
          result: resultPayload,
          confidence: result.probabilityOfParkinsons,
          model_versions: {
            voiceCnn: result.modelInfo?.name ?? 'unknown',
            dataset: result.modelInfo?.dataset ?? 'MDVR-KCL',
          },
        };
        arr.unshift(testRecord);
        localStorage.setItem(localKey, JSON.stringify(arr));
        setSaveMessageTone('warning');
        setSaveMessage('Screening saved locally (offline mode).');
      }
    } catch (dbError) {
      // Fallback: Save to localStorage on error under `local_tests` so History/Dashboard pick it up
      const localKey = 'local_tests';
      const existing = localStorage.getItem(localKey);
      let arr: any[] = [];
      if (existing) {
        try { arr = JSON.parse(existing); } catch { arr = []; }
      }
      const localId = `local-${Date.now()}`;
      const testRecord = {
        id: localId,
        patient_id: user?.id || 'local',
        test_type: 'speech',
        raw_storage_path: null,
        status: 'completed',
        created_at: new Date().toISOString(),
        result: resultPayload,
        confidence: result.probabilityOfParkinsons,
        model_versions: {
          voiceCnn: result.modelInfo?.name ?? 'unknown',
          dataset: result.modelInfo?.dataset ?? 'MDVR-KCL',
        },
      };
      arr.unshift(testRecord);
      localStorage.setItem(localKey, JSON.stringify(arr));
      setSaveMessageTone('warning');
      setSaveMessage('Prediction completed, but database save failed. The result was stored locally in this browser.');
      console.error('Failed to persist voice screening result:', dbError);
    } finally {
      setSavingResult(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingStatus === 'recording') {
      // Check minimum duration
      if (recordingDuration < RECORDING_DURATION_MIN_SECONDS) {
        setError(`Please record for at least ${RECORDING_DURATION_MIN_SECONDS} seconds.`);
        return;
      }
      mediaRecorderRef.current.stop();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRecordingStatus('recorded');
      setAudioBlob(file);
      setAudioUrl(URL.createObjectURL(file));
      triggerAnalysis(file);
    }
  };

  const triggerAnalysis = async (blob: Blob) => {
    if (!blob) return;
    setAnalyzing(true);
    setError(null);
    try {
      // Send raw audio to CNN Deep Learning backend endpoint
      const response = await predictFromAudioBlob(blob, undefined);
      
      setResult(response);
      const plan = generatePrescriptionPlan(response);
      
      await persistScreeningResult(response, plan);
    } catch (err) {
      console.error('Audio Analysis Error:', err);
      setError(err instanceof Error ? err.message : 'Feature extraction or model failed.');
    } finally {
      setAnalyzing(false);
    }
  };
  
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const resultConfidence = result
    ? result.label === 'Parkinsons'
      ? result.probabilityOfParkinsons
      : 1 - result.probabilityOfParkinsons
    : 0;
  const resultHeading = result
    ? result.label === 'Parkinsons'
      ? 'Parkinson\'s Detected'
      : 'No Parkinson\'s Detected'
    : '';
  const resultCardClasses = result?.label === 'Parkinsons'
    ? 'border-red-200 bg-red-50'
    : 'border-emerald-200 bg-emerald-50';
  const resultTextClasses = result?.label === 'Parkinsons'
    ? 'text-red-700'
    : 'text-emerald-700';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex min-h-full items-center justify-center">
        <Card className="w-full max-w-xl max-h-[90vh] overflow-hidden shadow-2xl border-0 rounded-2xl bg-white">
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-xl font-bold bg-gradient-to-r from-blue-700 to-indigo-700 bg-clip-text text-transparent">Voice AI Screening</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"><X size={20} /></button>
        </div>
        
        <div className="p-6 max-h-[calc(90vh-4.5rem)] overflow-y-auto">
          {recordingStatus === 'idle' && (
            <div className="space-y-6">
              
              {/* Premium Tab Selector */}
              <div className="flex bg-slate-100/80 p-1.5 rounded-xl max-w-sm mx-auto shadow-inner">
                <button 
                  onClick={() => setInputMode('record')}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${inputMode === 'record' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Mic size={16} /> Live Recording
                </button>
                <button 
                  onClick={() => setInputMode('upload')}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${inputMode === 'upload' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <UploadCloud size={16} /> Upload Audio
                </button>
              </div>

              {inputMode === 'record' ? (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50/30 p-6 rounded-2xl border border-blue-100/60 mb-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                      <Mic size={100} />
                    </div>
                    <h4 className="font-bold text-blue-900 mb-3 text-lg flex items-center gap-2 relative z-10">
                      <Scan size={20} className="text-blue-600" />
                      Reading Passage
                    </h4>
                    <p className="text-slate-700 text-[1.1rem] leading-relaxed font-medium relative z-10 tracking-wide">"{READING_PASSAGE}"</p>
                    
                    <div className="mt-5 flex gap-3 relative z-10">
                      <button 
                        onClick={togglePlayback}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-xl border border-blue-200 shadow-sm text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-all font-semibold cursor-pointer"
                      >
                        {isPlayingPassage ? <Pause size={18} /> : <Play size={18} />}
                        {isPlayingPassage ? 'Stop Audio' : 'Listen to Passage (Optional)'}
                      </button>
                    </div>
                  </div>

                  <div className="max-w-md mx-auto text-center">
                    <p className="text-slate-700 mb-6 font-medium text-base">
                      When you're ready, click start and read the passage above in your normal voice. We will record for up to <span className="font-bold text-blue-700">{RECORDING_DURATION_MAX_SECONDS} seconds</span> for AI analysis.
                    </p>
                    
                    <div className="grid grid-cols-1 gap-4">
                      <button
                        onClick={startRecording}
                        className="w-full h-14 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all transform hover:scale-[1.02] shadow-md cursor-pointer flex items-center justify-center gap-3 text-lg"
                      >
                        <Mic size={22} />
                        Start Recording
                      </button>
                      <button
                        onClick={onClose}
                        className="w-full h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 text-center max-w-md mx-auto py-4">
                  <p className="text-slate-600 mb-6 font-medium">
                    Already have a high-quality voice recording? Upload it directly here for the most accurate clinical analysis.
                  </p>
                  
                  <label className="border-2 border-dashed border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-300 transition-all p-10 rounded-3xl flex flex-col items-center justify-center cursor-pointer group shadow-sm">
                    <div className="bg-white p-4 rounded-full shadow-sm relative mb-5 group-hover:scale-110 group-hover:shadow-md transition-all duration-300">
                      <FileAudio className="text-indigo-600 w-10 h-10" />
                    </div>
                    <p className="font-bold text-indigo-900 text-xl mb-2">Click to Upload Audio File</p>
                    <p className="text-indigo-600/70 font-medium text-sm">WAV, MP3, M4A, or WEBM support</p>
                    <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              )}
            </div>
          )}
          
          {recordingStatus === 'recording' && (
            <div className="py-8 animate-in zoom-in-95 duration-300">
              <div className="flex flex-col gap-8 justify-center items-center">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-20"></div>
                  <div className="w-32 h-32 rounded-full bg-red-50 border-4 border-red-100 flex items-center justify-center relative z-10 shadow-inner">
                    <Mic className="text-red-600" size={56} />
                  </div>
                </div>
                
                <div className="text-center space-y-2">
                  <p className="text-5xl font-extrabold text-slate-800 tracking-tight">{recordingDuration}s</p>
                  <p className="text-base font-medium text-slate-500">Max {RECORDING_DURATION_MAX_SECONDS}s — Read the full passage</p>
                </div>
                
                <button onClick={stopRecording} className="mt-4 flex items-center justify-center w-24 h-24 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-1">
                  <Square size={36} className="fill-current" />
                </button>
              </div>
            </div>
          )}
          
          {recordingStatus === 'recorded' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center">
                <p className="text-slate-600 font-medium mb-4 text-lg">
                  {analyzing ? 'Audio successfully captured.' : 'Audio captured. Analysis complete.'}
                </p>
                <audio src={audioUrl!} controls className="w-full rounded-xl shadow-sm" />
              </div>
              
              {analyzing && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <LoaderCircle className="animate-spin text-indigo-600" size={36} />
                    <p className="text-lg font-semibold text-indigo-900">Processing Audio with MobileNetV2...</p>
                    <p className="text-indigo-700/80 text-sm font-medium">Extracting Mel Spectrograms & running clinical inference</p>
                  </div>
                </div>
              )}
              
              {!analyzing && !result && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => { setRecordingStatus('idle'); setAudioBlob(null); setAudioUrl(null); }}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold p-4 rounded-xl transition-colors"
                  >
                    Discard & Retry
                  </button>
                  <button
                    onClick={() => audioBlob && triggerAnalysis(audioBlob)}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-md text-white font-bold p-4 rounded-xl flex items-center justify-center transition-all transform hover:-translate-y-0.5"
                  >
                    <Scan size={20} className="mr-2" />
                    Force Analyis Restart
                  </button>
                </div>
              )}
              
              {result && (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => { setRecordingStatus('idle'); setResult(null); setAudioBlob(null); setAudioUrl(null); }}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold p-3 rounded-xl transition-colors"
                  >
                    Test Another Sample
                  </button>
                </div>
              )}
              
              {error && (
                <div className="flex items-center space-x-3 text-red-900 bg-red-50 border border-red-200 p-4 rounded-xl shadow-sm">
                  <AlertCircle size={24} className="flex-shrink-0" />
                  <p className="text-sm font-medium leading-relaxed">{error}</p>
                </div>
              )}
              
              {result && (
                <div className={`rounded-2xl border-2 p-8 text-center shadow-lg transition-colors ${result.label === 'Parkinsons' ? 'border-red-200 bg-gradient-to-b from-red-50 to-white' : 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-white'}`}>
                  <div className={`inline-block px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${result.label === 'Parkinsons' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}>
                    Clinical AI Result
                  </div>
                  
                  <p className={`text-4xl font-extrabold tracking-tight ${resultTextClasses}`}>
                    {resultHeading}
                  </p>
                  
                  <div className="my-8 py-6 border-y border-slate-100/60 bg-white/50 rounded-xl">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">AI Confidence Score</p>
                    <p className={`text-6xl font-black ${resultTextClasses}`}>
                      {(resultConfidence * 100).toFixed(1)}<span className="text-3xl">%</span>
                    </p>
                  </div>
                  
                  <p className="text-base font-medium text-slate-700 max-w-sm mx-auto leading-relaxed">
                    {result.label === 'Parkinsons'
                      ? 'The AI detected mel spectrogram acoustic patterns highly consistent with Parkinsonian dysarthria or vocal tremor.'
                      : 'The AI found normal acoustic profiles with no signs of Parkinsonian micro-tremors or dysarthria.'}
                  </p>
                  
                  {savingResult && (
                    <div className="mt-6 inline-flex items-center justify-center px-4 py-2 bg-slate-50 rounded-full text-sm font-medium text-slate-600">
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin text-blue-600" /> Saving to secure database...
                    </div>
                  )}
                  {saveMessage && !savingResult && (
                    <div className={`mt-6 inline-flex items-center justify-center px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${saveMessageTone === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {saveMessage}
                    </div>
                  )}
                  
                  <button
                    onClick={onClose}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold p-4 rounded-xl mt-8 transition-transform hover:-translate-y-0.5 shadow-md flex items-center justify-center gap-2"
                  >
                    Return to Dashboard
                  </button>
                </div>
              )}
            </div>
          )}
          
          {error && recordingStatus !== 'recorded' && (
            <div className="flex items-center space-x-3 text-red-900 bg-red-50 border border-red-200 p-4 rounded-xl mt-6 shadow-sm">
              <AlertCircle size={24} className="flex-shrink-0" />
              <p className="text-sm font-medium leading-relaxed">{error}</p>
            </div>
          )}
        </div>
        </Card>
      </div>
    </div>
  );
};

export default VoiceCaptureModal;
