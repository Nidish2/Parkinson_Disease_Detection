import Card from './Card';

const clampScore = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const rounded = Math.round(value);
  if (rounded <= 0) return null;
  return Math.min(100, Math.max(0, rounded));
};

const getStatusConfig = (value) => {
  if (value === null) {
    return {
      label: 'Awaiting Data',
      toneClass: 'text-muted-foreground',
      badgeClass: 'bg-muted/70 text-muted-foreground ring-1 ring-border/60',
      progressClass: 'from-muted/70 to-muted',
      markerClass: 'bg-muted-foreground/60',
      fillColor: '#94a3b8',
      glowClass: 'bg-muted/40',
      accentClass: 'border-border/60 bg-background/70',
      pulseClass: '',
    };
  }

  if (value <= 40) {
    return {
      label: 'Low',
      toneClass: 'text-emerald-700',
      badgeClass: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20',
      progressClass: 'from-emerald-300 via-emerald-400 to-emerald-500',
      markerClass: 'bg-emerald-500',
      fillColor: '#10b981',
      glowClass: 'bg-emerald-400/35',
      accentClass: 'border-emerald-500/20 bg-emerald-500/5',
      pulseClass: '',
    };
  }

  if (value <= 70) {
    return {
      label: 'Moderate',
      toneClass: 'text-amber-700',
      badgeClass: 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20',
      progressClass: 'from-amber-200 via-amber-300 to-amber-500',
      markerClass: 'bg-amber-500',
      fillColor: '#f59e0b',
      glowClass: 'bg-amber-400/35',
      accentClass: 'border-amber-500/20 bg-amber-500/5',
      pulseClass: 'animate-pulse',
    };
  }

  return {
    label: 'High',
    toneClass: 'text-rose-700',
    badgeClass: 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20',
    progressClass: 'from-rose-300 via-rose-400 to-rose-500',
    markerClass: 'bg-rose-500',
    fillColor: '#f43f5e',
    glowClass: 'bg-rose-400/40',
    accentClass: 'border-rose-500/20 bg-rose-500/5',
    pulseClass: 'animate-pulse',
  };
};

const getOverallStatus = (statuses) => {
  if (statuses.some((status) => status.label === 'High')) {
    return getStatusConfig(85);
  }

  if (statuses.some((status) => status.label === 'Moderate')) {
    return getStatusConfig(55);
  }

  if (statuses.some((status) => status.label === 'Low')) {
    return getStatusConfig(20);
  }

  return getStatusConfig(null);
};

