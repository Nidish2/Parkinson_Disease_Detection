import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Gauge, RefreshCcw, Sparkles, Target, TimerReset, Trophy, X } from 'lucide-react';
import Card from './Card';
import { useAuth } from '../hooks/useAuth';

const DURATION_MS = 10000;
const CANVAS_HEIGHT = 320;
const PATTERN_OPTIONS = [
  {
    id: 'wave',
    label: 'Wave Flow',
    description: 'Balanced smooth curve for baseline control.',
    difficulty: 'Balanced',
  },
  {
    id: 'arch',
    label: 'Peak Arc',
    description: 'Gentle climb and drop with longer strokes.',
    difficulty: 'Easy',
  },
  {
    id: 'zigzag',
    label: 'Zig Trail',
    description: 'Sharper turns that challenge stability.',
    difficulty: 'Advanced',
  },
  {
    id: 's-curve',
    label: 'S Curve',
    description: 'Two directional changes in one pass.',
    difficulty: 'Moderate',
  },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getAssessmentMessage = (score) => {
  if (score >= 80) return 'Normal motor control';
  if (score >= 50) return 'Slight instability detected';
  return 'High instability detected';
};

const getScoreTone = (score) => {
  if (score >= 80) {
    return {
      text: 'text-emerald-700',
      badge: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20',
      bar: 'from-emerald-300 via-emerald-400 to-emerald-500',
      soft: 'border-emerald-500/20 bg-emerald-500/5',
    };
  }

  if (score >= 50) {
    return {
      text: 'text-amber-700',
      badge: 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20',
      bar: 'from-amber-200 via-amber-300 to-amber-500',
      soft: 'border-amber-500/20 bg-amber-500/5',
    };
  }

  return {
    text: 'text-rose-700',
    badge: 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20',
    bar: 'from-rose-300 via-rose-400 to-rose-500',
    soft: 'border-rose-500/20 bg-rose-500/5',
  };
};

const interpolateKeyPoints = (keyPoints, samplesPerSegment = 30) => {
  const points = [];

  for (let index = 0; index < keyPoints.length - 1; index += 1) {
    const start = keyPoints[index];
    const end = keyPoints[index + 1];

    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
    }
  }

  points.push(keyPoints[keyPoints.length - 1]);
  return points;
};

const createTargetPath = (patternId, width, height) => {
  const left = 34;
  const right = width - 34;
  const usableWidth = right - left;
  const middle = height * 0.54;
  const amplitude = height * 0.17;

  if (patternId === 'arch') {
    return interpolateKeyPoints([
      { x: left, y: middle + amplitude * 0.55 },
      { x: left + usableWidth * 0.18, y: middle + amplitude * 0.2 },
      { x: left + usableWidth * 0.42, y: middle - amplitude * 0.05 },
      { x: left + usableWidth * 0.62, y: middle - amplitude * 1.15 },
      { x: left + usableWidth * 0.82, y: middle - amplitude * 0.2 },
      { x: right, y: middle + amplitude * 0.35 },
    ]);
  }

  if (patternId === 'zigzag') {
    return interpolateKeyPoints([
      { x: left, y: middle + amplitude * 0.5 },
      { x: left + usableWidth * 0.14, y: middle - amplitude * 0.6 },
      { x: left + usableWidth * 0.28, y: middle + amplitude * 0.7 },
      { x: left + usableWidth * 0.45, y: middle - amplitude * 0.85 },
      { x: left + usableWidth * 0.62, y: middle + amplitude * 0.5 },
      { x: left + usableWidth * 0.8, y: middle - amplitude * 0.55 },
      { x: right, y: middle + amplitude * 0.42 },
    ]);
  }

  if (patternId === 's-curve') {
    const points = [];
    const count = 180;
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const x = left + usableWidth * t;
      const y =
        middle +
        Math.sin(t * Math.PI * 1.65 + Math.PI * 0.2) * amplitude * 0.95 +
        Math.sin(t * Math.PI * 3.4) * amplitude * 0.12;
      points.push({ x, y });
    }
    return points;
  }

  const points = [];
  const count = 180;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const x = left + usableWidth * t;
    const primaryWave = Math.sin(t * Math.PI * 2.25) * amplitude;
    const secondaryWave = Math.sin(t * Math.PI * 5.1 + 0.35) * amplitude * 0.16;
    const y = middle + primaryWave * 0.62 + secondaryWave;
    points.push({ x, y });
  }

  return points;
};

