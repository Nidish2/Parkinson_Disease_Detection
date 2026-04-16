/**
 * AdvancedAnalyzer.ts
 * Detects: Rigidity, Dyskinesia, Freezing, Gait Analysis
 * Provides deeper Parkinson's symptom analysis beyond basic tremor/bradykinesia
 */

import type { PoseFrame, RigidityMetrics, DykinesiaMetrics, FreezingAnalysis, GaitMetrics, AdvancedSymptomAnalysis } from './therapyTypes';

// MediaPipe landmark indices
const LEFT_SHOULDER = 11, _RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13, _RIGHT_ELBOW = 14;
const LEFT_WRIST = 15, RIGHT_WRIST = 16;
const LEFT_HIP = 23, RIGHT_HIP = 24;
const LEFT_KNEE = 25, RIGHT_KNEE = 26;
const LEFT_ANKLE = 27, RIGHT_ANKLE = 28;

interface JointAngle {
  shoulder: number;  // degrees
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}

interface VelocitySample {
  time: number;
  velocity: number;  // pixels/second
}

export class AdvancedAnalyzer {
  // Rigidity tracking
  private jointAngles: JointAngle[] = [];  // Last 40 frames
  private angularVelocities: number[] = [];  // deg/sec
  private readonly MAX_HISTORY = 40;

  // Dyskinesia/involuntary movement
  private restingPositionSet = false;
  private restingWristPos: { x: number; y: number } | null = null;
  private wristDeviations: number[] = [];  // mm from rest

  // Freezing detection
  private _velocityHistory: VelocitySample[] = [];
  private freezeThreshold = 8;  // pixels/sec (very slow = frozen)
  private freezeMinDuration = 300;  // milliseconds before counting as "freeze"
  private freezeStartTime: number | null = null;
  private freezeCount = 0;
  private totalFreezingTime = 0;  // milliseconds
  private freezeTimes: number[] = [];  // Duration of each freeze

  // Gait analysis (standing/walking)
  private _hipPositions: { x: number; y: number }[] = [];
  private stride: { leftHip: { x: number; y: number }; rightHip: { x: number; y: number } } | null = null;
  private stepCount = 0;
  private lastFrameTime = 0;

  // General state
  private lastFrame: PoseFrame | null = null;
  private sessionStartTime = Date.now();

  /**
   * RIGIDITY DETECTION
   * Measures how stiffly joints move (low angular velocity = high rigidity)
   */
  private calculateJointAngles(frame: PoseFrame): JointAngle | null {
    const landmarks = frame.landmarks;

    // Helper: Calculate angle between 3 points
    const getAngle = (p1: { x: number; y: number }, center: { x: number; y: number }, p2: { x: number; y: number }) => {
      const angle1 = Math.atan2(p1.y - center.y, p1.x - center.x);
      const angle2 = Math.atan2(p2.y - center.y, p2.x - center.x);
      let diff = (angle2 - angle1) * (180 / Math.PI);
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return Math.abs(diff);
    };

    const shoulder = landmarks[LEFT_SHOULDER];
    const elbow = landmarks[LEFT_ELBOW];
    const wrist = landmarks[LEFT_WRIST];
    const hip = landmarks[LEFT_HIP];
    const knee = landmarks[LEFT_KNEE];
    const ankle = landmarks[LEFT_ANKLE];

    // Require visibility
    if (![shoulder, elbow, wrist, hip, knee, ankle].every(l => l.visibility > 0.3)) {
      return null;
    }

    return {
      shoulder: getAngle(wrist, elbow, shoulder), // Elbow angle
      elbow: getAngle(shoulder, elbow, wrist),    // Forearm angle
      wrist: 0,  // Placeholder (complex to calculate)
      hip: getAngle(knee, hip, shoulder),         // Hip flexion
      knee: getAngle(hip, knee, ankle),           // Knee angle
      ankle: 0,  // Placeholder
    };
  }

