export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type SpeedState = 'SLOW' | 'NORMAL' | 'FAST';
export type StabilityState = 'GOOD' | 'POOR';
export type AmplitudeState = 'REDUCED' | 'ADEQUATE';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  landmarks: LandmarkPoint[];
  timestamp: number;
  width: number;
  height: number;
}

export interface SymptomIssues {
  tremor: boolean;
  speed: SpeedState;
  stability: StabilityState;
  amplitude: AmplitudeState;
  noPerson: boolean;
  postureTiltDegrees: number;
}

export interface SymptomAnalysis {
  tremorScore: number;
  bradykinesiaScore: number;
  postureScore: number;
  amplitudeScore: number;
  overallRisk: RiskLevel;
  issues: SymptomIssues;
}

export interface ExerciseDefinition {
  id: 'seated-hand-raise' | 'finger-tapping' | 'arm-stability' | 'seated-march';
  name: string;
  description: string;
  instructions: string;
  correctiveCue?: string;
  benefit?: string;
  targetReps: number;
  durationSeconds: number;
}

export interface ExerciseMetrics {
  reps: number;
  targetReps: number;
  accuracy: number;
  speed: SpeedState;
  stability: StabilityState;
  complete: boolean;
  timerSeconds: number;
  milestone?: string;
  guidance: string;
  correctiveCommand?: string;
  postureCorrect?: boolean;
  postureFeedback?: string;
  progressPercent: number;
  adaptationNote?: string;
}

export interface ExerciseUpdate {
  exercise: ExerciseDefinition | null;
  exerciseIndex: number;
  totalExercises: number;
  sessionComplete: boolean;
  metrics: ExerciseMetrics;
}

export interface AgentMessage {
  text: string;
  speak: boolean;
  tone: 'neutral' | 'positive' | 'warning';
}

export interface SessionReport {
  completedAt: string;
  tremorScore: number;
  movementSpeedScore: number;
  stabilityScore: number;
  amplitudeScore: number;
  overallRisk: RiskLevel;
  exercisesCompleted: number;
  totalReps: number;
  durationMinutes: number;
  // NEW: Add accuracy and total exercises to the report
  averageAccuracy: number;
  totalExercises: number;
  summary: string;
  recommendations: string[];
  exercisePlan: Array<{
    exerciseName: string;
    frequency: string;
    benefit: string;
  }>;
  // NEW: Advanced tracking metrics
  rigidityScore?: number;           // 0-100: joint stiffness
  dykinesiaScore?: number;          // 0-100: involuntary movements
  freezingEvents?: number;          // Count of motion pauses
  averageFreezingDuration?: number; // Seconds
  gaitMetrics?: GaitMetrics;        // Walking-specific analysis
  progressionTrend?: ProgressionTrend; // Week-over-week change
}

// NEW: Advanced detection types
export interface RigidityMetrics {
  shoulderRigidity: number;         // 0-100
  elbowRigidity: number;            // 0-100
  wristRigidity: number;            // 0-100
  overallRigidity: number;          // Average
  angularVelocity: number[];        // deg/sec history (last 40 frames)
}

export interface DykinesiaMetrics {
  restingTremor: number;            // 0-100: tremor at rest
  writhing: number;                 // 0-100: large involuntary motion
  choreoathetosis: number;          // 0-100: flowing involuntary movements
  dyskineticsPresent: boolean;      // Any dyskinesia detected
}

export interface FreezingAnalysis {
  isFrozen: boolean;                // Currently frozen
  freezeCount: number;              // Total freezes in session
  totalFreezingTime: number;        // Seconds
  averageFreezeDuration: number;    // Seconds
  lastFreezeTime?: number;          // Timestamp of last freeze
}

export interface GaitMetrics {
  stride: 'normal' | 'short' | 'shuffling';
  cadence: number;                  // Steps/minute
  balance: 'stable' | 'unstable';   // Hip/knee stability
  kneeFlexion: number;              // Degrees
  ankleRange: number;               // Degrees
  hipDrop: number;                  // mm per step
}

export interface ProgressionTrend {
  tremor: 'improving' | 'stable' | 'worsening';  // Week-to-week
  speed: 'improving' | 'stable' | 'worsening';
  rigidity: 'improving' | 'stable' | 'worsening';
  freezing: 'none' | 'rare' | 'frequent';
  overallTrajectory: 'improving' | 'stable' | 'declining';
}

// In-session advanced metrics (updated per frame)
export interface AdvancedSymptomAnalysis {
  rigidity: RigidityMetrics;
  dyskinesia: DykinesiaMetrics;
  freezing: FreezingAnalysis;
  gait?: GaitMetrics;               // Only if standing pose detected
}
