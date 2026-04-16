import { Activity, AlertTriangle, Award, ShieldCheck, TrendingUp, Trophy } from 'lucide-react';
import Chart from './Chart';
import Card from './Card';
import AdvancedMetricsCard from './AdvancedMetricsCard';
import type { SessionReport } from './therapyTypes';

interface ReportProps {
  report: SessionReport;
  history: SessionReport[];
  onRestart: () => void;
}

const getRiskTone = (risk: SessionReport['overallRisk']) => {
  if (risk === 'HIGH') return 'text-red-700 bg-red-50 border-red-200';
  if (risk === 'MEDIUM') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
};

const getRiskMessage = (risk: SessionReport['overallRisk']) => {
  if (risk === 'HIGH') return 'This session showed several movement issues. Please review the results with your clinician.';
  if (risk === 'MEDIUM') return 'This session showed some movement irregularities. Continue the exercises and monitor progress.';
  return 'This session stayed mostly within the expected range. Keep up the exercise routine.';
};

const Report = ({ report, history, onRestart }: ReportProps) => {
  const trendSource = history.slice(-8).reverse();
  const trendOption = {
    backgroundColor: 'transparent',
    textStyle: { color: '#4A4A40' },
    grid: { left: 36, right: 18, top: 18, bottom: 28 },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: '#C9C2B8' } },
      axisLabel: { color: '#6D6D62', fontSize: 10 },
      data: trendSource.map((entry) => new Date(entry.completedAt).toLocaleDateString()),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { lineStyle: { color: '#C9C2B8' } },
      splitLine: { lineStyle: { color: '#E8E1D7' } },
      axisLabel: { color: '#6D6D62' },
    },
    series: [
      {
        name: 'Tremor',
        data: trendSource.map((entry) => entry.tremorScore),
        type: 'line',
        smooth: true,
        lineStyle: { width: 3, color: '#C18C5D' },
        itemStyle: { color: '#C18C5D' },
        areaStyle: { color: 'rgba(193,140,93,0.16)' },
      },
      {
        name: 'Stability',
        data: trendSource.map((entry) => entry.stabilityScore),
        type: 'line',
        smooth: true,
        lineStyle: { width: 3, color: '#5D7052' },
        itemStyle: { color: '#5D7052' },
      },
      {
        name: 'Speed',
        data: trendSource.map((entry) => entry.movementSpeedScore),
        type: 'line',
        smooth: true,
        lineStyle: { width: 3, color: '#7B8F77' },
        itemStyle: { color: '#7B8F77' },
      },
    ],
    tooltip: { trigger: 'axis' },
    legend: {
      bottom: 0,
      textStyle: { color: '#6D6D62', fontSize: 10 },
    },
  };

  const avgScore = Math.round(
    (report.movementSpeedScore + report.stabilityScore + (100 - report.tremorScore)) / 3,
  );
  const performanceLabel = avgScore >= 80 ? 'Excellent' : avgScore >= 60 ? 'Good' : avgScore >= 40 ? 'Fair' : 'Needs improvement';

  return (
    <div className="space-y-6">
      <Card className="rounded-organic-2 border-none bg-background/80 backdrop-blur-md shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Session Report</p>
            <h1 className="mt-2 text-3xl font-bold text-foreground">Therapy Session Summary</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{report.summary}</p>
          </div>
          <div className={`rounded-full border px-4 py-2 text-sm font-semibold ${getRiskTone(report.overallRisk)}`}>
            Overall risk: {report.overallRisk}
          </div>
        </div>
      </Card>

      <div className={`flex items-start gap-3 rounded-[1.5rem] border px-5 py-4 text-sm ${getRiskTone(report.overallRisk)}`}>
        <Award className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div>
          <p className="font-semibold">{performanceLabel} - Average health score: {avgScore}/100</p>
          <p className="mt-1 opacity-80">{getRiskMessage(report.overallRisk)}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-organic-1">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-[#C18C5D]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tremor</p>
              <p className="text-3xl font-bold">{report.tremorScore}</p>
            </div>
          </div>
        </Card>
        <Card className="rounded-organic-2">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-[#5D7052]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Speed</p>
              <p className="text-3xl font-bold">{report.movementSpeedScore}</p>
            </div>
          </div>
        </Card>
        <Card className="rounded-organic-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-[#7B8F77]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Stability</p>
              <p className="text-3xl font-bold">{report.stabilityScore}</p>
            </div>
          </div>
        </Card>
        <Card className="rounded-organic-4">
          <div className="flex items-center gap-3">
            <Trophy className="h-8 w-8 text-[#8B5E3C]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Accuracy</p>
              <p className="text-3xl font-bold">{report.averageAccuracy}%</p>
            </div>
          </div>
        </Card>
      </div>

      <AdvancedMetricsCard report={report} trend={report.progressionTrend} showClinicalNotes={true} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-organic-3">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#5D7052]" />
            <h2 className="text-lg font-semibold">Score Trend</h2>
          </div>
          <div className="h-72">
            <Chart option={trendOption} />
          </div>
        </Card>

        <Card className="rounded-organic-1">
          <h2 className="text-lg font-semibold">Session Summary</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>Exercises completed: <span className="font-semibold text-foreground">{report.exercisesCompleted} of {report.totalExercises}</span></p>
            <p>Total reps tracked: <span className="font-semibold text-foreground">{report.totalReps}</span></p>
            <p>Amplitude score: <span className="font-semibold text-foreground">{report.amplitudeScore}</span></p>
            <p>Completed at: <span className="font-semibold text-foreground">{new Date(report.completedAt).toLocaleString()}</span></p>
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Recommendations</p>
            {Array.from(new Set(report.recommendations)).map((item, index) => (
              <p key={index} className="text-sm text-muted-foreground">- {item}</p>
            ))}
          </div>
          <button
            onClick={onRestart}
            className="mt-6 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-transform duration-300 hover:-translate-y-0.5"
          >
            Start New Session
          </button>
        </Card>
      </div>

      {report.exercisePlan.length > 0 && (
        <Card className="rounded-organic-4">
          <h2 className="text-lg font-semibold">Personalized Exercise Plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">Based on your session performance, here is your recommended exercise schedule:</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {report.exercisePlan.map((item) => (
              <div key={item.exerciseName} className="rounded-3xl bg-muted/70 p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">{item.exerciseName}</p>
                <p className="mt-2"><span className="font-medium text-foreground">Schedule:</span> {item.frequency}</p>
                <p className="mt-2"><span className="font-medium text-foreground">Benefit:</span> {item.benefit}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {report.exercisePlan.length === 0 && (
        <Card className="rounded-organic-4">
          <h2 className="text-lg font-semibold">Exercise Plan</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete a full session with all exercises to receive a personalized exercise plan.
            Try to complete each exercise fully by following the AI agent&apos;s guidance.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-background/50 border border-border/40 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Seated Hand Raise</p>
              <p className="mt-2">Practice 3-5 days per week for shoulder mobility</p>
            </div>
            <div className="rounded-3xl bg-background/50 border border-border/40 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Finger Tapping</p>
              <p className="mt-2">Practice 3-5 days per week for hand dexterity</p>
            </div>
            <div className="rounded-3xl bg-background/50 border border-border/40 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Arm Stability Hold</p>
              <p className="mt-2">Practice 3-5 days per week for postural control</p>
            </div>
            <div className="rounded-3xl bg-background/50 border border-border/40 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Arm Cross Touch</p>
              <p className="mt-2">Practice 3-5 days per week for cross-body coordination</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Report;
