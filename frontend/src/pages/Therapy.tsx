import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Brain, Camera, Mic, Pause, Play, Square, Trophy } from 'lucide-react';
import Card from '../components/Card';
import TherapyCamera from '../components/TherapyCamera';
import Report from '../components/Report';
import ExerciseVisual from '../components/ExerciseVisual';
import { BrowserPoseDetector } from '../components/PoseDetector';
import { ParkinsonAnalyzer } from '../components/ParkinsonAnalyzer';
import { AdvancedAnalyzer } from '../components/AdvancedAnalyzer';
import { ExerciseEngine } from '../components/ExerciseEngine';
import { TherapyAIAgent } from '../components/AIAgent';
import { ProgressionTracker } from '../components/ProgressionTracker';
import type { ExerciseUpdate, SessionReport, SymptomAnalysis } from '../components/therapyTypes';

const STORAGE_KEY = 'therapy-session-history-v2';

const createEmptyAnalysis = (): SymptomAnalysis => ({
  tremorScore: 0,
  bradykinesiaScore: 0,
  postureScore: 0,
  amplitudeScore: 0,
  overallRisk: 'LOW',
  issues: {
    tremor: false,
    speed: 'SLOW',
    stability: 'POOR',
    amplitude: 'REDUCED',
    noPerson: true,
    postureTiltDegrees: 0,
  },
});

const createInitialExerciseUpdate = (): ExerciseUpdate => ({
  exercise: null,
  exerciseIndex: 0,
  totalExercises: 4, // Default to 4 until session starts
  sessionComplete: false,
  metrics: {
    reps: 0,
    targetReps: 0,
    accuracy: 0,
    speed: 'SLOW',
    stability: 'POOR',
    complete: false,
    timerSeconds: 0,
    guidance: 'Preparing session',
    progressPercent: 0,
  },
});

const readHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionReport[]) : [];
  } catch {
    return [];
  }
};

