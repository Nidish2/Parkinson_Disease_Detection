/**
 * AdvancedMetricsCard.tsx
 * Display advanced symptom metrics (rigidity, dyskinesia, freezing, gait)
 * Shows clinical-grade analysis for telemedicine consultation
 */

import { AlertCircle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import Card from './Card';
import type { SessionReport, ProgressionTrend } from './therapyTypes';

interface AdvancedMetricsCardProps {
  report: SessionReport;
  trend?: ProgressionTrend;
  showClinicalNotes?: boolean;
}

const AlertStatus = ({ level, message }: { level: 'warning' | 'alert' | 'normal'; message: string }) => {
  const colors: Record<string, string> = {
    alert: 'bg-red-100 border-red-300 text-red-800',
    warning: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    normal: 'bg-green-100 border-green-300 text-green-800',
  };

  const colorClass = colors[level] || colors.normal;
  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
};

const TrendIndicator = ({
  trend,
}: {
  trend?: 'improving' | 'stable' | 'worsening';
}) => {
  if (!trend) return null;

  const icons: Record<string, JSX.Element> = {
    improving: <TrendingDown className="h-4 w-4 text-green-600" />,
    stable: <Minus className="h-4 w-4 text-blue-600" />,
    worsening: <TrendingUp className="h-4 w-4 text-red-600" />,
  };

  const colors: Record<string, string> = {
    improving: 'text-green-700',
    stable: 'text-blue-700',
    worsening: 'text-red-700',
  };

  const icon = icons[trend];
  const color = colors[trend];

  return (
    <div className={`flex items-center gap-1 ${color}`}>
      {icon}
      <span className="text-xs font-semibold capitalize">{trend}</span>
    </div>
  );
};

const MetricGauge = ({
  label,
  value,
  max = 100,
  unit = '',
  threshold = 60,
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  threshold?: number;
}) => {
  const percentage = (value / max) * 100;
  const isHighRisk = value > threshold;

  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className={isHighRisk ? 'text-sm font-bold text-red-600' : 'text-sm font-bold text-green-600'}>
          {Math.round(value)}{unit}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div
          className={
            isHighRisk
              ? 'h-2 rounded-full bg-red-500 transition-all'
              : value > 40
                ? 'h-2 rounded-full bg-yellow-500 transition-all'
                : 'h-2 rounded-full bg-green-500 transition-all'
          }
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
};

export default function AdvancedMetricsCard({
  report,
  trend,
  showClinicalNotes = true,
}: AdvancedMetricsCardProps) {
  const hasAdvancedMetrics = !!(
    report.rigidityScore !== undefined ||
    report.freezingEvents !== undefined ||
    report.gaitMetrics !== undefined
  );

  if (!hasAdvancedMetrics) {
    return null;
  }

  return (
    <Card className="space-y-6 rounded-organic-2 border-none bg-background/80 backdrop-blur-md shadow-soft p-6">
      <div className="border-b border-border/50 pb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <AlertCircle className="h-5 w-5 text-primary" />
          Advanced Movement Analysis
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Clinical-grade symptom assessment</p>
      </div>

      {/* Rigidity Metrics */}
      {report.rigidityScore !== undefined && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Joint Rigidity</h3>
            {trend?.rigidity && <TrendIndicator trend={trend.rigidity} />}
          </div>
          <MetricGauge
            label="Overall Rigidity"
            value={report.rigidityScore}
            threshold={60}
            unit=""
          />
          <AlertStatus
            level={report.rigidityScore > 70 ? 'alert' : report.rigidityScore > 50 ? 'warning' : 'normal'}
            message={
              report.rigidityScore > 70
                ? '⚠️ HIGH: Significant joint stiffness detected. Consider physical therapy.'
                : report.rigidityScore > 50
                  ? '⚡ MODERATE: Mild joint stiffness present. Include stretching in routine.'
                  : '✓ LOW: Good joint mobility maintained.'
            }
          />
        </div>
      )}

      {/* Freezing Events */}
      {report.freezingEvents !== undefined && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Movement Freezing</h3>
            {report.freezingEvents && report.freezingEvents > 0 && (
              <span
                className={
                  report.freezingEvents > 5
                    ? 'inline-block rounded-full bg-red-200 px-3 py-1 text-xs font-semibold text-red-800'
                    : report.freezingEvents > 2
                      ? 'inline-block rounded-full bg-yellow-200 px-3 py-1 text-xs font-semibold text-yellow-800'
                      : 'inline-block rounded-full bg-green-200 px-3 py-1 text-xs font-semibold text-green-800'
                }
              >
                {report.freezingEvents} event{report.freezingEvents !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {report.freezingEvents > 0 && (
            <div className="space-y-2 rounded-2xl bg-background/50 border border-border/40 p-4">
              <div className="flex justify-between">
                <span className="text-sm">Freezing Events</span>
                <span className="font-bold text-red-600">{report.freezingEvents}</span>
              </div>
              {report.averageFreezingDuration !== undefined && report.averageFreezingDuration > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm">Avg Duration</span>
                  <span className="font-bold">{report.averageFreezingDuration.toFixed(1)}s</span>
                </div>
              )}
            </div>
          )}

          <AlertStatus
            level={report.freezingEvents > 5 ? 'alert' : report.freezingEvents > 2 ? 'warning' : 'normal'}
            message={
              report.freezingEvents > 5
                ? '⚠️ HIGH RISK: Frequent freezing detected. Consult neurologist about fall prevention.'
                : report.freezingEvents > 2
                  ? '⚡ MODERATE: Some freezing observed. Practice cueing techniques.'
                  : '✓ NONE: No significant freezing detected.'
            }
          />
        </div>
      )}

      {/* Gait Metrics */}
      {report.gaitMetrics && (
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-800">Gait Analysis</h3>
          <div className="grid grid-cols-2 gap-4 rounded-2xl bg-background/50 border border-border/40 p-4">
            <div>
              <p className="text-xs text-gray-600">Stride Type</p>
              <p className="font-bold capitalize">{report.gaitMetrics.stride}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Cadence</p>
              <p className="font-bold">{Math.round(report.gaitMetrics.cadence)} steps/min</p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Balance</p>
              <p
                className={`font-bold capitalize ${
                  report.gaitMetrics.balance === 'stable' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {report.gaitMetrics.balance}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Knee Flexion</p>
              <p className="font-bold">{Math.round(report.gaitMetrics.kneeFlexion)}°</p>
            </div>
          </div>

          <AlertStatus
            level={
              report.gaitMetrics.balance === 'unstable' && report.gaitMetrics.stride === 'shuffling'
                ? 'alert'
                : report.gaitMetrics.stride === 'short'
                  ? 'warning'
                  : 'normal'
            }
            message={
              report.gaitMetrics.balance === 'unstable' && report.gaitMetrics.stride === 'shuffling'
                ? '⚠️ HIGH RISK: Shuffling gait with unstable balance. High fall risk.'
                : report.gaitMetrics.stride === 'short'
                  ? '⚡ MODERATE: Short stride detected. Focus on stepping exercises.'
                  : '✓ GOOD: Normal stride and balance maintained.'
            }
          />
        </div>
      )}

      {/* Clinical Notes */}
      {showClinicalNotes && (
        <div className="rounded-lg border-l-4 border-blue-400 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">💙 For Your Healthcare Provider</p>
          <ul className="mt-2 space-y-1 text-xs text-blue-800">
            <li>• Share these metrics with your neurologist for medication/therapy adjustments</li>
            <li>• Track trends week-to-week to assess treatment effectiveness</li>
            <li>• High-risk alerts warrant immediate medical consultation</li>
            <li>
              • Discuss cueing strategies (auditory, visual) if freezing is present
            </li>
          </ul>
        </div>
      )}

      {/* Progression Trend Summary */}
      {trend && (
        <div className="rounded-2xl bg-background/50 border border-border/40 p-4">
          <h4 className="mb-3 font-semibold text-gray-800">Weekly Trend</h4>
          <div className="space-y-2 text-sm">
            {trend.tremor && (
              <div className="flex items-center justify-between">
                <span>Tremor</span>
                <TrendIndicator trend={trend.tremor} />
              </div>
            )}
            {trend.speed && (
              <div className="flex items-center justify-between">
                <span>Movement Speed</span>
                <TrendIndicator trend={trend.speed} />
              </div>
            )}
            {trend.rigidity && (
              <div className="flex items-center justify-between">
                <span>Rigidity</span>
                <TrendIndicator trend={trend.rigidity} />
              </div>
            )}
            {trend.freezing && (
              <div className="flex items-center justify-between">
                <span>Freezing</span>
                <span className="text-xs font-semibold capitalize text-gray-600">{trend.freezing}</span>
              </div>
            )}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Overall:{' '}
              <span className={`ml-1 ${trend.overallTrajectory === 'improving' ? 'text-green-600' : trend.overallTrajectory === 'declining' ? 'text-red-600' : 'text-blue-600'}`}>
                {trend.overallTrajectory}
              </span>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
