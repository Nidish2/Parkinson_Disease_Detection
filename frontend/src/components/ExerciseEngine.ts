import type { ExerciseDefinition, ExerciseUpdate, PoseFrame, SymptomAnalysis } from './therapyTypes';

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

const EXERCISES: ExerciseDefinition[] = [
  {
    id: 'seated-hand-raise',
    name: 'Seated Hand Raise',
    description: 'Sit tall and raise both hands above shoulder level, then lower them.',
    instructions: 'Stay seated upright. Raise both hands above your shoulders, pause briefly, then lower them. Repeat smoothly.',
    correctiveCue: 'Lift both hands higher - try to get them clearly above your shoulders, then bring them back down.',
    benefit: 'Improves shoulder mobility, upright sitting posture, and movement amplitude.',
    targetReps: 6,
    durationSeconds: 45,
  },
  {
    id: 'finger-tapping',
    name: 'Seated Finger Tapping',
    description: 'Sit upright and make quick small tapping motions with your hands.',
    instructions: 'Keep your arms in front of you and make small, rapid up-down tapping motions with your wrists.',
    correctiveCue: 'Move your wrists faster in small up-down motions. Keep your elbows relatively still.',
    benefit: 'Supports hand dexterity, coordination, and speed of fine motor control.',
    targetReps: 10,
    durationSeconds: 35,
  },
  {
    id: 'arm-stability',
    name: 'Seated Arm Stability Hold',
    description: 'Hold both arms outstretched at shoulder height while seated.',
    instructions: 'Raise both arms to the side at shoulder height. Hold them as steady as you can for a few seconds.',
    correctiveCue: 'Raise your arms to shoulder level and try to hold them very still. Breathe slowly.',
    benefit: 'Builds postural control, tremor awareness, and upper-limb stability.',
    targetReps: 3,
    durationSeconds: 35,
  },
  {
    id: 'seated-march',
    name: 'Arm Cross Touch',
    description: 'Touch your left shoulder with your right hand, then your right shoulder with your left hand.',
    instructions: 'Cross your right hand to touch your left shoulder, bring it back, then cross your left hand to touch your right shoulder. Alternate smoothly.',
    correctiveCue: 'Reach your hand across your body to touch the opposite shoulder, then switch hands.',
    benefit: 'Improves cross-body coordination, shoulder flexibility, and bilateral motor control.',
    targetReps: 8,
    durationSeconds: 45,
  },
];

type Phase =
  | 'ready'
  | 'up'
  | 'down'
  | 'close'
  | 'far'
  | 'holding'
  | 'left-cross'
  | 'right-cross'
  | 'neutral'
  | 'tap-up'
  | 'tap-down';

