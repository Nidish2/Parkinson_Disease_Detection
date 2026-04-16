import type { AgentMessage, ExerciseUpdate, SymptomAnalysis } from './therapyTypes';

interface AgentContext {
  ready: boolean;
  exerciseUpdate: ExerciseUpdate;
  analysis: SymptomAnalysis;
  sessionStarted: boolean;
}

export class TherapyAIAgent {
  private lastMilestone = '';
  private lastCorrection = '';
  private lastPostureCorrect: boolean | null = null;
  private lastPostureFeedback = '';
  private lastAdaptationNote = '';
  private lastExerciseId: string | null = null;
  private lastSpokenRep = -1;
  private lastProgressCue = '';
  private lastNoPersonAt = 0;
  private lastCorrectionAt = 0;
  private readonly repetitionCooldownMs = 6000;

  private canRepeat(lastAt: number) {
    return Date.now() - lastAt >= this.repetitionCooldownMs;
  }

  getWelcomeMessage(exerciseName: string) {
    return `Welcome to your therapy session. We will start with ${exerciseName}. Follow the reference visual and my voice instructions.`;
  }

  getMessage(context: AgentContext): AgentMessage {
    const { ready, exerciseUpdate, analysis, sessionStarted } = context;
    const exerciseId = exerciseUpdate.exercise?.id ?? null;

    if (!sessionStarted) {
      return { text: 'Click Start Session to begin your therapy assessment.', speak: true, tone: 'neutral' };
    }

    if (!ready || analysis.issues.noPerson) {
      const shouldSpeak = this.canRepeat(this.lastNoPersonAt);
      if (shouldSpeak) {
        this.lastNoPersonAt = Date.now();
      }
      return {
        text: "I can't see you clearly yet. Please face the camera so your shoulders, elbows, and hands stay visible.",
        speak: shouldSpeak,
        tone: 'warning',
      };
    }

    if (exerciseId && exerciseId !== this.lastExerciseId) {
      const isTransition = this.lastExerciseId !== null;
      this.lastExerciseId = exerciseId;
      this.lastSpokenRep = -1;
      this.lastMilestone = '';
      this.lastProgressCue = '';
      this.lastCorrection = '';
      this.lastPostureFeedback = '';
      this.lastCorrectionAt = 0;
      if (isTransition) {
        const name = exerciseUpdate.exercise?.name ?? 'the next exercise';
        const intro = exerciseUpdate.exercise?.instructions ?? '';
        return {
          text: `Well done. Moving on to ${name}. ${intro}`,
          speak: true,
          tone: 'positive',
        };
      }
    }

    if (exerciseUpdate.metrics.milestone && exerciseUpdate.metrics.milestone !== this.lastMilestone) {
      this.lastMilestone = exerciseUpdate.metrics.milestone;
      return { text: exerciseUpdate.metrics.milestone, speak: true, tone: 'positive' };
    }

    if (exerciseUpdate.metrics.adaptationNote && exerciseUpdate.metrics.adaptationNote !== this.lastAdaptationNote) {
      this.lastAdaptationNote = exerciseUpdate.metrics.adaptationNote;
      return { text: exerciseUpdate.metrics.adaptationNote, speak: true, tone: 'neutral' };
    }

    const reps = exerciseUpdate.metrics.reps;
    const target = exerciseUpdate.metrics.targetReps;
    if (target > 0 && reps > 0) {
      const pct = reps / target;
      let progressCue = '';
      if (pct >= 0.8 && pct < 1) progressCue = 'almost';
      else if (pct >= 0.5 && pct < 0.8) progressCue = 'halfway';

      if (progressCue && progressCue !== this.lastProgressCue) {
        this.lastProgressCue = progressCue;
        if (progressCue === 'almost') {
          return { text: `Almost there. Just ${target - reps} more reps.`, speak: true, tone: 'positive' };
        }
        return { text: 'Halfway done. Keep the same rhythm.', speak: true, tone: 'positive' };
      }
    }

    const feedback = exerciseUpdate.metrics.postureFeedback ?? '';
    if (exerciseUpdate.metrics.postureCorrect === false && feedback && feedback !== 'Posture correct - keep it up!') {
      const changed = feedback !== this.lastPostureFeedback;
      if (changed || this.canRepeat(this.lastCorrectionAt)) {
        this.lastPostureFeedback = feedback;
        this.lastPostureCorrect = false;
        this.lastCorrection = feedback;
        this.lastCorrectionAt = Date.now();
        return { text: `Posture issue: ${feedback}`, speak: true, tone: 'warning' };
      }
      return { text: `Posture issue: ${feedback}`, speak: false, tone: 'warning' };
    }

    if (reps > this.lastSpokenRep) {
      this.lastSpokenRep = reps;

      const accuracy = exerciseUpdate.metrics.accuracy;
      let formFeedback = '';
      if (accuracy >= 80) formFeedback = 'Excellent form.';
      else if (accuracy >= 60) formFeedback = 'Good effort.';
      else if (accuracy >= 40) formFeedback = 'Focus on smooth movement.';
      else formFeedback = 'Watch your timing and form.';

      const encouragements = [
        'Nice work.',
        'Keep going.',
        'Good form.',
        'Well done.',
        'Strong effort.',
        'Stay smooth.',
      ];
      return {
        text: `Rep ${reps}. ${formFeedback} ${encouragements[reps % encouragements.length]}`,
        speak: true,
        tone: 'positive',
      };
    }

    if (exerciseUpdate.metrics.correctiveCommand) {
      const command = exerciseUpdate.metrics.correctiveCommand;
      const changed = command !== this.lastCorrection;
      if (changed || this.canRepeat(this.lastCorrectionAt)) {
        this.lastCorrection = command;
        this.lastCorrectionAt = Date.now();
        if (exerciseUpdate.metrics.postureCorrect === false) {
          this.lastPostureCorrect = false;
        }
        return { text: command, speak: true, tone: 'warning' };
      }
      return { text: command, speak: false, tone: 'warning' };
    }

    if (exerciseUpdate.metrics.postureCorrect === true && this.lastPostureCorrect === false) {
      this.lastPostureCorrect = true;
      this.lastCorrection = '';
      this.lastPostureFeedback = '';
      this.lastCorrectionAt = 0;
      return { text: 'Great. Your posture looks correct now. Keep it up.', speak: true, tone: 'positive' };
    }

    if (exerciseUpdate.exercise) {
      const remaining = exerciseUpdate.exercise.durationSeconds - exerciseUpdate.metrics.timerSeconds;
      if (remaining > 0 && remaining <= 10 && remaining > 5) {
        const timerCue = `${remaining}s-warning`;
        if (timerCue !== this.lastProgressCue) {
          this.lastProgressCue = timerCue;
          return { text: `${remaining} seconds left. Finish strong.`, speak: true, tone: 'positive' };
        }
      }
    }

    if (analysis.issues.tremor && exerciseUpdate.metrics.postureCorrect !== false) {
      return { text: 'Slight tremor detected. Breathe slowly and relax your shoulders.', speak: true, tone: 'warning' };
    }

    return { text: exerciseUpdate.metrics.guidance, speak: false, tone: 'neutral' };
  }
}