const MetricRow = ({ label, descriptor, value }) => {
  const status = getStatusConfig(value);

  if (value === null) {
    return null;
  }

  return (
    <div className={`rounded-[1.9rem] border p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] transition-all duration-300 hover:-translate-y-0.5 ${status.accentClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">{descriptor}</p>
        </div>
        <span className={`inline-flex min-w-[6.5rem] justify-center rounded-full px-3 py-1 text-xs font-semibold ${status.badgeClass}`}>
          {status.label}
        </span>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Latest Signal</span>
          <span className="text-2xl font-serif font-bold text-foreground">{value}%</span>
        </div>

        <div className="relative h-3 overflow-hidden rounded-full bg-muted/60">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${status.progressClass} shadow-[0_0_24px_rgba(255,255,255,0.1)] transition-[width] duration-1000 ease-out`}
            style={{ width: `${value}%` }}
          />
          <div
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-background shadow-md transition-[left] duration-1000 ease-out ${status.markerClass}`}
            style={{ left: `calc(${value}% - 0.5rem)` }}
          />
        </div>
      </div>
    </div>
  );
};

const SummaryItem = ({ label, status, detail }) => (
  <div className={`rounded-2xl border px-4 py-3 ${status.accentClass}`}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
    <p className={`mt-2 text-base font-semibold ${status.toneClass}`}>{detail}</p>
  </div>
);

const HealthIndicationAvatar = ({ voiceStatus, motorStatus, overallStatus }) => (
  <div
    className="group/avatar relative mx-auto flex h-[21rem] w-full max-w-[19rem] items-center justify-center overflow-hidden rounded-[2.5rem] border border-border/50 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.88),_rgba(244,247,244,0.72)_42%,_rgba(237,241,237,0.85)_100%)] shadow-[0_35px_80px_-45px_rgba(15,23,42,0.45)] transition-transform duration-500 hover:-translate-y-1"
    title="Based on latest screening data"
  >
    <div className={`absolute inset-x-12 top-5 h-20 rounded-full blur-3xl transition-all duration-500 ${overallStatus.glowClass} ${overallStatus.pulseClass}`} />
    <div className={`absolute left-[4.3rem] top-[4rem] h-16 w-16 rounded-full blur-2xl transition-all duration-500 ${voiceStatus.glowClass} ${voiceStatus.pulseClass}`} />
    <div className={`absolute left-[2.1rem] top-[10.7rem] h-14 w-14 rounded-full blur-2xl transition-all duration-500 ${motorStatus.glowClass} ${motorStatus.pulseClass}`} />
    <div className={`absolute right-[2.1rem] top-[10.7rem] h-14 w-14 rounded-full blur-2xl transition-all duration-500 ${motorStatus.glowClass} ${motorStatus.pulseClass}`} />
    <div className="absolute inset-x-10 bottom-4 h-16 rounded-full bg-slate-900/10 blur-2xl" />

    <svg
      viewBox="0 0 260 320"
      className="relative z-10 h-[18rem] w-[14rem] text-slate-700 transition-transform duration-500 group-hover/avatar:scale-[1.025]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M130 86V118" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
      <circle cx="130" cy="62" r="32" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeWidth="8" />
      <path
        d="M94 144C94 122.46 111.46 105 133 105H127C148.54 105 166 122.46 166 144V186C166 199.255 155.255 210 142 210H118C104.745 210 94 199.255 94 186V144Z"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="8"
      />
      <path d="M92 144L61 193" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M168 144L199 193" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M117 211L102 274" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M143 211L158 274" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />

      <circle cx="130" cy="62" r="39" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="12" />
      <circle cx="60" cy="196" r="12" fill={motorStatus.fillColor} fillOpacity="0.95" />
      <circle cx="200" cy="196" r="12" fill={motorStatus.fillColor} fillOpacity="0.95" />
      <circle cx="130" cy="62" r="13" fill={voiceStatus.fillColor} fillOpacity="0.95" />

      <path d="M130 74V92" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <path d="M73 193H92" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.2" />
      <path d="M168 193H187" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.2" />
    </svg>

    <div className="pointer-events-none absolute left-5 top-6 flex items-center gap-2 rounded-full border border-border/60 bg-background/75 px-3 py-1.5 backdrop-blur">
      <span className={`h-2.5 w-2.5 rounded-full ${voiceStatus.markerClass} ${voiceStatus.pulseClass}`} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Voice Zone</span>
    </div>

    <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-background/75 px-3 py-1.5 backdrop-blur">
      <span className={`h-2.5 w-2.5 rounded-full ${motorStatus.markerClass} ${motorStatus.pulseClass}`} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Motor Zone</span>
    </div>
  </div>
);

export default function DigitalTwinCard(props) {
  const voiceValue = clampScore(props.voiceStability);
  const drawingValue = clampScore(props.drawingAccuracy);

  const visibleMetrics = [
    {
      key: 'voice',
      label: 'Voice Stability',
      descriptor: 'Speech consistency and vocal control',
      value: voiceValue,
    },
    {
      key: 'drawing',
      label: 'Drawing Accuracy',
      descriptor: 'Motor precision during drawing tasks',
      value: drawingValue,
    },
  ].filter((metric) => metric.value !== null);

  const voiceStatus = getStatusConfig(voiceValue);
  const motorStatus = getStatusConfig(drawingValue);
  const overallStatus = getOverallStatus([voiceStatus, motorStatus]);

  return (
    <Card className="group rounded-organic-3 bg-background/70 dark:bg-accent/35">
      <div className="flex flex-col gap-8 xl:flex-row xl:items-center">
        <div className="xl:w-[23rem] xl:flex-shrink-0">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-primary/80">Digital Twin</p>
            <h3 className="mt-3 font-serif text-[2rem] font-bold leading-tight text-foreground">Condition-Led Health Avatar</h3>
            <p className="mt-3 max-w-md text-sm font-medium leading-6 text-muted-foreground">
              A visual twin of the patient&apos;s latest screening signals, with highlighted speech and motor regions for fast clinical interpretation.
            </p>
          </div>

          <HealthIndicationAvatar
            voiceStatus={voiceStatus}
            motorStatus={motorStatus}
            overallStatus={overallStatus}
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryItem
              label="Motor Control"
              status={motorStatus}
              detail={motorStatus.label === 'Awaiting Data' ? 'Awaiting latest drawing test' : motorStatus.label}
            />
            <SummaryItem
              label="Voice Stability"
              status={voiceStatus}
              detail={voiceStatus.label === 'Awaiting Data' ? 'Awaiting latest voice sample' : voiceStatus.label}
            />
          </div>
        </div>

        <div className="flex-1">
          {visibleMetrics.length > 0 ? (
            <div className="space-y-4">
              {visibleMetrics.map((metric) => (
                <MetricRow
                  key={metric.key}
                  label={metric.label}
                  descriptor={metric.descriptor}
                  value={metric.value}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[2rem] border border-dashed border-border/70 bg-background/55 px-6 py-8 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">No active signal cards</p>
              <h4 className="mt-3 font-serif text-2xl font-bold text-foreground">Awaiting meaningful screening data</h4>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Voice and drawing cards appear automatically once the latest saved screening results contain non-zero clinical signals.
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
