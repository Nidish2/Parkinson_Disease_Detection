import { useState, useRef, useEffect } from 'react';
import { Mic, X, LoaderCircle, AlertCircle, Square, Scan, Play, UploadCloud, FileAudio, CheckCircle2 } from 'lucide-react';
import { mongodb } from '../lib/mongodbClient';
import { insertTestRecord } from '../services/testPersistence';
import { useAuth } from '../hooks/useAuth';
import {
  extractVoiceFeatures,
  VoiceFeatureVector,
} from '../services/voiceKnnModel';
import { predictFromAudioBlob, AudioPredictionResponse } from '../services/voiceBackendApi';
import { convertBlobToWav } from '../utils/wavConverter';

type PrescriptionPlan = {
  summary: string;
  symptomFlags: string[];
  recommendations: string[];
};

const deriveRiskLevel = (probability: number): 'High' | 'Medium' | 'Low' => {
  if (probability >= 0.7) return 'High';
  if (probability >= 0.4) return 'Medium';
  return 'Low';
};

const describeVoiceSymptoms = (features: VoiceFeatureVector): string[] => {
  const flags: string[] = [];
  if (features.locPctJitter > 1.2) {
    flags.push('Elevated jitter suggests tremor during sustained phonation.');
  }
  if (features.ppq5Jitter > 0.6) {
    flags.push('Perturbation quotient shows irregular pitch periods.');
  }
  if (features.locShimmer > 1.5) {
    flags.push('Increased shimmer highlights amplitude instability.');
  }
  if (features.apq5Shimmer > 3) {
    flags.push('Voice amplitude variability (APQ5) exceeds healthy limits.');
  }
  if (features.meanNoiseToHarmHarmonicity > 0.25) {
    flags.push('Noise-to-harmonics ratio indicates breathiness or vocal fatigue.');
  }
  return flags.length ? flags : ['Voice parameters remain within expected healthy ranges.'];
};

const generatePrescriptionPlan = (prediction: AudioPredictionResponse, features: VoiceFeatureVector): PrescriptionPlan => {
  const riskLevel = deriveRiskLevel(prediction.probabilityOfParkinsons);
  const symptomFlags = describeVoiceSymptoms(features);
  const probabilityText = (prediction.probabilityOfParkinsons * 100).toFixed(1);
  const summary = prediction.label === 'Parkinsons'
    ? `Voice screening indicates a ${riskLevel.toLowerCase()} risk for Parkinsonian speech changes (probability ${probabilityText}%).`
    : `Voice screening suggests low likelihood of Parkinsonian speech changes (probability ${probabilityText}%).`;

  const recommendations: string[] = [
    'Share this screening summary with your neurologist or speech therapist.',
    riskLevel === 'High'
      ? 'Arrange a comprehensive neurological and speech-language evaluation within 14 days.'
      : riskLevel === 'Medium'
        ? 'Book a clinical follow-up within the next month to confirm findings.'
        : 'Repeat the voice screening monthly to monitor any emerging changes.',
    'Practice daily vocal warm-up and breath support exercises for at least 10 minutes.',
  ];

  if (riskLevel !== 'Low') {
    recommendations.push('Keep a brief symptom journal (voice fatigue, tremors, medication changes) to review with your care team.');
  }

  return { summary, symptomFlags, recommendations };
};



