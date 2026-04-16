import { useEffect, useMemo, useState } from 'react';
import { MapPin, Phone, Video, Clock, Languages, Stethoscope, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { getAppointments, listApprovedDoctors } from '../services/healthcareApi';
import { downloadUnifiedReportPdf } from '../utils/reportUtils';
import { collapseAppointments, isActiveAppointment, isHistoricalAppointment, isRejectedAppointment } from '../utils/appointments';
import type { AppUser, AppointmentRecord } from '../types/healthcare';

const defaultSlots = [
  { day: 'Monday', time: '10:00 AM' },
  { day: 'Wednesday', time: '2:30 PM' },
  { day: 'Friday', time: '11:15 AM' },
];

const Consult = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<AppUser[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [consultView, setConsultView] = useState<'active' | 'history' | 'reviews'>('active');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const loadDoctors = async () => {
      try {
        const [data, appointmentData] = await Promise.all([
          listApprovedDoctors(),
          user?.role === 'patient' ? getAppointments().catch(() => []) : Promise.resolve([]),
        ]);
        setDoctors(data);
        setAppointments(collapseAppointments(appointmentData));
      } catch (error) {
        console.error('Failed to load approved doctors:', error);
        setDoctors([]);
        setAppointments([]);
      } finally {
        setLoading(false);
        setInitialLoadComplete(true);
      }
    };

    loadDoctors();
    const interval = window.setInterval(loadDoctors, 5000);
    window.addEventListener('focus', loadDoctors);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', loadDoctors);
    };
  }, [user?.role]);

  const filteredDoctors = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return doctors;

    return doctors.filter((doctor) => [
      doctor.full_name,
      doctor.hospital,
      doctor.phone,
      ...(doctor.specialties || []),
    ].some((value) => value?.toLowerCase().includes(normalizedSearch)));
  }, [doctors, searchTerm]);
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

  const reviewedAppointments = useMemo(
    () => historyAppointments.filter((appointment) => appointment.report?.status === 'reviewed' || appointment.doctor_response_notes),
    [historyAppointments],
  );

  useEffect(() => {
    if (consultView === 'active' && activeAppointments.length === 0 && historyAppointments.length > 0 && !initialLoadComplete) {
      setConsultView('history');
    }
  }, [activeAppointments.length, consultView, historyAppointments.length, initialLoadComplete]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-primary/10 rounded-[2rem]">
              <Stethoscope className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-4xl font-serif font-bold text-foreground">Consult a Specialist</h2>
          </div>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Book with approved doctors already inside the platform so appointments, AI reports, prescriptions, and calls stay connected.
          </p>
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search doctor, hospital, specialty..."
          className="rounded-full border border-border/60 bg-white/60 backdrop-blur-sm px-5 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary shadow-sm hover:border-primary/50 transition-colors"
        />
      </div>

      <Card className="bg-primary/5 border border-primary/10 rounded-organic-2 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/60 rounded-2xl flex-shrink-0">
              <Stethoscope className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-foreground text-lg">Platform-connected doctors</h3>
              <p className="text-sm font-medium text-muted-foreground mt-1 leading-relaxed">
                Doctors shown here have approved platform accounts, so the appointment links directly to the same unified report they will review.
              </p>
            </div>
          </div>
          <p className="text-xs font-bold text-secondary max-w-xs lg:text-right bg-secondary/10 px-4 py-3 rounded-[1.5rem]">
            Emergency symptoms such as sudden weakness, chest pain, or confusion require immediate local medical attention.
          </p>
        </div>
      </Card>

      {user?.role === 'patient' && visibleAppointments.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
            <h3 className="text-2xl font-serif font-bold text-foreground">Your Consultations</h3>
              <p className="text-sm text-muted-foreground mt-1">Track doctor decisions, updated timing, and reviewed reports here.</p>
            </div>
            <div className="inline-flex rounded-full border border-border/50 bg-white/70 p-1">
              <button
                type="button"
                onClick={() => setConsultView('active')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${consultView === 'active' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/40'}`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setConsultView('history')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${consultView === 'history' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/40'}`}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setConsultView('reviews')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${consultView === 'reviews' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/40'}`}
              >
                Histories
              </button>
            </div>
          </div>
          <div className="grid gap-4">
            {(consultView === 'active' ? activeAppointments : consultView === 'history' ? historyAppointments.filter(a => !reviewedAppointments.includes(a)) : reviewedAppointments).length > 0 ? (consultView === 'active' ? activeAppointments : consultView === 'history' ? historyAppointments.filter(a => !reviewedAppointments.includes(a)) : reviewedAppointments).map((appointment) => (
              <Card key={appointment.id} className="rounded-organic-2 bg-white/70 border border-border/50">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <h4 className="text-xl font-serif font-bold text-foreground">{appointment.doctorDetails?.full_name || appointment.doctor_name || 'Doctor'}</h4>
                    <p className="text-sm text-muted-foreground">{appointment.doctorDetails?.hospital || appointment.doctor_hospital || 'Hospital not provided'}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(appointment.appointment_date).toLocaleDateString()} at {appointment.appointment_time}
                    </p>
                    <p className="text-sm text-muted-foreground capitalize">
                      Status: <span className="font-semibold text-foreground">{appointment.status}</span>
                    </p>
                    {appointment.report?.status && (
                      <p className="text-sm text-muted-foreground capitalize">
                        Report: <span className="font-semibold text-foreground">{appointment.report.status}</span>
                      </p>
                    )}
                    {appointment.doctor_response_notes && (
                      <p className="text-sm text-muted-foreground">
                        Doctor response: <span className="font-semibold text-foreground">{appointment.doctor_response_notes}</span>
                      </p>
                    )}
                    {appointment.report?.prescription?.length ? (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {appointment.report.prescription.map((item, index) => (
                          <span key={`${appointment.id}-${index}`} className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/reports/${appointment.report_id}`)}
                      className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90"
                    >
                      Open Report
                    </button>
                    <button
                      type="button"
                      onClick={() => appointment.report && downloadUnifiedReportPdf(appointment.report, appointment.patientDetails?.full_name)}
                      className="inline-flex items-center justify-center rounded-full border border-border/50 px-5 py-2.5 text-sm font-bold text-foreground hover:bg-muted/40 transition-colors"
                      disabled={!appointment.report}
                    >
                      Download Prescription
                    </button>
                    {appointment.status === 'accepted' ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/appointments/${appointment.id}/communication`)}
                        className="inline-flex items-center justify-center rounded-full border border-border/50 px-5 py-2.5 text-sm font-bold text-foreground hover:bg-muted/40 transition-colors"
                      >
                        Chat
                      </button>
                    ) : (
                      <span className="inline-flex items-center justify-center rounded-full border border-border/40 px-5 py-2.5 text-sm font-bold text-muted-foreground">
                        {consultView === 'history' ? 'Consultation closed' : 'Chat after doctor acceptance'}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            )) : (
              <Card className="rounded-organic-2 bg-white/60 border border-dashed border-border/60">
                <div className="py-10 text-center">
                  <h4 className="text-xl font-serif font-bold text-foreground">{consultView === 'active' ? 'No active consultations' : consultView === 'history' ? 'No pending consultations' : 'No consultation histories yet'}</h4>
                  <p className="text-sm text-muted-foreground mt-2">
                    {consultView === 'active'
                      ? 'Your pending and accepted doctor appointments will appear here.'
                      : consultView === 'history'
                      ? 'Pending reviews will appear here waiting for doctor feedback.'
                      : 'Reviewed reports and completed consultations with doctor feedback will appear here.'}
                  </p>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {filteredDoctors.length === 0 ? (
        <Card className="rounded-organic-3 bg-white/60 border-dashed border-2">
          <div className="text-center py-16">
            <div className="bg-secondary/10 w-20 h-20 mx-auto rounded-[2rem] flex items-center justify-center mb-4">
              <span className="text-secondary font-serif text-2xl font-bold">?</span>
            </div>
            <h3 className="text-2xl font-serif font-bold text-foreground">No approved doctors found</h3>
            <p className="text-base text-muted-foreground mt-2 font-medium">Ask an admin to approve a doctor account, then return here to book an appointment.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {filteredDoctors.map((doctor, index) => (
            <Card key={doctor.id} className={`h-full hover:shadow-float transition-all duration-500 rounded-organic-${(index % 4) + 1} bg-white/70 group border border-border/50 hover:border-primary/30`}>
              <div className="flex flex-col gap-5 h-full">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-2xl font-serif font-bold text-foreground group-hover:text-primary transition-colors">{doctor.full_name || doctor.email}</h3>
                      <span className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-bold text-primary">Approved</span>
                    </div>
                    <p className="text-sm font-bold text-secondary mt-1 tracking-wide">{doctor.qualification || 'Platform Doctor'}</p>
                    <p className="text-sm text-muted-foreground font-medium flex items-center gap-2 mt-2">
                      <MapPin className="h-4 w-4 text-primary" /> {doctor.hospital || 'Hospital not provided'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Doctor ID: {doctor.doctor_identifier || 'N/A'} • Experience: {doctor.years_experience ?? 'N/A'} yrs • Age: {doctor.age || 'N/A'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                    {(doctor.specialties?.length ? doctor.specialties : ['Neurology']).map((tag) => (
                      <span key={tag} className="rounded-full bg-muted/50 px-3 py-1 text-xs font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-default">{tag}</span>
                    ))}
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-foreground font-medium flex-grow">
                  Review AI-generated Parkinson&apos;s screening reports, add prescriptions directly into the same report, and continue care through a linked call room.
                </p>

                <div className="grid gap-4 md:grid-cols-2 mt-auto">
                  <div className="rounded-[1.5rem] border border-border/50 bg-background/50 px-4 py-4 backdrop-blur-sm">
                    <p className="text-xs font-bold tracking-wider uppercase text-muted-foreground mb-3 flex items-center gap-2">
                      Expertise focus
                    </p>
                    <ul className="space-y-2 text-sm font-medium text-foreground">
                      {(doctor.specialties?.length ? doctor.specialties : ['Movement disorder review', 'Medication support']).map((specialty) => (
                        <li key={specialty} className="flex items-start gap-3">
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary/60" aria-hidden />
                          {specialty}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-[1.5rem] border border-border/50 bg-background/50 px-4 py-4 backdrop-blur-sm space-y-4">
                    <div className="flex items-center gap-3 text-sm font-bold text-foreground">
                      <div className="p-1.5 bg-secondary/10 rounded-lg"><Languages className="h-4 w-4 text-secondary" /></div>
                      {doctor.gender || 'Doctor profile ready'}
                    </div>
                    <div>
                      <p className="text-xs font-bold tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        Upcoming availability
                      </p>
                      <div className="space-y-2">
                        {(doctor.availability_slots?.length
                          ? doctor.availability_slots.map((slot, index) => ({ key: `${doctor.id}-${index}`, label: formatSlotLabel(slot.date, slot.time) }))
                          : defaultSlots.map((slot) => ({ key: `${doctor.id}-${slot.day}`, label: `${slot.day}: ${slot.time}` })))
                          .map((slot) => (
                            <p key={slot.key} className="flex items-center gap-3 text-sm font-medium text-foreground">
                              <Clock className="h-4 w-4 text-primary/60" /> {slot.label}
                            </p>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-4 border-t border-border/50">
                  <div className="flex items-center gap-4 text-sm font-bold">
                    <a href={`tel:${doctor.phone || ''}`} className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors bg-primary/5 px-3 py-1.5 rounded-full">
                      <Phone className="h-4 w-4" /> {doctor.phone || 'Phone not provided'}
                    </a>
                    <span className="flex items-center gap-2 text-secondary bg-secondary/5 px-3 py-1.5 rounded-full">
                      <Video className="h-4 w-4" /> Call-ready
                    </span>
                  </div>
                  <button
                    onClick={() => navigate(`/consult/${doctor.id}/book`)}
                    className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 shadow-soft hover:-translate-y-0.5"
                  >
                    Check options
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Consult;
const formatSlotLabel = (date: string, time: string) => `${new Date(date).toLocaleDateString()} • ${time}`;