type ExerciseSummary = {
  exerciseName: string;
  accuracy: number;
  speed: 'SLOW' | 'NORMAL' | 'FAST';
  benefit: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

export class ExerciseEngine {
  private sessionExercises: ExerciseDefinition[] = [];
  private exerciseIndex = 0;
  private startedAt = performance.now();
  private exerciseStartedAt = performance.now();
  private reps = 0;
  private lastRepAt = 0;
  private repDurations: number[] = [];
  private accuracyValues: number[] = [];
  private phase: Phase = 'ready';
  private holdSeconds = 0;
  private lastTimestamp = 0;
  private adapted = false;
  private completedExercises = 0;
  private totalReps = 0;
  private exerciseSummaries: ExerciseSummary[] = [];
  private prevWristMidY: number | null = null;
  private tapDirection: 'up' | 'down' | null = null;
  private tapCount = 0;
  private lastWristSample: { lx: number; ly: number; rx: number; ry: number; t: number } | null = null;
  private warmupFrames = 0;

  start() {
    this.sessionExercises = EXERCISES.map((item) => ({ ...item }));
    this.exerciseIndex = 0;
    this.startedAt = performance.now();
    this.exerciseStartedAt = this.startedAt;
    this.completedExercises = 0;
    this.totalReps = 0;
    this.exerciseSummaries = [];
    this.resetExerciseState();
  }

  getCurrentExercise() {
    return this.sessionExercises[this.exerciseIndex] ?? null;
  }

  totalExerciseCount() {
    return this.sessionExercises.length || EXERCISES.length;
  }

  getSessionSnapshot() {
    return {
      completedExercises: this.completedExercises,
      totalReps: this.totalReps,
      durationMinutes: (performance.now() - this.startedAt) / 60000,
      exerciseSummaries: this.exerciseSummaries,
    };
  }

  update(frame: PoseFrame | null, analysis: SymptomAnalysis): ExerciseUpdate {
    const exercise = this.getCurrentExercise();
    if (!exercise) {
      return {
        exercise: null,
        exerciseIndex: this.exerciseIndex,
        totalExercises: this.totalExerciseCount(),
        sessionComplete: true,
        metrics: {
          reps: this.reps,
          targetReps: 0,
          accuracy: 0,
          speed: 'NORMAL',
          stability: 'GOOD',
          complete: true,
          timerSeconds: Math.round((performance.now() - this.exerciseStartedAt) / 1000),
          guidance: 'Session complete. Great job.',
          correctiveCommand: undefined,
          postureCorrect: true,
          postureFeedback: 'Session complete.',
          progressPercent: 100,
        },
      };
    }

    const timerSeconds = Math.round((performance.now() - this.exerciseStartedAt) / 1000);

    if (!frame) {
      this.warmupFrames = 0;
      return {
        exercise,
        exerciseIndex: this.exerciseIndex,
        totalExercises: this.totalExerciseCount(),
        sessionComplete: false,
        metrics: {
          reps: this.reps,
          targetReps: exercise.targetReps,
          accuracy: 0,
          speed: 'SLOW',
          stability: 'POOR',
          complete: false,
          timerSeconds,
          guidance: 'Stand or sit facing the camera so I can see your shoulders, arms, and hands.',
          correctiveCommand: 'Make sure your upper body is visible in the camera.',
          postureCorrect: false,
          postureFeedback: 'Body not visible.',
          progressPercent: (this.reps / exercise.targetReps) * 100,
        },
      };
    }

    const lShoulder = frame.landmarks[LEFT_SHOULDER];
    const rShoulder = frame.landmarks[RIGHT_SHOULDER];
    const lWrist = frame.landmarks[LEFT_WRIST];
    const rWrist = frame.landmarks[RIGHT_WRIST];
    const lElbow = frame.landmarks[LEFT_ELBOW];
    const rElbow = frame.landmarks[RIGHT_ELBOW];

    const coreVisible = [lShoulder, rShoulder, lWrist, rWrist, lElbow, rElbow].every((point) => point && point.visibility > 0.2);

    if (!coreVisible) {
      this.warmupFrames = 0;
      return {
        exercise,
        exerciseIndex: this.exerciseIndex,
        totalExercises: this.totalExerciseCount(),
        sessionComplete: false,
        metrics: {
          reps: this.reps,
          targetReps: exercise.targetReps,
          accuracy: 15,
          speed: 'SLOW',
          stability: 'POOR',
          complete: false,
          timerSeconds,
          guidance: exercise.instructions,
          correctiveCommand: 'Move back a bit so the camera can see your shoulders, elbows, and hands clearly.',
          postureCorrect: false,
          postureFeedback: 'Cannot see your arms fully.',
          progressPercent: clamp((this.reps / exercise.targetReps) * 100),
        },
      };
    }

    this.warmupFrames += 1;

    const wristMidY = (lWrist.y + rWrist.y) / 2;
    const shoulderWidth = Math.max(Math.abs(lShoulder.x - rShoulder.x), 0.03);
    const shoulderTilt = Math.abs(lShoulder.y - rShoulder.y) / shoulderWidth;
    const postureCorrect = shoulderTilt < 0.5;
    const postureFeedback = postureCorrect
      ? 'Posture correct - keep it up!'
      : 'Try to level your shoulders and sit up straight.';

    let milestone: string | undefined;
    let adaptationNote: string | undefined;
    let correctiveCommand: string | undefined;
    let movementFormScore = 0;

    const isWarmedUp = this.warmupFrames > 15;

    switch (exercise.id) {
      case 'seated-hand-raise': {
        const bothWristsAboveShoulders = lWrist.y < lShoulder.y && rWrist.y < rShoulder.y;
        const bothWristsBelowShoulders = lWrist.y > lShoulder.y + 0.03 && rWrist.y > rShoulder.y + 0.03;

        if (isWarmedUp) {
          if (this.phase !== 'up' && bothWristsAboveShoulders) {
            this.phase = 'up';
          } else if (this.phase === 'up' && bothWristsBelowShoulders) {
            this.completeRep(frame.timestamp);
            this.phase = 'down';
            milestone = this.reps === exercise.targetReps
              ? 'Hand raises complete.'
              : this.reps === Math.ceil(exercise.targetReps / 2)
                ? 'Halfway through hand raises.'
                : undefined;
          }
        }

        const avgWristY = (lWrist.y + rWrist.y) / 2;
        const avgShoulderY = (lShoulder.y + rShoulder.y) / 2;
        const heightDiff = avgShoulderY - avgWristY;

        if (heightDiff <= 0) {
          movementFormScore = 0;
        } else if (heightDiff >= 0.2) {
          movementFormScore = 100;
        } else {
          movementFormScore = clamp(heightDiff * 500);
        }

        if (!bothWristsAboveShoulders && this.phase !== 'up' && isWarmedUp) {
          correctiveCommand = 'Raise both hands above your shoulders. Lift them high, then bring them down.';
        }
        break;
      }

      case 'finger-tapping': {
        if (this.prevWristMidY !== null && isWarmedUp) {
          const delta = wristMidY - this.prevWristMidY;
          const motionSize = Math.abs(delta);

          if (motionSize > 0.012) {
            const currentDir = delta < 0 ? 'up' : 'down';
            if (this.tapDirection !== null && currentDir !== this.tapDirection) {
              this.tapCount += 1;
              if (this.tapCount >= 2) {
                this.completeRep(frame.timestamp);
                this.tapCount = 0;
                milestone = this.reps === exercise.targetReps
                  ? 'Finger tapping complete.'
                  : this.reps === Math.ceil(exercise.targetReps / 2)
                    ? 'Halfway through tapping.'
                    : undefined;
              }
            }
            this.tapDirection = currentDir;
          }
        }
        this.prevWristMidY = wristMidY;

        if (this.tapCount === 0) {
          movementFormScore = 0;
        } else {
          movementFormScore = clamp(this.tapCount * 20);
        }

        if (this.reps === 0 && timerSeconds > 5 && isWarmedUp) {
          correctiveCommand = 'Move your hands up and down quickly in small tapping motions. Keep going.';
        }
        break;
      }

      case 'arm-stability': {
        const lWristNearShoulderHeight = Math.abs(lWrist.y - lShoulder.y) < 0.12;
        const rWristNearShoulderHeight = Math.abs(rWrist.y - rShoulder.y) < 0.12;
        const armsExtended = Math.abs(lWrist.x - lShoulder.x) > 0.05 && Math.abs(rWrist.x - rShoulder.x) > 0.05;
        const armsInPosition = lWristNearShoulderHeight && rWristNearShoulderHeight && armsExtended;

        let jitterScore = 0;
        if (this.lastWristSample) {
          const dt = (frame.timestamp - this.lastWristSample.t) / 1000;
          if (dt > 0.001 && dt < 0.5) {
            jitterScore = (
              Math.hypot(lWrist.x - this.lastWristSample.lx, lWrist.y - this.lastWristSample.ly) +
              Math.hypot(rWrist.x - this.lastWristSample.rx, rWrist.y - this.lastWristSample.ry)
            ) / (2 * dt);
          }
        }
        const stable = jitterScore < 0.8;

        if (armsInPosition && isWarmedUp) {
          if (this.lastTimestamp > 0) {
            const dt = (frame.timestamp - this.lastTimestamp) / 1000;
            if (dt > 0 && dt < 0.5) {
              this.holdSeconds += dt;
            }
          }
          if (this.holdSeconds >= 3) {
            this.completeRep(frame.timestamp);
            this.holdSeconds = 0;
            milestone = this.reps === exercise.targetReps
              ? 'Arm stability complete.'
              : `Hold ${this.reps} done. Stay steady.`;
          }
        } else {
          this.holdSeconds = Math.max(0, this.holdSeconds - 0.15);
        }

        if (!armsInPosition) {
          movementFormScore = 0;
        } else {
          movementFormScore = stable ? 100 : 70;
        }

        if (!armsInPosition && isWarmedUp) {
          if (!lWristNearShoulderHeight || !rWristNearShoulderHeight) {
            correctiveCommand = 'Raise both arms out to your sides at shoulder height. Hold them level and steady.';
          } else if (!armsExtended) {
            correctiveCommand = 'Extend your arms further out to the sides. Stretch them wide.';
          }
        } else if (armsInPosition && !stable) {
          correctiveCommand = 'Good position. Now try to hold very still. Breathe slowly and relax your shoulders.';
        }
        break;
      }

      case 'seated-march': {
        const rightCrossed = Math.abs(rWrist.x - lShoulder.x) < 0.12 && Math.abs(rWrist.y - lShoulder.y) < 0.15;
        const leftCrossed = Math.abs(lWrist.x - rShoulder.x) < 0.12 && Math.abs(lWrist.y - rShoulder.y) < 0.15;
        const handsAtRest = !rightCrossed && !leftCrossed;

        if (isWarmedUp) {
          if (this.phase === 'ready' || this.phase === 'neutral') {
            if (rightCrossed) {
              this.phase = 'right-cross';
            } else if (leftCrossed) {
              this.phase = 'left-cross';
            }
          } else if (this.phase === 'right-cross' && handsAtRest) {
            this.completeRep(frame.timestamp);
            milestone = this.reps === exercise.targetReps
              ? 'Arm cross touch complete.'
              : this.reps === Math.ceil(exercise.targetReps / 2)
                ? 'Halfway done.'
                : undefined;
            this.phase = 'neutral';
          } else if (this.phase === 'left-cross' && handsAtRest) {
            this.completeRep(frame.timestamp);
            milestone = this.reps === exercise.targetReps
              ? 'Arm cross touch complete.'
              : undefined;
            this.phase = 'neutral';
          }
        }

        movementFormScore = rightCrossed || leftCrossed ? 100 : 0;

        if (!rightCrossed && !leftCrossed && isWarmedUp && timerSeconds > 3) {
          correctiveCommand = 'Reach your right hand across to touch your left shoulder, then switch. Alternate sides.';
        }
        break;
      }
    }

    if (!postureCorrect && isWarmedUp && !correctiveCommand) {
      correctiveCommand = postureFeedback;
    }

    let rawAcc = clamp(movementFormScore);
    if (rawAcc === 0 && this.accuracyValues.length > 0) {
      rawAcc = this.accuracyValues[this.accuracyValues.length - 1];
    }
    const accuracy = clamp(rawAcc) - (analysis.issues.tremor ? 10 : 0);
    this.accuracyValues.push(accuracy);
    this.accuracyValues = this.accuracyValues.slice(-30);
    const displayAccuracy = Math.round(average(this.accuracyValues.slice(-12)) || accuracy);

    const avgRepMs = this.repDurations.length ? average(this.repDurations) : 0;
    const speed = avgRepMs === 0 ? 'NORMAL' : avgRepMs > 3500 ? 'SLOW' : avgRepMs < 1000 ? 'FAST' : 'NORMAL';

    if (!this.adapted && timerSeconds > Math.floor(exercise.durationSeconds * 0.6) && this.reps < 2) {
      exercise.targetReps = Math.max(3, exercise.targetReps - 2);
      this.adapted = true;
      adaptationNote = 'I reduced the target slightly. Focus on quality over quantity.';
    }

    const complete = this.reps >= exercise.targetReps || timerSeconds >= exercise.durationSeconds;
    if (complete) {
      this.completedExercises += 1;
      this.exerciseSummaries.push({
        exerciseName: exercise.name,
        accuracy: Math.round(average(this.accuracyValues) || displayAccuracy),
        speed,
        benefit: exercise.benefit ?? '',
      });

      const finalReps = this.reps;
      const finalTargetReps = exercise.targetReps;
      const nextExerciseExists = this.exerciseIndex + 1 < this.sessionExercises.length;
      if (nextExerciseExists) {
        this.exerciseIndex += 1;
        this.exerciseStartedAt = performance.now();
        this.resetExerciseState();
      } else {
        this.exerciseIndex = this.sessionExercises.length;
      }

      const nextEx = nextExerciseExists ? this.sessionExercises[this.exerciseIndex] : null;
      return {
        exercise: nextEx ?? exercise,
        exerciseIndex: this.exerciseIndex,
        totalExercises: this.totalExerciseCount(),
        sessionComplete: !nextExerciseExists,
        metrics: {
          reps: finalReps,
          targetReps: finalTargetReps,
          accuracy: displayAccuracy,
          speed,
          stability: analysis.issues.stability,
          complete: true,
          timerSeconds,
          milestone: milestone ?? `${exercise.name} finished.`,
          guidance: nextEx ? `Next: ${nextEx.name}. ${nextEx.instructions}` : 'All exercises complete. Great session.',
          correctiveCommand: undefined,
          postureCorrect,
          postureFeedback,
          progressPercent: 100,
          adaptationNote,
        },
      };
    }

    this.lastWristSample = {
      lx: lWrist.x,
      ly: lWrist.y,
      rx: rWrist.x,
      ry: rWrist.y,
      t: frame.timestamp,
    };
    this.lastTimestamp = frame.timestamp;

    return {
      exercise,
      exerciseIndex: this.exerciseIndex,
      totalExercises: this.totalExerciseCount(),
      sessionComplete: false,
      metrics: {
        reps: this.reps,
        targetReps: exercise.targetReps,
        accuracy: displayAccuracy,
        speed,
        stability: analysis.issues.stability,
        complete: false,
        timerSeconds,
        milestone,
        guidance: exercise.instructions,
        correctiveCommand,
        postureCorrect,
        postureFeedback,
        progressPercent: clamp((this.reps / exercise.targetReps) * 100),
        adaptationNote,
      },
    };
  }

  private completeRep(timestamp: number) {
    if (this.lastRepAt && timestamp - this.lastRepAt < 200) {
      return;
    }
    this.reps += 1;
    this.totalReps += 1;
    if (this.lastRepAt) {
      this.repDurations.push(timestamp - this.lastRepAt);
      this.repDurations = this.repDurations.slice(-12);
    }
    this.lastRepAt = timestamp;
  }

  private resetExerciseState() {
    this.reps = 0;
    this.lastRepAt = 0;
    this.repDurations = [];
    this.accuracyValues = [];
    this.phase = 'ready';
    this.holdSeconds = 0;
    this.lastTimestamp = 0;
    this.adapted = false;
    this.prevWristMidY = null;
    this.tapDirection = null;
    this.tapCount = 0;
    this.lastWristSample = null;
    this.warmupFrames = 0;
  }
}