const VoiceCaptureModal = ({ onClose }: { onClose: () => void }) => {
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [activeTab, setActiveTab] = useState<'live' | 'upload'>('live');
  const [isHoveringDrop, setIsHoveringDrop] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<AudioPredictionResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [savingResult, setSavingResult] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedTestId, setSavedTestId] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingPrompt, setRecordingPrompt] = useState<string>('');
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { user } = useAuth();

  // Static prompt used directly, removed RECORDING_PROMPTS for cleaner code.
  const RECORDING_DURATION_SECONDS = 30;
  const MIN_RECORDING_DURATION_SECONDS = 3;

  useEffect(() => {
    let cancelled = false;
    setModelLoading(true);
    
    // Simulate model readiness check or fetch from backend
    setTimeout(() => {
      if (cancelled) return;
      setModelError(null);
      setModelLoading(false);
    }, 1000);

    return () => {
      cancelled = true;
    };
  }, []);

  const startRecording = async () => {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        setIsPlayingTTS(false);
      }
      setPrediction(null);
      setSaveMessage(null);
      setSavedTestId(null);
      setError(null);
      setRecordingDuration(0);

      // The prompt is now static in the UI, so no random text or TTS on record start.
      setRecordingPrompt("The North Wind and the Sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveler take his cloak off should be considered stronger than the other.");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecordingStatus('recording');
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
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

        // Automatically trigger KNN analysis after recording
        setTimeout(() => {
          if (!modelError && blob) {
            // Trigger analysis with the new blob
            setAudioBlob(blob);
            triggerAnalysis(blob);
          }
        }, 500);
      };
      mediaRecorderRef.current.start();

      // Start duration counter
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Auto-stop after max duration
      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, RECORDING_DURATION_SECONDS * 1000);
    } catch (err) {
      setError('Microphone access was denied. Please enable it in your browser settings.');
      console.error("Error accessing microphone:", err);
    }
  };

  const persistScreeningResult = async (
    features: VoiceFeatureVector,
    result: AudioPredictionResponse,
    plan: PrescriptionPlan,
  ) => {
    if (!user) {
      setSaveMessage('Sign in to save results to your dashboard.');
      return;
    }
    setSavingResult(true);
    setSaveMessage(null);
    const riskScore = Number((result.probabilityOfParkinsons * 10).toFixed(1));
    const riskLevel = deriveRiskLevel(result.probabilityOfParkinsons);
    const resultPayload = {
      label: result.label,
      probability: result.probabilityOfParkinsons,
      riskScore,
      riskLevel,
      features,
      prescription: plan,
      createdAt: new Date().toISOString(),
      source: 'voice-screening-cloud',
      modelInfo: result.modelInfo,
    };

    try {
      let mongodbSuccess = false;
      let mongoRecordId: string | null = savedTestId;
      if (savedTestId) {
        const { error: updateError } = await mongodb
          .from('tests')
          .update({
            id: savedTestId,
            result: resultPayload,
            confidence: result.probabilityOfParkinsons,
            model_versions: {
              voiceCnn: result.modelInfo?.name || 'Deep Voice CNN',
              dataset: result.modelInfo?.dataset || 'MDVR-KCL',
            },
          });
        if (!updateError) mongodbSuccess = true;
      } else {
        const { id, error: insertError } = await insertTestRecord({
          patient_id: user.id,
          test_type: 'speech',
          raw_storage_path: null,
          status: 'completed',
          result: resultPayload,
          confidence: result.probabilityOfParkinsons,
          model_versions: {
            voiceCnn: result.modelInfo?.name || 'Deep Voice CNN',
            dataset: result.modelInfo?.dataset || 'MDVR-KCL',
          },
        });
        if (id) {
          mongoRecordId = id;
          setSavedTestId(id);
          mongodbSuccess = true;
        } else {
          console.warn('Speech test Mongo insert failed:', insertError);
        }
      }

      // ALWAYS Save to localStorage under `local_tests` for resilience and immediate availability
      const localKey = 'local_tests';
      const existing = localStorage.getItem(localKey);
      let arr: any[] = [];
      if (existing) {
        try { arr = JSON.parse(existing); } catch { arr = []; }
      }
      const localId = mongodbSuccess && mongoRecordId ? mongoRecordId : `local-${Date.now()}`;
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
          voiceCnn: result.modelInfo?.name || 'Deep Voice CNN',
          dataset: result.modelInfo?.dataset || 'MDVR-KCL',
        },
      };
      arr.unshift(testRecord);
      localStorage.setItem(localKey, JSON.stringify(arr));

      if (mongodbSuccess) {
        setSaveMessage('Screening saved to dashboard.');
      } else {
        setSavedTestId(localId);
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
          voiceCnn: result.modelInfo?.name || 'Deep Voice CNN',
          dataset: result.modelInfo?.dataset || 'MDVR-KCL',
        },
      };
      arr.unshift(testRecord);
      localStorage.setItem(localKey, JSON.stringify(arr));
      setSavedTestId(localId);
      setSaveMessage('Screening saved locally (offline mode).');
      setError(dbError instanceof Error ? dbError.message : 'Failed to save screening result to MongoDB.');
      console.error('Failed to persist voice screening result:', dbError);
    } finally {
      setSavingResult(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingStatus === 'recording') {
      // Check minimum duration
      if (recordingDuration < MIN_RECORDING_DURATION_SECONDS) {
        setError(`Please record for at least ${MIN_RECORDING_DURATION_SECONDS} seconds.`);
        return;
      }
      mediaRecorderRef.current.stop();
    }
  };


  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploadedFileName(file.name);
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
    setRecordingStatus('recorded');
    
    // Trigger analysis immediately
    setTimeout(() => {
      triggerAnalysis(file, file.name);
    }, 300);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHoveringDrop(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const triggerAnalysis = async (blob: Blob, customFileName?: string) => {
    if (!blob || modelError) return;
    setAnalyzing(true);
    setSaveMessage(null);
    try {
      // Decode WebM/MP4 locally in browser and strictly send PCM WAV
      const wavBlob = await convertBlobToWav(blob);
      
      const features = await extractVoiceFeatures(wavBlob);
      const result = await predictFromAudioBlob(wavBlob, mongodb.getToken(), customFileName || 'recording.wav');
      const plan = generatePrescriptionPlan(result, features);
      
      setPrediction(result);
      await persistScreeningResult(features, result, plan);
    } catch (analysisFailure) {
      const message = analysisFailure instanceof Error
        ? analysisFailure.message
        : 'Unable to analyse the voice recording locally.';
      setError(message);
      setPrediction(null);
      console.error('Voice analysis failed:', analysisFailure);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!audioBlob || modelError) return;
    setAnalyzing(true);
    setSaveMessage(null);
    try {
      const wavBlob = await convertBlobToWav(audioBlob);
      
      const features = await extractVoiceFeatures(wavBlob);
      const result = await predictFromAudioBlob(wavBlob, mongodb.getToken(), uploadedFileName || 'upload.wav');
      const plan = generatePrescriptionPlan(result, features);
      
      setPrediction(result);
      await persistScreeningResult(features, result, plan);
    } catch (analysisFailure) {
      const message = analysisFailure instanceof Error
        ? analysisFailure.message
        : 'Unable to analyse the voice recording locally.';
      setError(message);
      setPrediction(null);
      console.error('Voice analysis failed:', analysisFailure);
    } finally {
      setAnalyzing(false);
    }
  };
  
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-[#e8e9e1] dark:bg-[#1a1c23] rounded-[2rem] shadow-2xl m-4 relative flex flex-col p-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold font-serif text-blue-800 dark:text-blue-400">Voice Screening</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
            <X size={24} />
          </button>
        </div>
        <div className="space-y-4 text-center">
          {recordingStatus === 'idle' && (
            <div className="space-y-6">
              <div className="flex justify-center border-b border-border/40 pb-2 mb-6">
                <div className="flex space-x-8">
                  <button 
                    onClick={() => setActiveTab('live')}
                    className={`flex items-center space-x-2 pb-2 px-1 border-b-2 transition-colors ${activeTab === 'live' ? 'border-blue-500 text-blue-500 font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    <Mic size={18} />
                    <span>Live Recording</span>
                  </button>
                  <button 
                    onClick={() => setActiveTab('upload')}
                    className={`flex items-center space-x-2 pb-2 px-1 border-b-2 transition-colors ${activeTab === 'upload' ? 'border-blue-500 text-blue-500 font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    <UploadCloud size={18} />
                    <span>Upload Audio</span>
                  </button>
                </div>
              </div>

              {activeTab === 'live' && (
                  <div className="text-left">
                  <div className="flex items-center space-x-2 text-blue-800 dark:text-blue-400 mb-3 font-semibold">
                    <Scan size={20} />
                    <h4>Reading Passage</h4>
                  </div>
                  <div className="text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed mb-4 pl-1">
                    "The North Wind and the Sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveler take his cloak off should be considered stronger than the other."
                  </div>
                  <button 
                    onClick={() => {
                      if ('speechSynthesis' in window) {
                        if (isPlayingTTS) {
                          window.speechSynthesis.cancel();
                          setIsPlayingTTS(false);
                        } else {
                          const utterance = new SpeechSynthesisUtterance("The North Wind and the Sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveler take his cloak off should be considered stronger than the other.");
                          utterance.onend = () => setIsPlayingTTS(false);
                          window.speechSynthesis.speak(utterance);
                          setIsPlayingTTS(true);
                        }
                      }
                    }}
                    className="flex items-center space-x-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium transition-colors mb-8 pl-1"
                  >
                    {isPlayingTTS ? <Square size={16} /> : <Play size={16} />}
                    <span>{isPlayingTTS ? "Stop Playing" : "Listen to Passage (Optional)"}</span>
                  </button>

                  <div className="text-center px-4">
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                      When you're ready, click start and read the passage above in your normal voice. We will record for up to <strong className="text-blue-600 dark:text-blue-400">30 seconds</strong> for model analysis.
                    </p>
                    <button 
                      onClick={startRecording} 
                      className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-xl transition-all shadow-md hover:shadow-lg"
                    >
                      <Mic size={20} />
                      <span className="text-lg">Start Recording</span>
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'upload' && (
                <div className="text-center px-4 py-2">
                  <p className="text-gray-600 dark:text-gray-400 mb-8 text-sm">
                    Already have a high-quality voice recording? Upload it directly here for the most accurate clinical analysis.
                  </p>
                  <div 
                    className={`border-2 border-dashed rounded-xl py-12 px-6 transition-all cursor-pointer flex flex-col items-center justify-center ${isHoveringDrop ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10' : 'border-gray-300 dark:border-gray-700 hover:border-blue-400/50 hover:bg-gray-50/30 dark:hover:bg-gray-800/30'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsHoveringDrop(true); }}
                    onDragLeave={() => setIsHoveringDrop(false)}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('audio-upload')?.click()}
                  >
                    <input 
                      type="file" 
                      id="audio-upload" 
                      accept="audio/*,.webm,.m4a,.wav,.mp3" 
                      className="hidden" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) handleFileUpload(e.target.files[0]);
                      }}
                    />
                    <FileAudio size={48} className="text-blue-600/80 dark:text-blue-400 mb-4" />
                    <h4 className="text-lg font-bold font-serif text-blue-800 dark:text-blue-400 mb-2">Click to Upload Audio File</h4>
                    <p className="text-blue-600/60 dark:text-blue-400/60 text-sm">WAV, MP3, M4A, or WEBM support</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {recordingStatus === 'recording' && (
            <div className="flex flex-col items-center justify-center space-y-6 py-4">
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 rounded-xl p-6 w-full max-w-sm text-center">
                <p className="text-sm font-semibold text-blue-400 mb-3 uppercase tracking-wider">Recording Prompt:</p>
                <p className="text-blue-700 dark:text-blue-300 text-sm leading-relaxed font-medium">
                  {recordingPrompt}
                </p>
              </div>
              
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-mono text-red-500 font-semibold animate-pulse tracking-wider">
                  {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                </span>
                <span className="text-muted-foreground text-sm font-medium">
                  / {RECORDING_DURATION_SECONDS}s max
                </span>
              </div>
              
              <p className="text-muted-foreground text-sm">
                Recording in progress... Press stop when done (min {MIN_RECORDING_DURATION_SECONDS}s).
              </p>
              
              <button 
                onClick={stopRecording} 
                className="flex items-center justify-center w-24 h-24 rounded-full bg-[#8FAD7D] hover:bg-[#7e996e] text-white shadow-lg transition-transform hover:scale-105"
              >
                <Square size={32} className="fill-transparent stroke-2" />
              </button>
            </div>
          )}
            {recordingStatus === 'recorded' && (
              <div className="space-y-6 text-center py-4">
                <p className="text-blue-500/80 dark:text-blue-400 font-medium text-[15px]">
                  {analyzing ? 'Audio successfully captured.' : 'Audio captured. Analysis complete.'}
                </p>
                
                <div className="w-full max-w-sm mx-auto">
                  <audio src={audioUrl!} controls className="w-full" />
                </div>
                
                {analyzing ? (
                  <div className="flex flex-col items-center justify-center space-y-4 pt-8 pb-4">
                    <LoaderCircle className="animate-spin text-blue-500" size={48} />
                    <h4 className="text-xl font-semibold text-blue-600 dark:text-blue-400 mt-4">Processing Audio with MobileNetV2...</h4>
                    <p className="text-blue-400/80 text-sm">Extracting Mel Spectrograms & running clinical inference</p>
                  </div>
                ) : prediction ? (
                  <div className="flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-300">
                    <button
                      onClick={() => {
                        setRecordingStatus('idle');
                        setAudioBlob(null);
                        setAudioUrl(null);
                        setPrediction(null);
                      }}
                      className="text-blue-600 hover:text-blue-700 font-semibold text-[15px] pt-2 pb-4"
                    >
                      Test Another Sample
                    </button>
                    
                    <div className="w-full max-w-sm flex flex-col items-center space-y-6">
                      <div className="text-center">
                        <p className="text-[#a51c30] font-bold text-sm uppercase tracking-[0.15em] mb-2 font-serif">Clinical Model Result</p>
                        <h2 className={`text-4xl font-extrabold font-serif tracking-tight ${prediction.label === 'Parkinsons' ? 'text-[#ff4e4e]' : 'text-[#1db373]'}`}>
                          {prediction.label === 'Parkinsons' ? "Parkinson's Detected" : "Healthy Voice Detected"}
                        </h2>
                      </div>
                      
                      <div className="text-center">
                        <p className="text-blue-800/60 dark:text-blue-400/60 font-semibold text-xs uppercase tracking-[0.1em] mb-1">Model Confidence Score</p>
                        <p className={`text-7xl font-black ${prediction.label === 'Parkinsons' ? 'text-[#ff4e4e]' : 'text-[#1db373]'}`}>
                          {((prediction.label === 'Healthy' ? (1 - prediction.probabilityOfParkinsons) : prediction.probabilityOfParkinsons) * 100).toFixed(1)}<span className="text-3xl font-bold ml-1">%</span>
                        </p>
                      </div>
                      
                      <p className="text-blue-900/80 dark:text-blue-200/60 text-[15px] leading-relaxed max-w-xs mx-auto text-center font-medium">
                        {prediction.label === 'Parkinsons' 
                          ? "The model detected mel spectrogram acoustic patterns highly consistent with Parkinsonian dysarthria or vocal tremor."
                          : "The model found no distinct acoustic patterns consistent with Parkinson's. Voice parameters are largely within healthy ranges."}
                      </p>
                      
                      <div className="pt-2 w-full space-y-8 flex flex-col items-center">
                        {savingResult ? (
                           <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center font-medium">
                             <LoaderCircle className="animate-spin h-4 w-4 mr-2" /> Saving to dashboard...
                           </p>
                        ) : saveMessage ? (
                           <p className="text-[#1db373] dark:text-[#2dd486] text-sm font-semibold">{saveMessage}</p>
                        ) : (
                           <p className="text-[#1db373] dark:text-[#2dd486] text-sm font-semibold">Screening saved to dashboard.</p>
                        )}
                        
                        <button
                          onClick={onClose}
                          className="w-full bg-[#1e293b] dark:bg-[#0f172a] hover:bg-[#0f172a] dark:hover:bg-[#1e293b] text-white font-bold py-4 rounded-xl shadow-md transition-all ease-in-out"
                        >
                          Return to Dashboard
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 max-w-sm mx-auto pt-6">
                    <button
                      onClick={() => {
                        setRecordingStatus('idle');
                        setAudioBlob(null);
                        setAudioUrl(null);
                      }}
                      className="w-full bg-[#bf9468] hover:bg-[#a67c52] text-white font-semibold p-4 rounded-xl shadow-md transition-colors"
                    >
                      Record Again
                    </button>
                    <button
                      onClick={handleAnalyze}
                      disabled={modelLoading || Boolean(modelError)}
                      className="w-full bg-[#3b82f6] hover:bg-[#2563eb] text-white font-semibold p-4 rounded-xl flex items-center justify-center disabled:opacity-60 shadow-md transition-colors"
                    >
                      <Scan size={18} className="mr-2" />
                      Run Voice Screening
                    </button>
                  </div>
                )}
              </div>
            )}
            {error && (
              <div className="flex items-center space-x-2 text-red-400 bg-red-900/20 p-3 rounded-lg mt-4">
                <AlertCircle size={20} />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
      </div>
    </div>
  );
};

export default VoiceCaptureModal;
