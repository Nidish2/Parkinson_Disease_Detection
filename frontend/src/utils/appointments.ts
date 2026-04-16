import type { AppointmentRecord } from '../types/healthcare';

export const normalizeAppointmentStatus = (status?: string | null) => (status || '').trim().toLowerCase();

export const isRejectedAppointment = (appointment: AppointmentRecord) =>
  normalizeAppointmentStatus(appointment.status) === 'rejected';

export const isHistoricalAppointment = (appointment: AppointmentRecord) => {
  const appointmentStatus = normalizeAppointmentStatus(appointment.status);
  const reportStatus = normalizeAppointmentStatus(appointment.report?.status);

  if (appointmentStatus === 'completed' || appointmentStatus === 'reviewed') {
    return true;
  }

  if (reportStatus === 'reviewed' || reportStatus === 'completed') {
    return true;
  }

  return false;
};

export const isActiveAppointment = (appointment: AppointmentRecord) =>
  !isRejectedAppointment(appointment) && !isHistoricalAppointment(appointment);

const statusPriority = (appointment: AppointmentRecord) => {
  switch (normalizeAppointmentStatus(appointment.status)) {
    case 'accepted':
      return 7;
    case 'rescheduled':
      return 6;
    case 'pending':
      return 5;
    case 'reviewed':
      return 4;
    case 'completed':
      return 3;
    case 'rejected':
      return 1;
    case 'cancelled':
      return 0;
    default:
      return 2;
  }
};

const appointmentTimestamp = (appointment: AppointmentRecord) => {
  const rawValue = appointment.updated_at
    || appointment.created_at
    || `${appointment.appointment_date || ''}T${appointment.appointment_time || '00:00'}`;
  const parsed = new Date(rawValue).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const collapseKey = (appointment: AppointmentRecord) =>
  appointment.report_id || appointment.id || `${appointment.patient_id}-${appointment.doctor_id}-${appointment.appointment_date}-${appointment.appointment_time}`;

const choosePreferredAppointment = (current: AppointmentRecord, candidate: AppointmentRecord) => {
  const currentPriority = statusPriority(current);
  const candidatePriority = statusPriority(candidate);

  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority ? candidate : current;
  }

  return appointmentTimestamp(candidate) >= appointmentTimestamp(current) ? candidate : current;
};

export const collapseAppointments = (appointments: AppointmentRecord[]) => {
  const grouped = new Map<string, AppointmentRecord>();

  appointments.forEach((appointment) => {
    if (!appointment?.id) return;

    const key = collapseKey(appointment);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, appointment);
      return;
    }

    grouped.set(key, choosePreferredAppointment(existing, appointment));
  });

  return Array.from(grouped.values()).sort((left, right) => appointmentTimestamp(right) - appointmentTimestamp(left));
};
