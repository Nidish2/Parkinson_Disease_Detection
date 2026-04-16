import type { LandmarkPoint, PoseFrame, SymptomAnalysis } from './therapyTypes';

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

type WristSample = {
  time: number;
  x: number;
  y: number;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const getLandmark = (landmarks: LandmarkPoint[], index: number) => landmarks[index];

const mean = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const distance = (a: LandmarkPoint, b: LandmarkPoint) => Math.hypot(a.x - b.x, a.y - b.y);

export class ParkinsonAnalyzer {
  private wristHistory: WristSample[] = [];
  private postureAngles: number[] = [];
  private amplitudeRatios: number[] = [];
  private speedValues: number[] = [];
  private lastFrame: PoseFrame | null = null;

  update(frame: PoseFrame | null): SymptomAnalysis {
    if (!frame) {
      this.lastFrame = null;
      return {
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
      };
    }

    const leftWrist = getLandmark(frame.landmarks, LEFT_WRIST);
    const rightWrist = getLandmark(frame.landmarks, RIGHT_WRIST);
    const leftShoulder = getLandmark(frame.landmarks, LEFT_SHOULDER);
    const rightShoulder = getLandmark(frame.landmarks, RIGHT_SHOULDER);
    const leftElbow = getLandmark(frame.landmarks, LEFT_ELBOW);
    const rightElbow = getLandmark(frame.landmarks, RIGHT_ELBOW);

    const upperBodyPoints = [leftWrist, rightWrist, leftShoulder, rightShoulder, leftElbow, rightElbow];
    if (upperBodyPoints.some((point) => !point || point.visibility < 0.2)) {
      this.lastFrame = null;
      return {
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
      };
    }

    const wristCenter = {
      x: (leftWrist.x + rightWrist.x) / 2,
      y: (leftWrist.y + rightWrist.y) / 2,
    };
    this.wristHistory.push({ time: frame.timestamp, ...wristCenter });
    this.wristHistory = this.wristHistory.filter((sample) => frame.timestamp - sample.time < 4000);

    if (this.lastFrame) {
      const dt = Math.max((frame.timestamp - this.lastFrame.timestamp) / 1000, 0.001);
      const prevLeft = getLandmark(this.lastFrame.landmarks, LEFT_WRIST);
      const prevRight = getLandmark(this.lastFrame.landmarks, RIGHT_WRIST);
      if (prevLeft && prevRight) {
        const leftSpeed = distance(leftWrist, prevLeft) / dt;
        const rightSpeed = distance(rightWrist, prevRight) / dt;
        this.speedValues.push((leftSpeed + rightSpeed) / 2);
        this.speedValues = this.speedValues.slice(-40);
      }
    }

    const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.03);
    const postureTilt = Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x) * (180 / Math.PI);
    const currentTilt = Math.abs(postureTilt);
    this.postureAngles.push(currentTilt);
    this.postureAngles = this.postureAngles.slice(-40);

    const leftReach = distance(leftShoulder, leftWrist) / shoulderWidth;
    const rightReach = distance(rightShoulder, rightWrist) / shoulderWidth;
    const elbowExtension = mean([
      distance(leftShoulder, leftElbow) + distance(leftElbow, leftWrist),
      distance(rightShoulder, rightElbow) + distance(rightElbow, rightWrist),
    ]) / (2 * shoulderWidth);
    const amplitude = Math.max(mean([leftReach, rightReach]), elbowExtension);
    this.amplitudeRatios.push(amplitude);
    this.amplitudeRatios = this.amplitudeRatios.slice(-40);

    const diffs = this.wristHistory.slice(1).map((sample, index) => ({
      dx: sample.x - this.wristHistory[index].x,
      dy: sample.y - this.wristHistory[index].y,
    }));

    const significantDiffs = diffs.filter((diff) => Math.abs(diff.dx) > 0.012 || Math.abs(diff.dy) > 0.012);
    let signChanges = 0;
    for (let i = 1; i < significantDiffs.length; i += 1) {
      const diff = significantDiffs[i];
      const prev = significantDiffs[i - 1];
      const xFlip = Math.sign(diff.dx) !== 0 && Math.sign(prev.dx) !== 0 && Math.sign(diff.dx) !== Math.sign(prev.dx);
      const yFlip = Math.sign(diff.dy) !== 0 && Math.sign(prev.dy) !== 0 && Math.sign(diff.dy) !== Math.sign(prev.dy);
      if (xFlip || yFlip) signChanges += 1;
    }

    const avgJitter = mean(diffs.map((diff) => Math.hypot(diff.dx, diff.dy)));
    const tremorScore = clampScore(signChanges * 2.5 + (avgJitter > 0.02 && avgJitter < 0.08 ? 12 : 0));

    const avgSpeed = mean(this.speedValues);
    const hasMovementHistory = this.speedValues.length >= 6;
    const bradykinesiaScore = hasMovementHistory
      ? clampScore(
          avgSpeed < 0.035 ? 70 :
          avgSpeed < 0.06 ? 42 :
          avgSpeed < 0.1 ? 18 : 5,
        )
      : 8;

    const avgTilt = mean(this.postureAngles);
    const postureScore = clampScore(
      avgTilt > 18 ? (avgTilt - 10) * 2.4 :
      avgTilt > 12 ? (avgTilt - 12) * 3 :
      avgTilt > 7 ? (avgTilt - 7) * 2 : 0,
    );

    const amplitudeWindow = this.amplitudeRatios.slice(-20);
    const recentPeakAmplitude = amplitudeWindow.length ? Math.max(...amplitudeWindow) : amplitude;
    const amplitudeScore = clampScore(
      recentPeakAmplitude < 0.75 ? 55 :
      recentPeakAmplitude < 0.95 ? 30 :
      recentPeakAmplitude < 1.15 ? 12 : 0,
    );

    const overallComposite =
      tremorScore * 0.35 +
      bradykinesiaScore * (hasMovementHistory ? 0.2 : 0.08) +
      postureScore * 0.3 +
      amplitudeScore * 0.15;
    const overallRisk = overallComposite >= 58 ? 'HIGH' : overallComposite >= 34 ? 'MEDIUM' : 'LOW';

    this.lastFrame = frame;

    return {
      tremorScore,
      bradykinesiaScore,
      postureScore,
      amplitudeScore,
      overallRisk,
      issues: {
        tremor: tremorScore >= 45,
        speed: hasMovementHistory && avgSpeed < 0.055 ? 'SLOW' : 'NORMAL',
        stability: currentTilt > 12 || avgTilt > 10 ? 'POOR' : 'GOOD',
        amplitude: recentPeakAmplitude < 0.95 ? 'REDUCED' : 'ADEQUATE',
        noPerson: false,
        postureTiltDegrees: Number(currentTilt.toFixed(1)),
      },
    };
  }
}