const formatClock = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const Therapy = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BrowserPoseDetector | null>(null);
  const analyzerRef = useRef<ParkinsonAnalyzer | null>(null);
  const advancedAnalyzerRef = useRef<AdvancedAnalyzer | null>(null);
  const engineRef = useRef<ExerciseEngine | null>(null);
  const agentRef = useRef<TherapyAIAgent | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastInferenceAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const lastMessageRef = useRef('');
  const sessionActiveRef = useRef(false);
  const pausedRef = useRef(false);
  const voiceEnabledRef = useRef(true);
  const analysisRef = useRef<SymptomAnalysis>(createEmptyAnalysis());
  const exerciseUpdateRef = useRef<ExerciseUpdate>(createInitialExerciseUpdate());

  const [history, setHistory] = useState<SessionReport[]>(() => readHistory());
  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Idle');
  const [analysis, setAnalysis] = useState<SymptomAnalysis>(createEmptyAnalysis());
  const [exerciseUpdate, setExerciseUpdate] = useState<ExerciseUpdate>(exerciseUpdateRef.current);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // Keep refs in sync
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);

  const speak = useCallback((message: string) => {
    if (!voiceEnabledRef.current || !('speechSynthesis' in window) || !message) return;
    const now = Date.now();
    if (now - lastSpeechAtRef.current < 2200 || lastMessageRef.current === message) return;
    lastSpeechAtRef.current = now;
    lastMessageRef.current = message;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.94;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const cleanup = useCallback((resetCameraState = true) => {
    sessionActiveRef.current = false;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    try {
      detectorRef.current?.dispose();
    } catch (err) {
      console.debug('Error disposing detector:', err);
    }
    detectorRef.current = null;
    try {
      streamRef.current?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          console.debug('Error stopping track:', err);
        }
      });
    } catch (err) {
      console.debug('Error stopping stream:', err);
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch (err) {
      console.debug('Error canceling speech:', err);
    }
    if (resetCameraState) {
      setCameraReady(false);
    }
  }, []);

  const finishSession = useCallback(() => {
    const sessionSnapshot = engineRef.current?.getSessionSnapshot() ?? {
      completedExercises: 0,
      totalReps: 0,
      durationMinutes: 0,
      exerciseSummaries: [],
    };
    const currentAnalysis = analysisRef.current;
    
    // Get advanced analyzer summary
    const advancedSummary = advancedAnalyzerRef.current?.getSummary();
    
    const totalExercises = engineRef.current?.totalExerciseCount() ?? 4;

    // Get progression trend using ProgressionTracker
    const advancedReport: SessionReport = {
      completedAt: new Date().toISOString(),
      tremorScore: currentAnalysis.tremorScore,
      movementSpeedScore: Math.max(0, 100 - currentAnalysis.bradykinesiaScore),
      stabilityScore: Math.max(0, 100 - currentAnalysis.postureScore),
      amplitudeScore: Math.max(0, 100 - currentAnalysis.amplitudeScore),
      overallRisk: currentAnalysis.overallRisk,
      exercisesCompleted: sessionSnapshot.completedExercises,
      totalExercises,
      totalReps: sessionSnapshot.totalReps,
      durationMinutes: Number(sessionSnapshot.durationMinutes.toFixed(1)),
      averageAccuracy: 0,
      summary: '',
      recommendations: [],
      exercisePlan: [],
    };
    
    const recommendations = currentAnalysis.overallRisk === 'HIGH'
      ? [
        'Do these seated exercises 5 days per week in short supervised blocks.',
        'Keep each session to 10 to 15 minutes and stop if you feel dizzy or unstable.',
        'Review these findings with a neurologist or physiotherapist.',
      ]
      : currentAnalysis.overallRisk === 'MEDIUM'
        ? [
          'Do these seated exercises 4 to 5 days per week.',
          'Aim for one short daily routine focusing on smooth movement and posture.',
          'Increase repetitions only if posture stays correct.',
        ]
        : [
          'Do these seated exercises 3 to 4 days per week.',
          'A short daily routine can help maintain mobility and coordination.',
          'Keep focusing on smooth and upright seated posture.',
        ];

    // Add progression-aware recommendations
    const currentHistory = readHistory();
    if (advancedSummary && currentHistory.length > 0) {
      advancedReport.rigidityScore = advancedSummary.avgRigidity ?? 0;
      advancedReport.freezingEvents = advancedSummary.totalFreezes ?? 0;
      advancedReport.averageFreezingDuration = advancedSummary.averageFreezeDuration ?? 0;
      advancedReport.progressionTrend = ProgressionTracker.calculateProgressionTrend(advancedReport, currentHistory);
      
      const progressionRecommendations = ProgressionTracker.generateProgressionRecommendations(
        advancedReport,
        currentHistory,
        currentAnalysis.overallRisk
      );
      recommendations.push(...progressionRecommendations);
    }

    const exercisePlan = sessionSnapshot.exerciseSummaries.map((item: {
      exerciseName: string;
      accuracy: number;
      speed: 'SLOW' | 'NORMAL' | 'FAST';
      benefit: string;
    }) => ({
      exerciseName: item.exerciseName,
      frequency: item.accuracy < 60
        ? 'Practice 5 days per week, 1 guided set daily'
        : item.accuracy < 80
          ? 'Practice 4 days per week, 1 to 2 sets daily'
          : 'Practice 3 to 4 days per week, 1 maintenance set daily',
      benefit: item.benefit,
    }));

    // Calculate average accuracy from all exercises
    const averageAccuracy = sessionSnapshot.exerciseSummaries.length > 0
      ? Math.round(sessionSnapshot.exerciseSummaries.reduce((sum: number, item: any) => sum + item.accuracy, 0) / sessionSnapshot.exerciseSummaries.length)
      : 0;

    const nextReport: SessionReport = {
      completedAt: new Date().toISOString(),
      tremorScore: currentAnalysis.tremorScore,
      movementSpeedScore: Math.max(0, 100 - currentAnalysis.bradykinesiaScore),
      stabilityScore: Math.max(0, 100 - currentAnalysis.postureScore),
      amplitudeScore: Math.max(0, 100 - currentAnalysis.amplitudeScore),
      overallRisk: currentAnalysis.overallRisk,
      exercisesCompleted: sessionSnapshot.completedExercises,
      totalExercises,
      totalReps: sessionSnapshot.totalReps,
      durationMinutes: Number(sessionSnapshot.durationMinutes.toFixed(1)),
      averageAccuracy,
      rigidityScore: Math.round(advancedSummary?.avgRigidity ?? 0),
      freezingEvents: advancedSummary?.totalFreezes ?? 0,
      averageFreezingDuration: Number(((advancedSummary?.averageFreezeDuration ?? 0) / 1000).toFixed(1)),
      summary: `Analysis complete. Your overall risk level is ${currentAnalysis.overallRisk}. We observed a form accuracy of ${averageAccuracy}% across ${sessionSnapshot.completedExercises} exercises. Tremor, speed, and stability scores provide a baseline for your current mobility. Advanced metrics detected ${advancedSummary?.totalFreezes ?? 0} freezing events and a rigidity level of ${Math.round(advancedSummary?.avgRigidity ?? 0)}. Please review the recommendations below and consult with your healthcare provider.`,
      recommendations,
      exercisePlan,
      progressionTrend: advancedReport.progressionTrend,
    };

    startTransition(() => {
      setReport(nextReport);
      setSessionStarted(false);
      setPaused(false);
      setStatusText('Session complete');
      const nextHistory = [nextReport, ...readHistory()].slice(0, 12);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
      setHistory(nextHistory);
    });
    speak(`Assessment complete. Risk level is ${currentAnalysis.overallRisk}. Rigidity level is ${Math.round(advancedSummary?.avgRigidity ?? 0)}.`);
    cleanup();
  }, [cleanup, speak]);

  // Core processing loop — runs every animation frame when session is active
  const processFrame = useCallback(async () => {
    if (!sessionActiveRef.current || pausedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || !detector || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

    const now = performance.now();
    // Increased from 50ms to 100ms to prevent overload
    if (now - lastInferenceAtRef.current < 100) return;
    lastInferenceAtRef.current = now;

    try {
      const frame = await Promise.race([
        detector.estimate(video),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
      ]);

      if (frame) {
        detector.draw(canvas, video, frame);
      }

      const nextAnalysis = analyzerRef.current?.update(frame ?? null) ?? createEmptyAnalysis();
      advancedAnalyzerRef.current?.update(frame ?? null);
      const nextExerciseUpdate = engineRef.current?.update(frame ?? null, nextAnalysis) ?? exerciseUpdateRef.current;
      const agentMessage = agentRef.current?.getMessage({
        ready: true,
        exerciseUpdate: nextExerciseUpdate,
        analysis: nextAnalysis,
        sessionStarted: true,
      });

      analysisRef.current = nextAnalysis;
      exerciseUpdateRef.current = nextExerciseUpdate;

      startTransition(() => {
        setAnalysis(nextAnalysis);
        setExerciseUpdate(nextExerciseUpdate);
        setStatusText(frame ? 'Live analysis active' : 'No person detected - please face camera');
        setError(null);
      });

      if (agentMessage) {
        setStatusText(agentMessage.text);
        if (agentMessage.speak) {
          speak(agentMessage.text);
        }
      }

      if (nextExerciseUpdate.sessionComplete) {
        finishSession();
      }
    } catch (error) {
      // Log but don't crash
      console.debug('Frame processing error:', error);
    }
  }, [speak, finishSession]);

  useEffect(() => () => {
    cleanup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionStarted) return undefined;

    const tick = () => {
      void processFrame();
      if (sessionActiveRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [processFrame, sessionStarted]);

  const startSession = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    lastMessageRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;

      if (!videoRef.current) {
        throw new Error('Video element is not available.');
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      setStatusText('Loading pose model...');

      const detector = new BrowserPoseDetector();
      try {
        await detector.initialize();
      } catch (initError) {
        detector.dispose();
        throw initError;
      }

      detectorRef.current = detector;
      analyzerRef.current = new ParkinsonAnalyzer();
      advancedAnalyzerRef.current = new AdvancedAnalyzer();
      engineRef.current = new ExerciseEngine();
      agentRef.current = new TherapyAIAgent();
      engineRef.current.start();

      setCameraReady(true);
      setSessionStarted(true);
      sessionActiveRef.current = true;
      setStatusText('Starting assessment');
      const firstExercise = engineRef.current.getCurrentExercise();
      if (firstExercise) {
        speak(agentRef.current.getWelcomeMessage(firstExercise.name));
      }
    } catch (sessionError) {
      cleanup();
      const message = sessionError instanceof Error
        ? sessionError.message.includes('load pose runtime') || sessionError.message.includes('initialization has failed')
          ? 'Failed to load the pose model. This is a browser/network issue. Try: 1) Reload the page, 2) Clear browser cache, 3) Use a modern browser (Chrome, Firefox, Edge)'
          : sessionError.message.includes('unavailable in this browser')
            ? 'Your browser doesn\'t support pose detection. Please use Chrome, Firefox, or Edge.'
            : sessionError.message
        : 'Unable to start the therapy session.';
      setError(message);
      setStatusText('Session failed to start');
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    cleanup();
    analyzerRef.current = null;
    advancedAnalyzerRef.current = null;
    engineRef.current = null;
    agentRef.current = null;
    analysisRef.current = createEmptyAnalysis();
    exerciseUpdateRef.current = createInitialExerciseUpdate();
    setAnalysis(createEmptyAnalysis());
    setExerciseUpdate(exerciseUpdateRef.current);
    setPaused(false);
    setSessionStarted(false);
    setReport(null);
    setError(null);
    setStatusText('Idle');
  };

  if (report) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <Report report={report} history={[report, ...history]} onRestart={resetSession} />
        </div>
      </div>
    );
  }

  const currentExercise = exerciseUpdate.exercise;

  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <Card className="rounded-organic-2 border-none bg-[linear-gradient(135deg,rgba(93,112,82,0.15),rgba(193,140,93,0.14),rgba(255,255,255,0.88))]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Real-Time Therapy</p>
              <h1 className="mt-2 text-4xl font-bold text-foreground">Parkinson's Detection + Therapy Assistant</h1>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                Live webcam assessment with pose tracking, symptom scoring, adaptive exercises, voice coaching, milestones, and a session report.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {!sessionStarted ? (
                <button
                  onClick={startSession}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform duration-300 hover:-translate-y-0.5 disabled:opacity-60"
                >
                  <Play className="h-4 w-4" />
                  {loading ? 'Starting...' : 'Start Session'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setPaused((value) => !value)}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-white/75 px-6 py-3 text-sm font-semibold text-foreground"
                  >
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={finishSession}
                    className="inline-flex items-center gap-2 rounded-full bg-destructive px-6 py-3 text-sm font-semibold text-destructive-foreground"
                  >
                    <Square className="h-4 w-4" />
                    End Session
                  </button>
                </>
              )}
            </div>
          </div>
        </Card>

        {error && (
          <div className="flex items-center gap-3 rounded-[1.5rem] border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <TherapyCamera
              videoRef={videoRef}
              canvasRef={canvasRef}
              cameraReady={cameraReady}
              loading={loading}
              error={error}
              personDetected={!analysis.issues.noPerson}
              currentStatus={statusText}
            />

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="rounded-organic-1">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Tremor</p>
                <p className="mt-3 text-3xl font-bold">{analysis.issues.tremor ? 'YES' : 'NO'}</p>
                <p className="mt-2 text-sm text-muted-foreground">Score {analysis.tremorScore}</p>
              </Card>
              <Card className="rounded-organic-2">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Speed</p>
                <p className="mt-3 text-3xl font-bold">{analysis.issues.speed}</p>
                <p className="mt-2 text-sm text-muted-foreground">Bradykinesia score {analysis.bradykinesiaScore}</p>
              </Card>
              <Card className="rounded-organic-3">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Stability</p>
                <p className="mt-3 text-3xl font-bold">{analysis.issues.stability}</p>
                <p className="mt-2 text-sm text-muted-foreground">Tilt {analysis.issues.postureTiltDegrees}&deg;</p>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <Card className="rounded-organic-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Current Exercise</p>
                  <h2 className="mt-2 text-2xl font-semibold">{currentExercise?.name ?? 'Waiting to start'}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{currentExercise?.description ?? 'Start the session to begin your guided assessment.'}</p>
                </div>
                <div className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                  {exerciseUpdate.exerciseIndex + (sessionStarted && currentExercise ? 1 : 0)}/{exerciseUpdate.totalExercises}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <ExerciseVisual exercise={currentExercise} />

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                    <span>Rep counter</span>
                    <span className="font-semibold text-foreground">
                      {exerciseUpdate.metrics.reps}/{exerciseUpdate.metrics.targetReps}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#5D7052,#C18C5D)] transition-all duration-300"
                      style={{ width: `${exerciseUpdate.metrics.progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-3xl bg-muted/70 p-4">
                    <p className="text-muted-foreground">Timer</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{formatClock(exerciseUpdate.metrics.timerSeconds)}</p>
                  </div>
                  <div className="rounded-3xl bg-muted/70 p-4">
                    <p className="text-muted-foreground">Accuracy</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{exerciseUpdate.metrics.accuracy}%</p>
                    <p className="mt-1 text-xs text-muted-foreground">{exerciseUpdate.metrics.postureFeedback ?? 'Checking posture'}</p>
                  </div>
                  <div className="rounded-3xl bg-muted/70 p-4">
                    <p className="text-muted-foreground">Risk level</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{analysis.overallRisk}</p>
                  </div>
                  <div className="rounded-3xl bg-muted/70 p-4">
                    <p className="text-muted-foreground">Amplitude</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{analysis.issues.amplitude}</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-organic-1">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">AI Therapy Agent</h3>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{statusText}</p>
              {exerciseUpdate.metrics.correctiveCommand && (
                <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  Correct now: {exerciseUpdate.metrics.correctiveCommand}
                </div>
              )}
              {exerciseUpdate.metrics.milestone && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <Trophy className="h-4 w-4" />
                  {exerciseUpdate.metrics.milestone}
                </div>
              )}
              {exerciseUpdate.metrics.adaptationNote && (
                <p className="mt-3 rounded-3xl bg-accent/70 p-3 text-sm text-accent-foreground">{exerciseUpdate.metrics.adaptationNote}</p>
              )}
            </Card>

            <Card className="rounded-organic-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Voice Assistant</h3>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={voiceEnabled}
                    onChange={(event) => setVoiceEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  Enabled
                </label>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-3xl bg-muted/70 p-4">
                  <p className="text-muted-foreground">Issue flags</p>
                  <p className="mt-2 font-semibold text-foreground">Tremor: {analysis.issues.tremor ? 'YES' : 'NO'}</p>
                  <p className="font-semibold text-foreground">Speed: {analysis.issues.speed}</p>
                  <p className="font-semibold text-foreground">Stability: {analysis.issues.stability}</p>
                  <p className="font-semibold text-foreground">
                    Posture: {exerciseUpdate.metrics.postureCorrect ? 'CORRECT' : 'NOT CORRECT'}
                  </p>
                </div>
                <div className="rounded-3xl bg-muted/70 p-4">
                  <p className="text-muted-foreground">Medical note</p>
                  <p className="mt-2 text-muted-foreground">
                    These are seated Parkinson's exercises for safer practice. This tool is a screening aid, not a diagnosis.
                  </p>
                </div>
              </div>
            </Card>

            {!sessionStarted && (
              <Card className="rounded-organic-2">
                <div className="flex items-start gap-3">
                  <Camera className="mt-1 h-5 w-5 text-primary" />
                  <div className="text-sm text-muted-foreground">
                    Ensure your upper body and knees are visible, lighting is even, and sit upright in a stable chair for the seated exercises.
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Therapy;
