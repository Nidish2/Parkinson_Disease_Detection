import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoaderCircle, MessageSquare, Send, Video } from 'lucide-react';
import Card from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import {
  connectAppointmentSocket,
  isRealtimeSocketUnavailable,
  joinAppointmentRoom,
  leaveAppointmentRoom,
  markRealtimeSocketUnavailable,
  sendRealtimeAppointmentMessage,
} from '../services/appointmentSocket';
import { getAppointmentMessages, getAppointments, sendAppointmentMessage } from '../services/healthcareApi';
import type { AppointmentRecord, ChatMessageRecord } from '../types/healthcare';

const AppointmentCommunication = () => {
  const { appointmentId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [appointment, setAppointment] = useState<AppointmentRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const [callInfoOpen, setCallInfoOpen] = useState(false);

  const appendUniqueMessage = (incoming: ChatMessageRecord) => {
    setMessages((current) => {
      if (current.some((message) => message.id === incoming.id)) {
        return current;
      }
      return [...current, incoming];
    });
  };

  const loadData = async () => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }
    try {
      const appointments = await getAppointments().catch(() => []);
      const linkedAppointment = appointments.find((item) => item.id === appointmentId) || null;
      setAppointment(linkedAppointment);

      try {
        const appointmentMessages = await getAppointmentMessages(appointmentId);
        setMessages(appointmentMessages);
        setHistoryUnavailable(false);
        setChatUnavailable(false);
      } catch (error: any) {
        if (error?.response?.status === 404 || error?.response?.status === 403) {
          setHistoryUnavailable(true);
          setChatUnavailable(true);
          setMessages([]);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Failed to load communication data:', error);
      setAppointment((current) => current);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [appointmentId]);

  useEffect(() => {
    if (!appointmentId || !user) {
      return undefined;
    }

    if (isRealtimeSocketUnavailable()) {
      setLiveConnected(false);
      return undefined;
    }

    const socket = connectAppointmentSocket();
    if (!socket) {
      setLiveConnected(false);
      return undefined;
    }

    const handleConnect = () => {
      setLiveConnected(true);
      joinAppointmentRoom(appointmentId);
    };

    const handleDisconnect = () => {
      setLiveConnected(false);
    };

    const handleConnectError = () => {
      setLiveConnected(false);
      markRealtimeSocketUnavailable();
    };

    const handleAppointmentMessage = (incoming: ChatMessageRecord) => {
      if (incoming.appointment_id !== appointmentId) {
        return;
      }
      appendUniqueMessage(incoming);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('appointment_message', handleAppointmentMessage);
    socket.on('connect_error', handleConnectError);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      leaveAppointmentRoom(appointmentId);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('appointment_message', handleAppointmentMessage);
    };
  }, [appointmentId, user]);

  const backLink = useMemo(() => {
    if (user?.role === 'doctor') return '/doctor-dashboard';
    if (user?.role === 'admin') return '/admin-dashboard';
    return '/patient-dashboard';
  }, [user?.role]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!appointmentId || !draft.trim()) return;

    setSending(true);
    try {
      const created = liveConnected
        ? await sendRealtimeAppointmentMessage(appointmentId, draft.trim())
        : await sendAppointmentMessage(appointmentId, draft.trim());
      appendUniqueMessage(created);
      setChatUnavailable(false);
      setDraft('');
    } catch (error: any) {
      if (error?.response?.status === 404) {
        setChatUnavailable(true);
      }
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!appointment) {
    return (
      <Card className="rounded-organic-2 bg-background/70">
        <p className="text-2xl font-serif font-bold text-foreground">Appointment communication room not found</p>
      </Card>
    );
  }

  const appointmentAccepted = appointment.status === 'accepted' || appointment.status === 'completed';

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-4xl font-serif font-bold text-foreground">Consultation Room</h2>
          <p className="text-muted-foreground mt-1">Call and chat stay linked to the same appointment and report.</p>
        </div>
        <Link
          to={backLink}
          className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>

      <Card className="rounded-organic-4 bg-background/70">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Patient</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{appointment.patientDetails?.full_name || 'Patient'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Doctor</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{appointment.doctorDetails?.full_name || appointment.doctor_name || 'Doctor'}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Date & Time</p>
            <p className="text-lg font-serif font-bold text-foreground mt-1">{new Date(appointment.appointment_date).toLocaleDateString()} {appointment.appointment_time}</p>
          </div>
          <div className="rounded-2xl border border-border/40 bg-background/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Linked Report</p>
            <Link to={`/reports/${appointment.report_id}`} className="text-lg font-serif font-bold text-primary mt-1 inline-block">Open Report</Link>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="rounded-organic-1 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground">Call Access</h3>
            <p className="text-sm text-muted-foreground mt-1">Start or join the video room for this appointment.</p>
          </div>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
              <p className="text-sm text-muted-foreground">Consultation type: <span className="font-semibold text-foreground capitalize">{appointment.consultation_type}</span></p>
              <p className="text-sm text-muted-foreground mt-2">Status: <span className="font-semibold text-foreground capitalize">{appointment.status}</span></p>
            </div>
            {appointment.call_url && appointmentAccepted ? (
              <div className="space-y-3">
                <a
                  href={appointment.call_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Video className="h-4 w-4" />
                  {user?.role === 'doctor' ? 'Start Call' : 'Join Call'}
                </a>
                <button
                  type="button"
                  onClick={() => setCallInfoOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
                >
                  How call works
                </button>
                {callInfoOpen && (
                  <div className="rounded-2xl border border-border/40 bg-background/50 p-4 text-sm text-muted-foreground">
                    This call uses a shared meeting room link. Right now there is no phone-style ringing or popup incoming-call alert.
                    The patient and doctor see the scheduled appointment on their dashboards, then click `Start Call` or `Join Call` to enter the same room.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-4 text-sm text-muted-foreground">
                Call will be enabled after the doctor accepts this appointment.
              </div>
            )}
          </div>
        </Card>

        <Card className="rounded-organic-3 bg-background/70">
          <div className="border-b border-border/30 pb-4">
            <h3 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /> Appointment Chat</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Doctor and patient can exchange messages around the appointment and report.
              {appointmentAccepted
                ? (liveConnected ? ' Live now via Socket.IO.' : ' Reconnecting live channel...')
                : ' Chat unlocks after doctor acceptance.'}
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {historyUnavailable && (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-3 text-sm text-muted-foreground">
                Previous chat history is unavailable for this older appointment.
              </div>
            )}
            {chatUnavailable && !liveConnected && (
              <div className="rounded-2xl border border-border/40 bg-background/50 p-3 text-sm text-muted-foreground">
                Live chat is unavailable until the backend is restarted with the latest appointment chat routes.
              </div>
            )}
            <div className="max-h-[24rem] space-y-3 overflow-y-auto rounded-2xl border border-border/40 bg-background/50 p-4">
              {messages.length > 0 ? messages.map((message) => {
                const isOwn = message.sender_id === user?.id;
                return (
                  <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-background border border-border/50 text-foreground'}`}>
                      <p className="text-xs font-semibold opacity-80">{message.sender_name} | {message.sender_role}</p>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{message.message}</p>
                      <p className="mt-2 text-[11px] opacity-70">{new Date(message.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-8 text-muted-foreground text-sm">No chat messages yet.</div>
              )}
            </div>

            <form onSubmit={handleSend} className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a message..."
                className="flex-1 rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim() || chatUnavailable || !appointmentAccepted}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default AppointmentCommunication;
