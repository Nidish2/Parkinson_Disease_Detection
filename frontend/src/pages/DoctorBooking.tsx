import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, CheckCircle2, MapPin, Phone, Video, LoaderCircle, AlertCircle, Upload } from 'lucide-react';
import Card from '../components/Card';
import { postChatMessage } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { uploadPrescription } from '../utils/reportUtils';
import { createAppointment, getReports, listApprovedDoctors } from '../services/healthcareApi';
import type { AppUser, AppointmentRecord, UnifiedReport } from '../types/healthcare';

const LOCAL_APPOINTMENTS_KEY = 'local_appointments';

const cacheLocalAppointment = (appointment: AppointmentRecord) => {
  try {
    const current = JSON.parse(localStorage.getItem(LOCAL_APPOINTMENTS_KEY) || '[]') as AppointmentRecord[];
    const deduped = [appointment, ...current.filter((item) => item.id !== appointment.id && item.report_id !== appointment.report_id)];
    localStorage.setItem(LOCAL_APPOINTMENTS_KEY, JSON.stringify(deduped.slice(0, 20)));
  } catch (error) {
    console.error('Failed to cache appointment locally:', error);
  }
};

type SlotSelection = {
  label: string;
  date: string;
  time: string;
  source: 'recommended' | 'custom';
  mode?: 'video' | 'in-person';
};

const defaultSlots = [
  { day: 'Monday', times: ['10:00', '14:30'] },
  { day: 'Wednesday', times: ['11:15', '16:00'] },
  { day: 'Friday', times: ['09:45', '13:00'] },
];