  private calculateRigidity(frame: PoseFrame): RigidityMetrics {
    const angles = this.calculateJointAngles(frame);

    if (!angles || !this.lastFrame) {
      return {
        shoulderRigidity: 0,
        elbowRigidity: 0,
        wristRigidity: 0,
        overallRigidity: 0,
        angularVelocity: this.angularVelocities,
      };
    }

    // Store history
    this.jointAngles.push(angles);
    if (this.jointAngles.length > this.MAX_HISTORY) {
      this.jointAngles.shift();
    }

    // Calculate angular velocity (change in angle per frame)
    const lastAngles = this.jointAngles[this.jointAngles.length - 2];
    let angularVel = 0;

    if (lastAngles) {
      const timeDiff = (frame.timestamp - this.lastFrame.timestamp) / 1000; // seconds
      if (timeDiff > 0) {
        angularVel = Math.abs(angles.elbow - lastAngles.elbow) / timeDiff; // deg/sec
      }
    }

    this.angularVelocities.push(angularVel);
    if (this.angularVelocities.length > this.MAX_HISTORY) {
      this.angularVelocities.shift();
    }

    // Rigidity = inverse of angular velocity smoothness
    // High variance in velocity = jerky = higher rigidity score (counterintuitive but true for PD)
    const avgVel = this.angularVelocities.reduce((a, b) => a + b, 0) / Math.max(1, this.angularVelocities.length);
    const variance = this.angularVelocities.reduce((sum, v) => sum + (v - avgVel) ** 2, 0) / Math.max(1, this.angularVelocities.length);
    const velocityStdDev = Math.sqrt(variance);

    // Map to 0-100 scale: high std dev (jerky) = high rigidity
    const rigidityScore = Math.min(100, velocityStdDev * 10);

    // Per-joint rigidity approximation
    const shoulderRigidity = Math.min(100, (angles.shoulder < 60 ? 80 : 20) + rigidityScore * 0.1);
    const elbowRigidity = Math.min(100, (avgVel < 30 ? 80 : 20) + rigidityScore * 0.1);
    const wristRigidity = Math.min(100, rigidityScore * 1.2);

    return {
      shoulderRigidity,
      elbowRigidity,
      wristRigidity,
      overallRigidity: (shoulderRigidity + elbowRigidity + wristRigidity) / 3,
      angularVelocity: this.angularVelocities,
    };
  }

  /**
   * DYSKINESIA DETECTION
   * Identifies involuntary movements (resting tremor, writhing, choreaoathetosis)
   */
  private calculateDyskinesia(frame: PoseFrame): DykinesiaMetrics {
    const leftWrist = frame.landmarks[LEFT_WRIST];
    // const rightWrist = frame.landmarks[RIGHT_WRIST]; // For future bilateral analysis

    if (!leftWrist?.visibility || leftWrist.visibility < 0.3) {
      return {
        restingTremor: 0,
        writhing: 0,
        choreoathetosis: 0,
        dyskineticsPresent: false,
      };
    }

    // Initialize resting position (assumes first 1 second user is stationary)
    if (!this.restingPositionSet && (Date.now() - this.sessionStartTime) < 1000) {
      this.restingWristPos = { x: leftWrist.x, y: leftWrist.y };
      this.restingPositionSet = true;
    }

    if (!this.restingWristPos) {
      return {
        restingTremor: 0,
        writhing: 0,
        choreoathetosis: 0,
        dyskineticsPresent: false,
      };
    }

    // Calculate deviation from resting position (in pixels)
    const deviation = Math.sqrt(
      (leftWrist.x - this.restingWristPos.x) ** 2 +
      (leftWrist.y - this.restingWristPos.y) ** 2
    );

    this.wristDeviations.push(deviation * frame.width); // Convert to pixels
    if (this.wristDeviations.length > 100) {
      this.wristDeviations.shift();
    }

    const avgDeviation = this.wristDeviations.reduce((a, b) => a + b, 0) / this.wristDeviations.length;
    const devVariance = this.wristDeviations.reduce((sum, d) => sum + (d - avgDeviation) ** 2, 0) / this.wristDeviations.length;

    // Resting tremor: small periodic oscillations around rest position
    const restingTremor = Math.min(100, Math.sqrt(devVariance) * 30);

    // Writhing: large amplitude involuntary movements (>5cm)
    const largeDeviations = this.wristDeviations.filter(d => d > 50).length;
    const writhing = Math.min(100, (largeDeviations / this.wristDeviations.length) * 100 * 2);

    // Choreoathetosis: smooth flowing movements (check for smooth sinusoidal pattern)
    const deviationChanges = [];
    for (let i = 1; i < this.wristDeviations.length; i++) {
      deviationChanges.push(Math.abs(this.wristDeviations[i] - this.wristDeviations[i - 1]));
    }
    const smoothness = deviationChanges.length > 0
      ? deviationChanges.reduce((a, b) => a + b, 0) / deviationChanges.length
      : 0;
    const choreoathetosis = Math.min(100, smoothness * 2);

    const dyskineticsPresent = restingTremor > 30 || writhing > 20 || choreoathetosis > 40;

    return {
      restingTremor,
      writhing,
      choreoathetosis,
      dyskineticsPresent,
    };
  }