const getDistance = (pointA, pointB) => {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const getNearestPathMatch = (point, targetPath) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < targetPath.length; index += 1) {
    const distance = getDistance(point, targetPath[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return { index: bestIndex, distance: bestDistance };
};

const calculateMotorScores = (tracePoints, targetPath, durationMs) => {
  if (tracePoints.length < 8 || targetPath.length < 2) {
    return {
      finalScore: 0,
      accuracy: 0,
      stability: 0,
      speed: 0,
      message: 'High instability detected',
    };
  }

  const matches = tracePoints.map((point) => ({
    ...point,
    ...getNearestPathMatch(point, targetPath),
  }));

  const averageDistance =
    matches.reduce((sum, point) => sum + point.distance, 0) / matches.length;
  const furthestIndex = matches.reduce((best, point) => Math.max(best, point.index), 0);
  const coverage = furthestIndex / (targetPath.length - 1);

  let completionTime = durationMs;
  const finishIndex = Math.floor((targetPath.length - 1) * 0.94);
  const completionPoint = matches.find((point) => point.index >= finishIndex);
  if (completionPoint) {
    completionTime = clamp(completionPoint.timestamp - matches[0].timestamp, 0, durationMs);
  }

  const accuracyBase = clamp(100 - (averageDistance / 42) * 100, 0, 100);
  const accuracy = clamp(accuracyBase * (0.58 + coverage * 0.42), 0, 100);

  let directionChanges = 0;
  let microJitters = 0;
  let measuredSegments = 0;

  for (let index = 2; index < matches.length; index += 1) {
    const prev = matches[index - 1];
    const current = matches[index];
    const before = matches[index - 2];

    const vectorA = { x: prev.x - before.x, y: prev.y - before.y };
    const vectorB = { x: current.x - prev.x, y: current.y - prev.y };
    const magnitudeA = Math.sqrt(vectorA.x * vectorA.x + vectorA.y * vectorA.y);
    const magnitudeB = Math.sqrt(vectorB.x * vectorB.x + vectorB.y * vectorB.y);

    if (magnitudeA < 1.5 || magnitudeB < 1.5) {
      continue;
    }

    measuredSegments += 1;
    const dot = vectorA.x * vectorB.x + vectorA.y * vectorB.y;
    const angle = Math.acos(clamp(dot / (magnitudeA * magnitudeB), -1, 1));

    if (angle > 0.95) {
      directionChanges += 1;
    }

    const horizontalFlip = Math.sign(vectorA.x) !== 0 && Math.sign(vectorA.x) === -Math.sign(vectorB.x);
    const verticalFlip = Math.sign(vectorA.y) !== 0 && Math.sign(vectorA.y) === -Math.sign(vectorB.y);
    if ((horizontalFlip || verticalFlip) && magnitudeA + magnitudeB < 18) {
      microJitters += 1;
    }
  }

  const changeRatio = measuredSegments ? directionChanges / measuredSegments : 1;
  const jitterRatio = measuredSegments ? microJitters / measuredSegments : 1;
  const stability = clamp(100 - changeRatio * 115 - jitterRatio * 85, 0, 100);

  const completionRatio = completionTime >= durationMs ? 0 : 1 - completionTime / durationMs;
  const speed = clamp(coverage * 78 + completionRatio * 22, 0, 100);

  const finalScore = Math.round(
    clamp(accuracy * 0.5 + stability * 0.3 + speed * 0.2, 0, 100),
  );

  return {
    finalScore,
    accuracy: Math.round(accuracy),
    stability: Math.round(stability),
    speed: Math.round(speed),
    message: getAssessmentMessage(finalScore),
  };
};

const persistMotorGameResult = (result, userId, patternId) => {
  if (!userId || !result) return;

  const storedAt = new Date().toISOString();
  const pattern = PATTERN_OPTIONS.find((item) => item.id === patternId);
  const localRecord = {
    id: `local-motor-${Date.now()}`,
    patient_id: userId,
    test_type: 'motor',
    raw_storage_path: 'motor-game',
    processed_storage_path: 'motor-game',
    confidence: Number(Math.max(0.55, result.accuracy / 100).toFixed(2)),
    created_at: storedAt,
    result: {
      label: result.finalScore >= 80 ? 'Stable' : result.finalScore >= 50 ? 'Monitor' : 'Needs Attention',
      riskScore: Number(((100 - result.finalScore) / 10).toFixed(1)),
      motorControlScore: result.finalScore,
      accuracyScore: result.accuracy,
      stabilityScore: result.stability,
      speedScore: result.speed,
      summary: result.message,
      patternId,
      patternLabel: pattern?.label || patternId,
      timestamp: storedAt,
      analysisMethod: 'motor-game-v2',
    },
    model_versions: {
      motor: 'canvas-trace-v2',
    },
  };

  const localTests = JSON.parse(localStorage.getItem('local_tests') || '[]');
  localTests.unshift(localRecord);
  localStorage.setItem('local_tests', JSON.stringify(localTests));

  const localResults = JSON.parse(localStorage.getItem('local_test_results') || '[]');
  localResults.unshift(localRecord);
  localStorage.setItem('local_test_results', JSON.stringify(localResults));
};

const PatternCard = ({ option, isActive, disabled, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(option.id)}
    disabled={disabled}
    className={`rounded-[1.4rem] border p-4 text-left transition-all duration-300 ${
      isActive
        ? 'border-primary/40 bg-primary/10 shadow-soft'
        : 'border-border/40 bg-background/60 hover:border-primary/25 hover:bg-background/80'
    } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{option.label}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">{option.difficulty}</p>
      </div>
      {isActive && (
        <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-foreground">
          Selected
        </span>
      )}
    </div>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{option.description}</p>
  </button>
);

const ScoreBar = ({ label, value }) => {
  const tone = getScoreTone(value);

  return (
    <div className="rounded-2xl border border-border/40 bg-background/65 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}`}>{value}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-[width] duration-700 ease-out`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
};

export default function MotorGame({ onClose }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const drawFrameRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const finishTimeoutRef = useRef(null);
  const hasSavedResultRef = useRef(false);
  const tracePointsRef = useRef([]);
  const pathRef = useRef([]);
  const cursorRef = useRef(null);
  const isDrawingRef = useRef(false);
  const isRunningRef = useRef(false);
  const startTimeRef = useRef(0);
  const lastSampleTimeRef = useRef(0);

  const [selectedPattern, setSelectedPattern] = useState('wave');
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(DURATION_MS);
  const [result, setResult] = useState(null);
  const [traceCount, setTraceCount] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');

  const patternMeta = useMemo(
    () => PATTERN_OPTIONS.find((item) => item.id === selectedPattern) || PATTERN_OPTIONS[0],
    [selectedPattern],
  );
  const progressPercent = clamp((timeLeftMs / DURATION_MS) * 100, 0, 100);
  const displaySeconds = Math.max(0, Math.ceil(timeLeftMs / 1000));

  const drawPolyline = (ctx, points) => {
    if (points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
  };

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, 'rgba(255,255,255,0.92)');
    background.addColorStop(1, 'rgba(237,241,237,0.95)');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    context.lineWidth = 1;
    for (let x = 28; x < width; x += 32) {
      context.beginPath();
      context.moveTo(x, 16);
      context.lineTo(x, height - 16);
      context.stroke();
    }

    const targetPath = pathRef.current;
    if (targetPath.length > 1) {
      context.save();
      drawPolyline(context, targetPath);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = 'rgba(93, 112, 82, 0.12)';
      context.lineWidth = 24;
      context.stroke();
      context.restore();

      context.save();
      drawPolyline(context, targetPath);
      const targetGradient = context.createLinearGradient(0, 0, width, 0);
      targetGradient.addColorStop(0, '#5D7052');
      targetGradient.addColorStop(0.5, '#7E8E67');
      targetGradient.addColorStop(1, '#C18C5D');
      context.strokeStyle = targetGradient;
      context.lineWidth = 8;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
      context.restore();

      const start = targetPath[0];
      const end = targetPath[targetPath.length - 1];
      context.fillStyle = '#5D7052';
      context.beginPath();
      context.arc(start.x, start.y, 7, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(end.x, end.y, 7, 0, Math.PI * 2);
      context.fill();
    }

    const tracePoints = tracePointsRef.current;
    if (tracePoints.length > 1) {
      context.save();
      drawPolyline(context, tracePoints);
      const traceGradient = context.createLinearGradient(0, 0, width, 0);
      traceGradient.addColorStop(0, '#2563eb');
      traceGradient.addColorStop(1, '#38bdf8');
      context.strokeStyle = traceGradient;
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
      context.restore();
    }

    if (cursorRef.current) {
      context.save();
      context.fillStyle = 'rgba(37, 99, 235, 0.2)';
      context.beginPath();
      context.arc(cursorRef.current.x, cursorRef.current.y, 14, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#2563eb';
      context.beginPath();
      context.arc(cursorRef.current.x, cursorRef.current.y, 5.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (drawFrameRef.current) return;

    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null;
      drawScene();
    });
  }, [drawScene]);

  const initializeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    pathRef.current = createTargetPath(selectedPattern, width, height);
    drawScene();
  }, [drawScene, selectedPattern]);

  const clearTimers = useCallback(() => {
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (finishTimeoutRef.current) {
      window.clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    clearTimers();
    isRunningRef.current = false;
    isDrawingRef.current = false;
    onClose();
  }, [clearTimers, onClose]);

  const finishTest = useCallback(() => {
    if (!isRunningRef.current) return;

    clearTimers();
    isDrawingRef.current = false;
    isRunningRef.current = false;
    setIsRunning(false);
    setTimeLeftMs(0);
    setTraceCount(tracePointsRef.current.length);
    setResult(calculateMotorScores(tracePointsRef.current, pathRef.current, DURATION_MS));
    scheduleDraw();
  }, [clearTimers, scheduleDraw]);

  useEffect(() => {
    initializeCanvas();

    const handleResize = () => {
      if (!isRunningRef.current) {
        initializeCanvas();
        return;
      }

      scheduleDraw();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimers();
      if (drawFrameRef.current) {
        cancelAnimationFrame(drawFrameRef.current);
        drawFrameRef.current = null;
      }
    };
  }, [clearTimers, initializeCanvas, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw, result, timeLeftMs, isRunning]);

  useEffect(() => {
    if (isRunningRef.current) return;

    tracePointsRef.current = [];
    cursorRef.current = null;
    lastSampleTimeRef.current = 0;
    setTraceCount(0);
    setResult(null);
    setSaveMessage('');
    hasSavedResultRef.current = false;
    setHasStarted(false);
    setTimeLeftMs(DURATION_MS);
    initializeCanvas();
  }, [initializeCanvas, selectedPattern]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [handleClose]);

  useEffect(() => {
    if (!result || hasSavedResultRef.current) return;

    if (user?.id) {
      persistMotorGameResult(result, user.id, selectedPattern);
      setSaveMessage(`Saved to dashboard using ${patternMeta.label}.`);
    } else {
      setSaveMessage('Result ready locally. Sign in to sync it with dashboard.');
    }
    hasSavedResultRef.current = true;
  }, [patternMeta.label, result, selectedPattern, user]);

  const getPointFromEvent = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const source = 'touches' in event && event.touches.length > 0 ? event.touches[0] : event;
    return {
      x: clamp(source.clientX - rect.left, 0, rect.width),
      y: clamp(source.clientY - rect.top, 0, rect.height),
    };
  };

  const addTracePoint = (point) => {
    if (!point || !isRunningRef.current) return;

    const timestamp = performance.now() - startTimeRef.current;
    const tracePoints = tracePointsRef.current;
    const previousPoint = tracePoints[tracePoints.length - 1];

    if (timestamp - lastSampleTimeRef.current < 10) {
      cursorRef.current = point;
      scheduleDraw();
      return;
    }

    if (previousPoint && getDistance(previousPoint, point) < 1.2) {
      cursorRef.current = point;
      scheduleDraw();
      return;
    }

    lastSampleTimeRef.current = timestamp;
    tracePoints.push({ ...point, timestamp });
    cursorRef.current = point;
    if (tracePoints.length % 12 === 0) {
      setTraceCount(tracePoints.length);
    }
    scheduleDraw();
  };

  const handleStart = () => {
    clearTimers();
    tracePointsRef.current = [];
    cursorRef.current = null;
    hasSavedResultRef.current = false;
    lastSampleTimeRef.current = 0;
    setTraceCount(0);
    setResult(null);
    setSaveMessage('');
    setHasStarted(true);
    setIsRunning(true);
    isRunningRef.current = true;
    setTimeLeftMs(DURATION_MS);
    startTimeRef.current = performance.now();

    finishTimeoutRef.current = window.setTimeout(() => {
      finishTest();
    }, DURATION_MS);

    timerIntervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startTimeRef.current;
      const remaining = clamp(DURATION_MS - elapsed, 0, DURATION_MS);
      setTimeLeftMs(remaining);
      if (remaining <= 0) {
        finishTest();
      }
    }, 100);

    scheduleDraw();
  };

  const handleRetry = () => {
    clearTimers();
    setHasStarted(false);
    setIsRunning(false);
    isRunningRef.current = false;
    setTimeLeftMs(DURATION_MS);
    setResult(null);
    setSaveMessage('');
    setTraceCount(0);
    hasSavedResultRef.current = false;
    tracePointsRef.current = [];
    cursorRef.current = null;
    lastSampleTimeRef.current = 0;
    isDrawingRef.current = false;
    initializeCanvas();
  };

  const handlePatternSelect = (patternId) => {
    if (isRunningRef.current) return;
    setSelectedPattern(patternId);
  };

  const handleMouseDown = (event) => {
    if (!isRunningRef.current) return;
    isDrawingRef.current = true;
    addTracePoint(getPointFromEvent(event.nativeEvent));
  };

  const handleMouseMove = (event) => {
    const point = getPointFromEvent(event.nativeEvent);
    if (!point) return;

    cursorRef.current = point;
    if (isRunningRef.current && isDrawingRef.current) {
      addTracePoint(point);
    } else {
      scheduleDraw();
    }
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    scheduleDraw();
  };

  const handleTouchStart = (event) => {
    if (!isRunningRef.current) return;
    event.preventDefault();
    isDrawingRef.current = true;
    addTracePoint(getPointFromEvent(event.nativeEvent));
  };

  const handleTouchMove = (event) => {
    event.preventDefault();
    const point = getPointFromEvent(event.nativeEvent);
    if (!point) return;

    cursorRef.current = point;
    if (isRunningRef.current && isDrawingRef.current) {
      addTracePoint(point);
    } else {
      scheduleDraw();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center">
        <Card className="my-4 w-full max-w-[1280px] overflow-hidden rounded-[2rem] bg-background/95 p-0">
          <div className="sticky top-0 z-20 border-b border-border/40 bg-background/95 px-6 py-5 backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">NeuroCare Game Test</p>
                <h3 className="mt-2 font-serif text-3xl font-bold text-foreground">Motor Skill Interactive Test</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Pick a path, trace it smoothly, and let NeuroCare score your control, rhythm, and consistency.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] ${getScoreTone(result?.finalScore ?? 82).soft}`}>
                  {patternMeta.label}
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 rounded-full border border-border/60 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center gap-2 rounded-full border border-border/50 px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                  aria-label="Back to tests"
                >
                  <X size={18} />
                  Back
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-[calc(100vh-5rem)] overflow-y-auto">
            <div className="grid gap-6 p-6 2xl:grid-cols-[minmax(0,1.55fr)_360px]">
              <div className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className="rounded-[1.8rem] border border-border/40 bg-background/65 p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-primary/10 p-3">
                        <Sparkles className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-foreground">Choose your tracing challenge</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Different paths highlight different control demands. Balanced paths are smoother; advanced ones test quick correction.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.8rem] border border-border/40 bg-background/65 p-5">
                    <div className="flex h-full flex-col justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Round Control</p>
                        <p className="mt-2 text-2xl font-serif font-bold text-foreground">{displaySeconds}s</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Hold the pointer on the line and keep your motion steady until time ends.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleStart}
                        disabled={isRunning}
                        className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all duration-300 hover:scale-[1.02] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {hasStarted && !result ? 'Test Running...' : 'Start Test'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {PATTERN_OPTIONS.map((option) => (
                    <PatternCard
                      key={option.id}
                      option={option}
                      isActive={selectedPattern === option.id}
                      disabled={isRunning}
                      onSelect={handlePatternSelect}
                    />
                  ))}
                </div>

                <div className="overflow-hidden rounded-[2rem] border border-border/40 bg-white/85 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.55)]">
                  <div className="flex flex-col gap-3 border-b border-border/30 px-5 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Target className="h-4 w-4 text-primary" />
                        Trace the {patternMeta.label} path
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{patternMeta.description}</p>
                    </div>
                    <div className="text-sm font-semibold text-muted-foreground">
                      {displaySeconds}s left
                    </div>
                  </div>

                  <div className="px-5 pt-4">
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary via-secondary to-primary transition-[width] duration-200 ease-linear"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-5">
                    <canvas
                      ref={canvasRef}
                      className="block h-[320px] w-full rounded-[1.6rem] border border-border/30 bg-transparent"
                      style={{ touchAction: 'none', height: `${CANVAS_HEIGHT}px` }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={stopDrawing}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 2xl:sticky 2xl:top-4">
                <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
                  <div className="rounded-[1.6rem] border border-border/40 bg-background/65 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TimerReset className="h-4 w-4 text-primary" />
                      Time
                    </div>
                    <p className="mt-3 text-3xl font-serif font-bold text-foreground">{displaySeconds}s</p>
                  </div>

                  <div className="rounded-[1.6rem] border border-border/40 bg-background/65 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Activity className="h-4 w-4 text-primary" />
                      Samples
                    </div>
                    <p className="mt-3 text-3xl font-serif font-bold text-foreground">{traceCount}</p>
                  </div>

                  <div className="rounded-[1.6rem] border border-border/40 bg-background/65 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Gauge className="h-4 w-4 text-primary" />
                      Difficulty
                    </div>
                    <p className="mt-3 text-xl font-serif font-bold text-foreground">{patternMeta.difficulty}</p>
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-border/40 bg-background/65 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Game Notes</p>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    <p><span className="font-semibold text-foreground">Accuracy:</span> Stay close to the guide line.</p>
                    <p><span className="font-semibold text-foreground">Stability:</span> Fewer micro-corrections score higher.</p>
                    <p><span className="font-semibold text-foreground">Speed:</span> Cover more of the path before time runs out.</p>
                  </div>
                </div>

                {result ? (
                  <div className="rounded-[1.8rem] border border-border/40 bg-background/70 p-5 shadow-soft">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Result</p>
                        <h4 className="mt-2 text-3xl font-serif font-bold text-foreground">Motor Control Score: {result.finalScore}%</h4>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${getScoreTone(result.finalScore).badge}`}>
                        Completed
                      </div>
                    </div>

                    <p className={`mt-3 text-base font-semibold ${getScoreTone(result.finalScore).text}`}>{result.message}</p>
                    {saveMessage && <p className="mt-2 text-sm font-medium text-primary">{saveMessage}</p>}

                    <div className="mt-5 space-y-3">
                      <ScoreBar label="Accuracy" value={result.accuracy} />
                      <ScoreBar label="Stability" value={result.stability} />
                      <ScoreBar label="Speed" value={result.speed} />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="inline-flex items-center gap-2 rounded-full border border-border/60 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Try Again
                      </button>
                      <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        Back to Tests
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[1.8rem] border border-dashed border-border/60 bg-background/55 p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Trophy className="h-4 w-4 text-primary" />
                      Round Preview
                    </div>
                    <h4 className="mt-3 text-2xl font-serif font-bold text-foreground">{patternMeta.label}</h4>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {patternMeta.description} Start when you are ready and keep your line smooth from start to finish.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
