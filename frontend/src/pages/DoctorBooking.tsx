import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, CheckCircle2, MapPin, Phone, Video, LoaderCircle, AlertCircle, Upload } from 'lucide-react';
import Card from '../components/Card';
import { getDoctorById } from '../data/parkinsonSpecialists';
import { postChatMessage } from '../services/api';
import { mongodb } from '../lib/mongodbClient';
import { useAuth } from '../hooks/useAuth';
import { uploadPrescription } from '../utils/reportUtils';

type SlotSelection = {
  label: string;
  date: string;
  time: string;
  source: 'recommended' | 'custom';
};

const DoctorBooking = () => {
  const params = useParams();
  const doctorId = params.doctorId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const doctor = doctorId ? getDoctorById(doctorId) : undefined;

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

  const recommendedSlots = useMemo(() => {
    if (!doctor) return [];
    const today = new Date();

    return doctor.nextSlots.flatMap((slot) => {
      return slot.times.map((time) => {
        const label = `${slot.day} • ${time}`;
        const date = new Date(today);

        // move forward to the desired day of week (approximation)
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(slot.day);
        if (dayOfWeek >= 0) {
          const offset = (dayOfWeek - today.getDay() + 7) % 7;
          date.setDate(today.getDate() + offset);
        }

        return {
          label,
          date: date.toISOString().split('T')[0],
          time,
          source: 'recommended' as const,
        };
      });
    });
  }, [doctor]);

  const handleSelectSlot = (slot: SlotSelection) => {
    setSelectedSlot(slot);
    setCustomDate('');
    setCustomTime('');
    setBookingStatus('idle');
    setBookingMessage('');
  };

  const handleCustomSlotChange = (date: string, time: string) => {
    setSelectedSlot(date && time ? { date, time, label: `${date} • ${time}`, source: 'custom' } : null);
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

    setBookingStatus('idle');
    setBookingMessage('');
    setSendingSummary(true);

    try {
      // Upload prescription if provided
      let prescriptionPath = null;
      if (prescriptionFile) {
        try {
          prescriptionPath = await uploadPrescription(user.id, prescriptionFile);
        } catch (error) {
          console.error('Error uploading prescription:', error);
          // Continue with booking even if prescription upload fails
        }
      }

      // Create appointment in database
      const appointmentDate = new Date(selectedSlot.date);
      const { error } = await mongodb
        .from('appointments')
        .insert({
          patient_id: user.id,
          doctor_id: doctor.id,
          doctor_name: doctor.name,
          doctor_hospital: doctor.hospital,
          appointment_date: appointmentDate.toISOString(),
          appointment_time: selectedSlot.time,
          status: 'scheduled',
          consultation_type: 'in-person',
          notes: generatedSummary || visitNotes || null,
          prescription_storage_path: prescriptionPath
        } as any);

      if (error) {
        console.error('Error booking appointment:', error);
        setBookingStatus('error');
        setBookingMessage('Failed to book appointment. Please try again.');
        setSendingSummary(false);
        return;
      }

      setSendingSummary(false);
      setBookingStatus('success');
      setBookingMessage(`Appointment booked for ${selectedSlot.label}.${generatedSummary ? ' We\'ve sent your visit summary to the clinic.' : ''}`);
      
      // Redirect to dashboard after success
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (error) {
      console.error('Error in booking process:', error);
      setSendingSummary(false);
      setBookingStatus('error');
      setBookingMessage('An unexpected error occurred. Please try again.');
    }
  };

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
            <h2 className="text-xl font-semibold">Specialist not found</h2>
            <p className="text-sm text-muted-foreground mt-2">Choose a doctor from the consult directory to continue.</p>
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
                <h1 className="text-3xl font-bold">Book with {doctor.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">{doctor.title}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 mt-2">
                  <MapPin className="h-4 w-4" /> {doctor.hospital}, {doctor.location}, {doctor.state}
                </p>
                <p className="text-xs text-muted-foreground mt-2">{doctor.bio}</p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3 text-sm bg-muted/40">
                <p className="font-semibold">Contact</p>
                <p className="flex items-center gap-2 mt-1"><Phone className="h-4 w-4" /> {doctor.phone}</p>
                {doctor.videoUrl && (
                  <a
                    className="flex items-center gap-2 mt-2 text-primary-foreground hover:underline"
                    href={doctor.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Video className="h-4 w-4" /> Request video consult
                  </a>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-muted/40 border-dashed">
                <h2 className="font-semibold text-lg flex items-center gap-2"><Calendar className="h-5 w-5 text-primary-foreground" /> Recommended slots</h2>
                <p className="text-xs text-muted-foreground mt-1">Pick from upcoming availability shared by the clinic.</p>
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
                  {recommendedSlots.length === 0 && <p className="text-xs text-muted-foreground">No slots published yet. Contact the clinic directly.</p>}
                </div>
              </Card>

              <Card className="bg-muted/40 border-dashed">
                <h2 className="font-semibold text-lg flex items-center gap-2"><Clock className="h-5 w-5 text-primary-foreground" /> Prefer a different time?</h2>
                <p className="text-xs text-muted-foreground mt-1">Suggest a date and time that suits you. The clinic will confirm shortly.</p>
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
                  <p className="text-xs text-muted-foreground">We’ll request this slot with the clinic if available.</p>
                </div>
              </Card>
            </div>
          </div>
        </Card>

        <Card className="bg-card/80">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Prepare your visit summary</h2>
            <p className="text-sm text-muted-foreground">
              Summarise what’s changed, any prediction results, and the support you need. The assistant can turn your notes into a short brief for the doctor.
            </p>
            <textarea
              value={visitNotes}
              onChange={(event) => setVisitNotes(event.target.value)}
              placeholder="Example: Recent tremor increase in evenings, medication wearing off by 7pm, AI gait prediction suggests higher fall risk, need guidance on adjusting levodopa timing."
              className="w-full min-h-[120px] rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            
            {/* Prescription Upload */}
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
              {generatingSummary ? 'Generating summary…' : 'Generate visit brief'}
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
              We’ll include this brief in the appointment request so {doctor.name.split(' ')[0]} arrives ready. You can edit it anytime before booking.
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
            {generatedSummary && (
              <div className="rounded-lg border border-emerald-300/60 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-50">
                <p className="font-semibold mb-1">Shared summary</p>
                <p className="whitespace-pre-wrap">{generatedSummary}</p>
              </div>
            )}
            <p className="text-xs text-emerald-100/80">A clinic coordinator will reach out to confirm. If you don’t hear back within 24 hours, call the hospital directly.</p>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Appointment requests are simulated in this demo. Contact the clinic to finalise timing or emergency instructions.
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