  /**
   * FREEZING DETECTION
   * Identifies sudden motion pauses (akinesia)
   */
  private calculateFreezing(frame: PoseFrame): FreezingAnalysis {
    const leftWrist = frame.landmarks[LEFT_WRIST];
    // const rightWrist = frame.landmarks[RIGHT_WRIST]; // For future bilateral analysis

    if (!leftWrist?.visibility || leftWrist.visibility < 0.3 || !this.lastFrame) {
      return {
        isFrozen: false,
        freezeCount: this.freezeCount,
        totalFreezingTime: this.totalFreezingTime,
        averageFreezeDuration: this.freezeTimes.length > 0
          ? this.freezeTimes.reduce((a, b) => a + b, 0) / this.freezeTimes.length
          : 0,
      };
    }

    // Calculate wrist velocity
    const lastWrist = this.lastFrame.landmarks[LEFT_WRIST];
    const timeDiff = (frame.timestamp - this.lastFrame.timestamp) / 1000; // seconds

    if (timeDiff === 0) {
      return {
        isFrozen: false,
        freezeCount: this.freezeCount,
        totalFreezingTime: this.totalFreezingTime,
        averageFreezeDuration: this.freezeTimes.length > 0
          ? this.freezeTimes.reduce((a, b) => a + b, 0) / this.freezeTimes.length
          : 0,
      };
    }

    const distance = Math.sqrt(
      (leftWrist.x - lastWrist.x) ** 2 +
      (leftWrist.y - lastWrist.y) ** 2
    ) * frame.width; // pixels

    const velocity = distance / timeDiff; // pixels/second

    // Check if frozen
    const isFrozen = velocity < this.freezeThreshold;

    if (isFrozen) {
      if (!this.freezeStartTime) {
        this.freezeStartTime = frame.timestamp;
      }
    } else {
      if (this.freezeStartTime) {
        const freezeDuration = frame.timestamp - this.freezeStartTime;
        if (freezeDuration >= this.freezeMinDuration) {
          this.freezeCount += 1;
          this.freezeTimes.push(freezeDuration);
          this.totalFreezingTime += freezeDuration;
        }
        this.freezeStartTime = null;
      }
    }

    return {
      isFrozen,
      freezeCount: this.freezeCount,
      totalFreezingTime: this.totalFreezingTime,
      averageFreezeDuration: this.freezeTimes.length > 0
        ? this.freezeTimes.reduce((a, b) => a + b, 0) / this.freezeTimes.length
        : 0,
      lastFreezeTime: this.freezeStartTime ?? undefined,
    };
  }

