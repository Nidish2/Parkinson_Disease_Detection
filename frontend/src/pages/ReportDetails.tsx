import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, LoaderCircle, MessageSquare, Plus, Save, Video } from 'lucide-react';
import Card from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { getAppointments, getReportById, updateDoctorReport } from '../services/healthcareApi';
import type { AppointmentRecord, ReportStatus, UnifiedReport } from '../types/healthcare';
import { downloadUnifiedReportPdf } from '../utils/reportUtils';

const ReportDetails = () => {
  const { reportId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<UnifiedReport | null>(null);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [status, setStatus] = useState<ReportStatus>('reviewed');
  const [prescriptionInput, setPrescriptionInput] = useState('');
  const [prescription, setPrescription] = useState<string[]>([]);
  const [appointment, setAppointment] = useState<AppointmentRecord | null>(null);

  useEffect(() => {
    const loadReport = async () => {
      if (!reportId) {
        setLoading(false);
        return;
      }

      try {
        const data = await getReportById(reportId);
        setReport(data);
        setDoctorNotes(data.doctorNotes || '');
        setSuggestions(data.suggestions || '');
        setPrescription(data.prescription || []);
        setStatus(data.status || 'reviewed');
        const appointments = await getAppointments().catch(() => []);
        const linkedAppointment = appointments.find((item) => item.id === data.appointment_id)
          || appointments.find((item) => item.report_id === data.id)
          || null;
        setAppointment(linkedAppointment);
      } catch (error) {
        console.error('Failed to load report:', error);
        setReport(null);
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [reportId]);

  const canEditDoctorSection = user?.role === 'doctor' && user.approval_status === 'approved';
  const backLink = useMemo(() => {
    if (user?.role === 'doctor') return '/doctor-dashboard';
    if (user?.role === 'admin') return '/admin-dashboard';
    return '/patient-dashboard';
  }, [user?.role]);

  const addPrescriptionLine = () => {
    const nextItem = prescriptionInput.trim();
    if (!nextItem) return;
    setPrescription((current) => [...current, nextItem]);
    setPrescriptionInput('');
  };

  const removePrescriptionLine = (index: number) => {
    setPrescription((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleDoctorSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reportId) return;

    setSaving(true);
    try {
      const updated = await updateDoctorReport(reportId, {
        doctorNotes,
        prescription,
        suggestions,
        status,
      });
      setReport(updated);
      const appointments = await getAppointments().catch(() => []);
      const linkedAppointment = appointments.find((item) => item.id === updated.appointment_id)
        || appointments.find((item) => item.report_id === updated.id)
        || null;
      setAppointment(linkedAppointment);
    } catch (error) {
      console.error('Failed to update report:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!report) {
    return (
      <Card className="rounded-organic-2 bg-background/70">
        <p className="text-2xl font-serif font-bold text-foreground">Report not found</p>
      </Card>
    );
  }

  const fusion = report.aiResults?.fusion as Record<string, any> | null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-[2rem] bg-primary/10 p-4">
            <ClipboardList className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-4xl font-serif font-bold text-foreground">Unified Report</h2>
            <p className="text-muted-foreground mt-1">AI analysis and doctor prescription live in the same clinical report.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => downloadUnifiedReportPdf(report, report.patientDetails?.full_name)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Download PDF
          </button>
          <Link
            to={backLink}
            className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      <Card className="rounded-organic-4 bg-background/70">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Patient</p>
            <p className="text-xl font-serif font-bold text-foreground mt-1">{report.patientDetails?.full_name}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Report Status</p>
            <p className="text-xl font-serif font-bold text-foreground mt-1 capitalize">{report.status}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI Risk Score</p>
            <p className="text-xl font-serif font-bold text-foreground mt-1">{typeof report.aiResults?.summary?.riskScore === 'number' ? `${report.aiResults.summary.riskScore.toFixed(1)} / 10` : 'N/A'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Doctor</p>
            <p className="text-xl font-serif font-bold text-foreground mt-1">{report.doctorDetails?.full_name || 'Not assigned'}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-organic-1 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">AI Results</h3>
            <p className="text-sm text-muted-foreground mt-1">Existing AI findings remain intact and are now paired with clinical review.</p>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI Summary</p>
              <p className="text-xl font-serif font-bold text-foreground mt-2">{report.aiResults?.summary?.label || 'Pending classification'}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Confidence: {typeof report.aiResults?.summary?.confidence === 'number'
                  ? `${(report.aiResults.summary.confidence * 100).toFixed(1)}%`
                  : 'N/A'}
              </p>
            </div>

            {fusion?.breakdown?.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {fusion.breakdown.map((item: any) => (
                  <div key={item.modality} className="rounded-2xl border border-border/40 bg-background/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{item.modality}</p>
                    <p className="text-2xl font-serif font-bold text-foreground mt-2">{item.score?.toFixed?.(1) ?? item.score} / 10</p>
                    <p className="text-xs text-muted-foreground mt-2">Weight {(item.weight * 100).toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Recent AI Tests</p>
              <div className="mt-3 space-y-3">
                {report.aiResults?.recentTests?.map((test) => (
                  <div key={test.id} className="flex items-center justify-between rounded-2xl bg-background/60 px-4 py-3">
                    <div>
                      <p className="font-semibold text-foreground capitalize">{test.test_type} test</p>
                      <p className="text-xs text-muted-foreground">{new Date(test.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{test.result?.riskLevel || test.result?.label || 'Saved'}</p>
                      <p className="text-xs text-muted-foreground">
                        {typeof test.result?.riskScore === 'number' ? `${test.result.riskScore.toFixed(1)} / 10` : 'AI data ready'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {fusion?.recommendations?.length ? (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI Recommendations</p>
                <div className="mt-3 space-y-2">
                  {fusion.recommendations.map((item: string, index: number) => (
                    <p key={`${item}-${index}`} className="text-sm text-foreground">{index + 1}. {item}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="rounded-organic-3 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Doctor Review</h3>
            <p className="text-sm text-muted-foreground mt-1">Clinical notes, prescription, and suggestions update this same report document.</p>
          </div>

          <div className="mt-5 space-y-4">
            {report.doctorDetails?.hospital ? (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Reviewing Doctor</p>
                <p className="text-lg font-serif font-bold text-foreground mt-2">{report.doctorDetails.full_name}</p>
                <p className="text-sm text-muted-foreground mt-1">{report.doctorDetails.hospital}</p>
              </div>
            ) : null}

            {(appointment || report.appointment_id) && report.doctorDetails && (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Consultation Access</p>
                <p className="text-sm text-muted-foreground mt-2">Use the linked appointment dashboard card to open the active call room.</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {appointment?.call_url && appointment.status === 'accepted' && (
                    <a
                      href={appointment.call_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Video className="h-4 w-4" /> {user?.role === 'doctor' ? 'Start Call' : 'Join Call'}
                    </a>
                  )}
                  {appointment?.status === 'accepted' ? (
                    <Link
                      to={`/appointments/${appointment?.id || report.appointment_id}/communication`}
                      className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <MessageSquare className="h-4 w-4" /> Open Chat
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full border border-border/40 px-5 py-2.5 text-sm font-semibold text-muted-foreground">
                      <MessageSquare className="h-4 w-4" /> Available after doctor acceptance
                    </span>
                  )}
                </div>
              </div>
            )}

            {canEditDoctorSection ? (
              <form onSubmit={handleDoctorSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">Notes</label>
                  <textarea
                    value={doctorNotes}
                    onChange={(event) => setDoctorNotes(event.target.value)}
                    className="min-h-[120px] w-full rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Add clinical notes based on the linked AI results and consultation."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">Prescription</label>
                  <div className="flex gap-2">
                    <input
                      value={prescriptionInput}
                      onChange={(event) => setPrescriptionInput(event.target.value)}
                      className="flex-1 rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Add one prescription line"
                    />
                    <button
                      type="button"
                      onClick={addPrescriptionLine}
                      className="inline-flex items-center gap-2 rounded-full border border-border/50 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <Plus className="h-4 w-4" /> Add
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prescription.map((item, index) => (
                      <button
                        key={`${item}-${index}`}
                        type="button"
                        onClick={() => removePrescriptionLine(index)}
                        className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">Suggestions</label>
                  <textarea
                    value={suggestions}
                    onChange={(event) => setSuggestions(event.target.value)}
                    className="min-h-[120px] w-full rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Lifestyle suggestions, monitoring plans, and next steps."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">Report Status</label>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as ReportStatus)}
                    className="w-full rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="reviewed">Reviewed</option>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Doctor Review
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Notes</p>
                  <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{report.doctorNotes || 'Doctor notes have not been added yet.'}</p>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Prescription</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {report.prescription?.length
                      ? report.prescription.map((item, index) => (
                        <span key={`${item}-${index}`} className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                          {item}
                        </span>
                      ))
                      : <p className="text-sm text-muted-foreground">No prescription added yet.</p>}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Suggestions</p>
                  <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{report.suggestions || 'Doctor suggestions have not been added yet.'}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ReportDetails;
