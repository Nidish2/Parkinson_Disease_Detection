import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, LoaderCircle, MessageSquare, Plus, Save, Stethoscope, Video } from 'lucide-react';
import Card from '../components/Card';
import Chart from '../components/Chart';
import { useAuth } from '../hooks/useAuth';
import { getAppointments, reviewAppointmentByDoctor, updateDoctorAvailability } from '../services/healthcareApi';
import type { AppointmentRecord, AvailabilitySlot } from '../types/healthcare';
import { collapseAppointments, isActiveAppointment, isHistoricalAppointment, isRejectedAppointment, normalizeAppointmentStatus } from '../utils/appointments';

const appointmentStatusChart = (appointments: AppointmentRecord[]) => {
  const statusCounts = appointments.reduce((acc, appointment) => {
    const key = appointment.report?.status || appointment.status || 'pending';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['50%', '78%'],
      data: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      color: ['#5D7052', '#C18C5D', '#A85448', '#4A4A40'],
    }],
  };
};

const scheduleChart = (appointments: AppointmentRecord[]) => {
  const perDay = appointments.reduce((acc, appointment) => {
    const key = new Date(appointment.appointment_date).toLocaleDateString();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const labels = Object.keys(perDay);
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#6B7280', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#6B7280', fontSize: 11 } },
    series: [{
      type: 'bar',
      data: labels.map((label) => perDay[label]),
      itemStyle: { color: '#5D7052', borderRadius: [10, 10, 0, 0] },
    }],
    grid: { left: '8%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
  };
};

const DoctorDashboard = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [slotDate, setSlotDate] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [slotMode, setSlotMode] = useState<'video' | 'in-person'>('video');
  const [appointmentDrafts, setAppointmentDrafts] = useState<Record<string, { appointmentDate: string; appointmentTime: string; doctorResponseNotes: string }>>({});
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const [doctorView, setDoctorView] = useState<'active' | 'history'>('active');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const visibleAppointments = useMemo(
    () => appointments.filter((appointment) => !isRejectedAppointment(appointment)),
    [appointments],
  );
  const activeAppointments = useMemo(
    () => visibleAppointments.filter((appointment) => isActiveAppointment(appointment)),
    [visibleAppointments],
  );
  const historyAppointments = useMemo(
    () => visibleAppointments.filter((appointment) => isHistoricalAppointment(appointment)),
    [visibleAppointments],
  );

  const loadAppointments = async () => {
    if (!user) {
      setLoading(false);
      setInitialLoadComplete(true);
      return;
    }

    try {
      const data = await getAppointments();
      const activeAppointments = collapseAppointments(data).filter((appointment) => !isRejectedAppointment(appointment));
      setAppointments(activeAppointments);
      setAvailabilitySlots(user.availability_slots || []);
      setAppointmentDrafts((current) => {
        const next = { ...current };
        activeAppointments.forEach((appointment) => {
          next[appointment.id] = next[appointment.id] || {
            appointmentDate: appointment.appointment_date,
            appointmentTime: appointment.appointment_time,
            doctorResponseNotes: appointment.doctor_response_notes || '',
          };
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to load doctor appointments:', error);
      setAppointments([]);
      setAvailabilitySlots(user?.availability_slots || []);
    } finally {
      setLoading(false);
      setInitialLoadComplete(true);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [user]);

  useEffect(() => {
    if (!user || user.approval_status !== 'approved') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      loadAppointments();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [user]);

  const stats = useMemo(() => ({
    total: visibleAppointments.length,
    pending: activeAppointments.filter((appointment) => ['pending', 'rescheduled'].includes(normalizeAppointmentStatus(appointment.status))).length,
    completed: historyAppointments.length,
  }), [activeAppointments, historyAppointments.length, visibleAppointments.length]);

  useEffect(() => {
    if (doctorView === 'active' && activeAppointments.length === 0 && historyAppointments.length > 0 && !initialLoadComplete) {
      setDoctorView('history');
    }
  }, [activeAppointments.length, doctorView, historyAppointments.length, initialLoadComplete]);

  const updateAppointmentDraft = (appointmentId: string, field: 'appointmentDate' | 'appointmentTime' | 'doctorResponseNotes', value: string) => {
    setAppointmentDrafts((current) => ({
      ...current,
      [appointmentId]: {
        appointmentDate: current[appointmentId]?.appointmentDate || '',
        appointmentTime: current[appointmentId]?.appointmentTime || '',
        doctorResponseNotes: current[appointmentId]?.doctorResponseNotes || '',
        [field]: value,
      },
    }));
  };

  const handleAppointmentReview = async (appointment: AppointmentRecord, status: 'accepted' | 'rejected' | 'rescheduled') => {
    const draft = appointmentDrafts[appointment.id] || {
      appointmentDate: appointment.appointment_date,
      appointmentTime: appointment.appointment_time,
      doctorResponseNotes: appointment.doctor_response_notes || '',
    };

    setUpdatingAppointmentId(appointment.id);
    try {
      const updated = await reviewAppointmentByDoctor(appointment.id, {
        status,
        appointmentDate: draft.appointmentDate,
        appointmentTime: draft.appointmentTime,
        doctorResponseNotes: draft.doctorResponseNotes,
      });
      setAppointments((current) => {
        if (isRejectedAppointment(updated)) {
          return current.filter((item) => item.id !== appointment.id);
        }
        return collapseAppointments(current.map((item) => (item.id === appointment.id ? updated : item)));
      });
      if (status === 'rejected') {
        setAppointmentDrafts((current) => {
          const next = { ...current };
          delete next[appointment.id];
          return next;
        });
      }
    } catch (error) {
      console.error('Failed to review appointment:', error);
    } finally {
      setUpdatingAppointmentId(null);
    }
  };

  const addAvailabilitySlot = () => {
    if (!slotDate || !slotTime) return;
    setAvailabilitySlots((current) => [
      ...current,
      {
        date: slotDate,
        time: slotTime,
        mode: slotMode,
        label: `${new Date(slotDate).toLocaleDateString()} | ${slotTime}`,
      },
    ]);
    setSlotDate('');
    setSlotTime('');
  };

  const removeAvailabilitySlot = (index: number) => {
    setAvailabilitySlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
  };

  const saveAvailability = async () => {
    setSavingAvailability(true);
    try {
      const updatedUser = await updateDoctorAvailability(availabilitySlots);
      setAvailabilitySlots(updatedUser.availability_slots || []);
    } catch (error) {
      console.error('Failed to save doctor availability:', error);
    } finally {
      setSavingAvailability(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return null;
  }

  if (user.approval_status !== 'approved') {
    return (
      <div className="space-y-6">
        <Card className="rounded-organic-2 bg-background/70">
          <div className="flex items-center gap-4">
            <div className="rounded-[2rem] bg-secondary/10 p-4">
              <Stethoscope className="h-8 w-8 text-secondary" />
            </div>
            <div>
              <h2 className="text-3xl font-serif font-bold text-foreground">Doctor Dashboard</h2>
              <p className="text-muted-foreground mt-2">Your account is awaiting admin approval before patient appointments and reports become available.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-[2rem] bg-primary/10 p-4">
          <Stethoscope className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-4xl font-serif font-bold text-foreground">Doctor Dashboard</h2>
          <p className="text-muted-foreground mt-1">Manage availability, review linked reports, and communicate with patients in one workflow.</p>
        </div>
      </div>

      <Card className="rounded-organic-4 bg-background/70">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Doctor ID</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{user.doctor_identifier || 'Not added'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Hospital</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{user.hospital || 'Not added'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Qualification</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{user.qualification || 'Not added'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Experience</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{user.years_experience ?? 'N/A'} yrs</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="rounded-organic-1 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Appointments</p>
          <p className="mt-3 text-4xl font-serif font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="rounded-organic-2 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Awaiting Review</p>
          <p className="mt-3 text-4xl font-serif font-bold text-secondary">{stats.pending}</p>
        </Card>
        <Card className="rounded-organic-3 bg-background/70">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Completed Reports</p>
          <p className="mt-3 text-4xl font-serif font-bold text-primary">{stats.completed}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-organic-4 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Availability Planner</h3>
            <p className="text-sm text-muted-foreground mt-1">Set your available dates and times for patients to book.</p>
          </div>
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="date"
                value={slotDate}
                onChange={(event) => setSlotDate(event.target.value)}
                className="rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="time"
                value={slotTime}
                onChange={(event) => setSlotTime(event.target.value)}
                className="rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={slotMode}
                onChange={(event) => setSlotMode(event.target.value as 'video' | 'in-person')}
                className="rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="video">Video</option>
                <option value="in-person">In person</option>
              </select>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={addAvailabilitySlot}
                className="inline-flex items-center gap-2 rounded-full border border-border/50 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
              >
                <Plus className="h-4 w-4" /> Add Slot
              </button>
              <button
                type="button"
                onClick={saveAvailability}
                disabled={savingAvailability}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {savingAvailability ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Availability
              </button>
            </div>
            <div className="space-y-3">
              {availabilitySlots.length > 0 ? availabilitySlots.map((slot, index) => (
                <button
                  key={`${slot.date}-${slot.time}-${index}`}
                  type="button"
                  onClick={() => removeAvailabilitySlot(index)}
                  className="w-full rounded-2xl border border-border/40 bg-background/50 px-4 py-3 text-left text-sm text-foreground"
                >
                  {new Date(slot.date).toLocaleDateString()} | {slot.time} | {slot.mode || 'video'}
                </button>
              )) : (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/40 p-5 text-sm text-muted-foreground text-center">
                  No availability slots added yet.
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="rounded-organic-1 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Clinical Analytics</h3>
            <p className="text-sm text-muted-foreground mt-1">Track your review load and appointment flow.</p>
          </div>
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div className="h-72 rounded-2xl border border-border/40 bg-background/50 p-4">
              <Chart option={appointmentStatusChart(appointments)} />
            </div>
            <div className="h-72 rounded-2xl border border-border/40 bg-background/50 p-4">
              <Chart option={scheduleChart(appointments)} />
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-organic-4 bg-background/70">
        <div className="flex items-center justify-between border-b border-border/30 pb-4">
          <div>
            <h3 className="text-2xl font-serif font-bold text-foreground">Patient Appointments</h3>
            <p className="text-sm text-muted-foreground mt-1">Open the linked report, start the call, or chat with the patient.</p>
          </div>
          <div className="inline-flex rounded-full border border-border/50 bg-white/70 p-1">
            <button
              type="button"
              onClick={() => setDoctorView('active')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${doctorView === 'active' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/40'}`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setDoctorView('history')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${doctorView === 'history' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/40'}`}
            >
              Completed
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {(doctorView === 'active' ? activeAppointments : historyAppointments).length > 0 ? (doctorView === 'active' ? activeAppointments : historyAppointments).map((appointment, index) => (
            <div
              key={appointment.id}
              className={`rounded-organic-${(index % 4) + 1} border border-border/40 bg-background/50 p-5`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-primary/10 p-2">
                      <ClipboardList className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xl font-serif font-bold text-foreground">{appointment.patientDetails?.full_name || 'Patient'}</p>
                      <p className="text-sm text-muted-foreground">{appointment.patientDetails?.stage || 'Clinical stage not provided'}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    {new Date(appointment.appointment_date).toLocaleDateString()} at {appointment.appointment_time}
                  </p>
                  <p className="text-sm text-muted-foreground capitalize">
                    Appointment status: <span className="font-semibold text-foreground">{appointment.status}</span>
                  </p>
                  {appointment.doctor_response_notes && (
                    <p className="text-sm text-muted-foreground">
                      Doctor note: <span className="font-semibold text-foreground">{appointment.doctor_response_notes}</span>
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-4 lg:min-w-[26rem]">
                  {doctorView === 'active' && (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          type="date"
                          value={appointmentDrafts[appointment.id]?.appointmentDate || appointment.appointment_date}
                          onChange={(event) => updateAppointmentDraft(appointment.id, 'appointmentDate', event.target.value)}
                          className="rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="time"
                          value={appointmentDrafts[appointment.id]?.appointmentTime || appointment.appointment_time}
                          onChange={(event) => updateAppointmentDraft(appointment.id, 'appointmentTime', event.target.value)}
                          className="rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <textarea
                        value={appointmentDrafts[appointment.id]?.doctorResponseNotes || ''}
                        onChange={(event) => updateAppointmentDraft(appointment.id, 'doctorResponseNotes', event.target.value)}
                        className="min-h-[88px] rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Add acceptance, rejection, or timing note for the patient."
                      />
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={updatingAppointmentId === appointment.id}
                          onClick={() => handleAppointmentReview(appointment, 'accepted')}
                          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                        >
                          {updatingAppointmentId === appointment.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={updatingAppointmentId === appointment.id}
                          onClick={() => handleAppointmentReview(appointment, 'rescheduled')}
                          className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          disabled={updatingAppointmentId === appointment.id}
                          onClick={() => handleAppointmentReview(appointment, 'rejected')}
                          className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </>
                  )}
                  {doctorView === 'history' && (
                    <div className="rounded-2xl border border-border/40 bg-background/60 p-4 space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Completed Review</p>
                      <p className="font-serif font-bold text-foreground capitalize">{appointment.status}</p>
                      {appointment.doctor_response_notes && (
                        <p className="text-sm text-muted-foreground mt-2">{appointment.doctor_response_notes}</p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                  {appointment.report_id && (
                    <Link
                      to={`/reports/${appointment.report_id}`}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Open Report
                    </Link>
                  )}
                  {appointment.call_url && appointment.status === 'accepted' && (
                    <a
                      href={appointment.call_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <Video className="h-4 w-4" /> Start Call
                    </a>
                  )}
                  {appointment.status === 'accepted' ? (
                    <Link
                      to={`/appointments/${appointment.id}/communication`}
                      className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <MessageSquare className="h-4 w-4" /> Chat
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full border border-border/40 px-5 py-2.5 text-sm font-semibold text-muted-foreground">
                      <MessageSquare className="h-4 w-4" /> Chat after acceptance
                    </span>
                  )}
                  </div>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-3xl border border-dashed border-border/60 bg-background/40 p-8 text-center">
              <p className="text-2xl font-serif font-bold text-foreground">{doctorView === 'active' ? 'No pending appointments' : 'No completed cases'}</p>
              <p className="text-sm text-muted-foreground mt-2">{doctorView === 'active' ? 'Accepted and pending patient requests will appear here automatically.' : 'Completed and reviewed patient cases will appear here.'}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default DoctorDashboard;