  /**
   * GAIT ANALYSIS
   * Analyzes standing/walking: stride, cadence, balance, knee flexion
   */
  private calculateGait(frame: PoseFrame): GaitMetrics | undefined {
    // Check if person is roughly upright (hip/knee/ankle visible)
    const leftHip = frame.landmarks[LEFT_HIP];
    const rightHip = frame.landmarks[RIGHT_HIP];
    const leftKnee = frame.landmarks[LEFT_KNEE];
    const rightKnee = frame.landmarks[RIGHT_KNEE];
    const leftAnkle = frame.landmarks[LEFT_ANKLE];
    const rightAnkle = frame.landmarks[RIGHT_ANKLE];

    if (![leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle]
      .every(l => l.visibility > 0.3)) {
      return undefined; // Not standing/walking
    }

    // Detect left foot landing (knee extends, hip drops)
    if (this.stride && this.lastFrame) {
      // const lastLeftHip = this.lastFrame.landmarks[LEFT_HIP]; // Not needed for current implementation
      const currentLeftHip = { x: leftHip.x, y: leftHip.y };

      // Simple step detection: horizontal displacement of hip
      if (Math.abs(currentLeftHip.x - this.stride.leftHip.x) > 0.02) {
        this.stepCount += 1;
      }
      this.stride.leftHip = currentLeftHip;
    } else {
      this.stride = {
        leftHip: { x: leftHip.x, y: leftHip.y },
        rightHip: { x: rightHip.x, y: rightHip.y },
      };
    }

    // Calculate metrics
    const timeSinceStart = (frame.timestamp - this.lastFrameTime) / 1000; // seconds
    const cadence = timeSinceStart > 0 ? (this.stepCount / timeSinceStart) * 60 : 0; // steps/min

    // Knee flexion (angle at knee)
    const kneeFlexion = this.getAngleBetween3Points(
      { x: leftHip.x, y: leftHip.y },
      { x: leftKnee.x, y: leftKnee.y },
      { x: leftAnkle.x, y: leftAnkle.y }
    );

    // Ankle range
    const ankleRange = Math.abs(leftAnkle.y - leftKnee.y) * frame.height * 100;

    // Hip drop (vertical distance between hips at stance)
    const hipDrop = Math.abs(leftHip.y - rightHip.y) * frame.height * 100;

    // Stride classification
    const stride = cadence < 80
      ? 'shuffling'
      : cadence < 100
        ? 'short'
        : 'normal';

    // Balance (hip stability)
    const balance = hipDrop > 20 ? 'unstable' : 'stable';

    return {
      stride,
      cadence: cadence || 0,
      balance,
      kneeFlexion,
      ankleRange,
      hipDrop,
    };
  }

  private getAngleBetween3Points(p1: { x: number; y: number }, center: { x: number; y: number }, p2: { x: number; y: number }): number {
    const angle1 = Math.atan2(p1.y - center.y, p1.x - center.x);
    const angle2 = Math.atan2(p2.y - center.y, p2.x - center.x);
    let diff = (angle2 - angle1) * (180 / Math.PI);
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return Math.abs(diff);
  }

  /**
   * Main update function called every frame
   */
  update(frame: PoseFrame | null): AdvancedSymptomAnalysis {
    if (!frame) {
      return {
        rigidity: { shoulderRigidity: 0, elbowRigidity: 0, wristRigidity: 0, overallRigidity: 0, angularVelocity: [] },
        dyskinesia: { restingTremor: 0, writhing: 0, choreoathetosis: 0, dyskineticsPresent: false },
        freezing: { isFrozen: false, freezeCount: 0, totalFreezingTime: 0, averageFreezeDuration: 0 },
      };
    }

    const rigidity = this.calculateRigidity(frame);
    const dyskinesia = this.calculateDyskinesia(frame);
    const freezing = this.calculateFreezing(frame);
    const gait = this.calculateGait(frame);

    this.lastFrame = frame;
    this.lastFrameTime = frame.timestamp;

    return {
      rigidity,
      dyskinesia,
      freezing,
      gait,
    };
  }

  /**
   * Get session summary
   */
  getSummary() {
    return {
      totalFreezes: this.freezeCount,
      totalFreezingTime: this.totalFreezingTime,
      averageFreezeDuration: this.freezeTimes.length > 0
        ? this.freezeTimes.reduce((a, b) => a + b, 0) / this.freezeTimes.length
        : 0,
      avgRigidity: this.angularVelocities.length > 0
        ? Math.min(100, Math.sqrt(
          this.angularVelocities.reduce((sum, v) => sum + v ** 2, 0) / this.angularVelocities.length
        ) * 10)
        : 0,
    };
  }

  reset() {
    this.jointAngles = [];
    this.angularVelocities = [];
    this.wristDeviations = [];
    this._velocityHistory = [];
    this.freezeStartTime = null;
    this.freezeCount = 0;
    this.totalFreezingTime = 0;
    this.freezeTimes = [];
    this.restingPositionSet = false;
    this.sessionStartTime = Date.now();
    this.lastFrame = null;
    this.lastFrameTime = 0;
    this.stepCount = 0;
    this.stride = null;
  }
}