const DoctorBooking = () => {
  const params = useParams();
  const doctorId = params.doctorId;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [doctor, setDoctor] = useState<AppUser | null>(null);
  const [reports, setReports] = useState<UnifiedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<SlotSelection | null>(null);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [generatedSummary, setGeneratedSummary] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [bookingMessage, setBookingMessage] = useState('');
  const [sendingSummary, setSendingSummary] = useState(false);
  const [prescriptionFile, setPrescriptionFile] = useState<File | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [doctorData, reportData] = await Promise.all([
          listApprovedDoctors(),
          getReports(),
        ]);
        setDoctor(doctorData.find((item) => item.id === doctorId) || null);
        setReports(reportData);
      } catch (error) {
        console.error('Error loading booking data:', error);
        setDoctor(null);
        setReports([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [doctorId]);

  const latestReport = reports[0] || null;

  const recommendedSlots = useMemo(() => {
    if (doctor?.availability_slots?.length) {
      return doctor.availability_slots.map((slot) => ({
        label: `${new Date(slot.date).toLocaleDateString()} | ${slot.time}`,
        date: slot.date,
        time: slot.time,
        source: 'recommended' as const,
        mode: slot.mode || 'video',
      }));
    }

    const today = new Date();
    return defaultSlots.flatMap((slot) => {
      return slot.times.map((time) => {
        const date = new Date(today);
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(slot.day);
        if (dayOfWeek >= 0) {
          const offset = (dayOfWeek - today.getDay() + 7) % 7;
          date.setDate(today.getDate() + offset);
        }

        return {
          label: `${slot.day} | ${time}`,
          date: date.toISOString().split('T')[0],
          time,
          source: 'recommended' as const,
          mode: 'video' as const,
        };
      });
    });
  }, [doctor?.availability_slots]);

  const handleSelectSlot = (slot: SlotSelection) => {
    setSelectedSlot(slot);
    setCustomDate('');
    setCustomTime('');
    setBookingStatus('idle');
    setBookingMessage('');
  };

  const handleCustomSlotChange = (date: string, time: string) => {
    setSelectedSlot(date && time ? { date, time, label: `${date} | ${time}`, source: 'custom' } : null);
    setCustomDate(date);
    setCustomTime(time);
    setBookingStatus('idle');
    setBookingMessage('');
  };

  const handleGenerateSummary = async () => {
    if (!visitNotes.trim()) {
      setGenerateError('Add a few lines about your current concerns so we can prepare a summary.');
      return;
    }

    try {
      setGenerateError(null);
      setGeneratingSummary(true);
      const response = await postChatMessage(
        [
          {
            from: 'user',
            text: `Patient notes for upcoming Parkinson's appointment: ${visitNotes}`,
          },
        ],
        {
          maxTokens: 300,
          temperature: 0.4,
          systemInstruction:
            'Convert the patient note into a concise visit brief for a neurologist treating Parkinson\'s disease. Include 4-5 bullet points: current status, key symptoms or fluctuations, medication issues, support needs, and one question for the doctor. Keep it under 120 words.',
        },
      );

      const summary = response.choices?.[0]?.message?.content?.trim();
      if (summary) {
        setGeneratedSummary(summary);
      } else {
        setGenerateError('The assistant could not produce a summary. Please try again.');
      }
    } catch (error) {
      console.error('Error generating summary', error);
      setGenerateError('Could not reach the assistant. Try again in a moment.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlot) {
      setBookingStatus('error');
      setBookingMessage('Select a recommended slot or enter a custom date and time.');
      return;
    }

    if (!user || !doctor) {
      setBookingStatus('error');
      setBookingMessage('You must be logged in to book an appointment.');
      return;
    }

    if (!latestReport) {
      setBookingStatus('error');
      setBookingMessage('Create or save your AI report first so the doctor can review it in the same workflow.');
      return;
    }

    setBookingStatus('idle');
    setBookingMessage('');
    setSendingSummary(true);

    try {
      let prescriptionPath: string | undefined;
      if (prescriptionFile) {
        prescriptionPath = await uploadPrescription(user.id, prescriptionFile);
      }

      const createdAppointment = await createAppointment({
        doctorId: doctor.id,
        reportId: latestReport.id,
        appointmentDate: selectedSlot.date,
        appointmentTime: selectedSlot.time,
        consultationType: (selectedSlot as any).mode || 'video',
        status: 'pending',
        notes: generatedSummary || visitNotes || undefined,
        previousPrescriptionPath: prescriptionPath,
      });
      cacheLocalAppointment(createdAppointment);

      setSendingSummary(false);
      setBookingStatus('success');
      setBookingMessage(`Appointment request sent for ${selectedSlot.label}. It will appear once the doctor accepts or reschedules it.`);

      setTimeout(() => {
        navigate('/patient-dashboard');
      }, 2000);
    } catch (error: any) {
      console.error('Error in booking process:', error);
      setSendingSummary(false);
      setBookingStatus('error');
      setBookingMessage(error?.response?.data?.error || 'An unexpected error occurred. Please try again.');
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!doctor) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/consult')}
          className="inline-flex items-center gap-2 text-sm text-primary-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to directory
        </button>
        <Card>
          <div className="py-10 text-center">
            <h2 className="text-xl font-semibold">Doctor not found</h2>
            <p className="text-sm text-muted-foreground mt-2">Choose an approved doctor from the consult directory to continue.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/consult')}
        className="inline-flex items-center gap-2 text-sm text-primary-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to directory
      </button>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card/80">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h1 className="text-3xl font-bold">Book with {doctor.full_name || doctor.email}</h1>
                <p className="text-sm text-muted-foreground mt-1">Platform Doctor</p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 mt-2">
                  <MapPin className="h-4 w-4" /> {doctor.hospital || 'Hospital not provided'}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Your appointment will link to the same report that contains your AI screening results.
                </p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3 text-sm bg-muted/40">
                <p className="font-semibold">Contact</p>
                <p className="flex items-center gap-2 mt-1"><Phone className="h-4 w-4" /> {doctor.phone || 'Phone not provided'}</p>
                <p className="flex items-center gap-2 mt-2 text-primary-foreground">
                  <Video className="h-4 w-4" /> Video call ready after booking
                </p>
              </div>
            </div>

            {latestReport && (
              <Card className="bg-muted/40 border-dashed">
                <h2 className="font-semibold text-lg">Linked report preview</h2>
                <p className="text-xs text-muted-foreground mt-1">This appointment will use your latest unified report.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Status</p>
                    <p className="mt-1 font-semibold capitalize text-foreground">{latestReport.status}</p>
                  </div>
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">AI Risk</p>
                    <p className="mt-1 font-semibold text-foreground">{latestReport.aiResults?.summary?.riskScore?.toFixed?.(1) ?? 'N/A'} / 10</p>
                  </div>
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Source</p>
                    <p className="mt-1 font-semibold text-foreground capitalize">{latestReport.aiResults?.sourceTestType || 'fusion'}</p>
                  </div>
                </div>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-muted/40 border-dashed">
                <h2 className="font-semibold text-lg flex items-center gap-2"><Calendar className="h-5 w-5 text-primary-foreground" /> Recommended slots</h2>
                <p className="text-xs text-muted-foreground mt-1">Pick from upcoming availability published for platform consultations.</p>
                <div className="mt-4 grid gap-2">
                  {recommendedSlots.map((slot) => {
                    const isSelected = selectedSlot?.label === slot.label && selectedSlot.source === 'recommended';
                    return (
                      <button
                        key={slot.label}
                        onClick={() => handleSelectSlot(slot)}
                        className={`flex items-center justify-between rounded-lg border px-3 py-3 text-sm transition ${isSelected ? 'border-primary bg-primary/10 text-primary-foreground shadow-sm' : 'border-border hover:border-primary/60'}`}
                      >
                        <span>{slot.label}</span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-primary-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card className="bg-muted/40 border-dashed">
                <h2 className="font-semibold text-lg flex items-center gap-2"><Clock className="h-5 w-5 text-primary-foreground" /> Prefer a different time?</h2>
                <p className="text-xs text-muted-foreground mt-1">Suggest a date and time that suits you. The doctor will see it together with your report.</p>
                <div className="mt-4 space-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="custom-date">Date</label>
                    <input
                      id="custom-date"
                      type="date"
                      value={customDate}
                      onChange={(event) => handleCustomSlotChange(event.target.value, customTime)}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="custom-time">Preferred time</label>
                    <input
                      id="custom-time"
                      type="time"
                      value={customTime}
                      onChange={(event) => handleCustomSlotChange(customDate, event.target.value)}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">We&apos;ll send this request with your report link for doctor review.</p>
                </div>
              </Card>
            </div>
          </div>
        </Card>

        <Card className="bg-card/80">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Prepare your visit summary</h2>
            <p className="text-sm text-muted-foreground">
              Summarise what&apos;s changed, any prediction results, and the support you need. The assistant can turn your notes into a short brief for the doctor.
            </p>
            <textarea
              value={visitNotes}
              onChange={(event) => setVisitNotes(event.target.value)}
              placeholder="Example: Recent tremor increase in evenings, medication wearing off by 7pm, AI fusion report suggests moderate risk, need guidance on next medication review."
              className="w-full min-h-[120px] rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="space-y-2">
              <label className="block text-sm font-semibold">
                <Upload className="inline h-4 w-4 mr-2" />
                Previous Prescription (Optional)
              </label>
              <div className="flex items-center gap-4">
                <label className="flex-1 flex items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition">
                  <Upload className="h-5 w-5" />
                  <span className="text-sm">
                    {prescriptionFile ? prescriptionFile.name : 'Choose file to upload'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setPrescriptionFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {prescriptionFile && (
                <p className="text-xs text-muted-foreground">
                  File ready to upload: {prescriptionFile.name}
                </p>
              )}
            </div>

            <button
              onClick={handleGenerateSummary}
              disabled={generatingSummary}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {generatingSummary ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {generatingSummary ? 'Generating summary...' : 'Generate visit brief'}
            </button>
            {generateError && (
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-destructive/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle className="h-4 w-4" />
                <p>{generateError}</p>
              </div>
            )}
            {generatedSummary && (
              <div className="rounded-lg border border-primary/60 bg-primary/10 px-3 py-3 text-sm leading-relaxed text-primary-foreground">
                <p className="font-semibold mb-2">Doctor handover draft</p>
                <p className="whitespace-pre-wrap">{generatedSummary}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The linked report remains available to you after the doctor submits notes and prescription.
            </p>
          </div>
        </Card>
      </div>

      {bookingStatus === 'error' && (
        <Card className="border-red-400/60 bg-red-500/10">
          <div className="flex items-center gap-3 text-sm text-red-200">
            <AlertCircle className="h-5 w-5" />
            <p>{bookingMessage}</p>
          </div>
        </Card>
      )}

      {bookingStatus === 'success' && (
        <Card className="border-green-400/60 bg-emerald-500/10">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-green-200">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">Appointment request sent</p>
            </div>
            <p className="text-sm text-emerald-100">{bookingMessage}</p>
            <p className="text-xs text-emerald-100/80">The doctor will see this appointment with the same report you created from AI screening.</p>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {'Patient -> AI Report -> Appointment -> Doctor Review -> Final Report all remain connected in this flow.'}
        </p>
        <button
          onClick={handleConfirmBooking}
          disabled={sendingSummary}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {sendingSummary ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span className="ml-2">Confirm appointment</span>
        </button>
      </div>
    </div>
  );
};

export default DoctorBooking;
