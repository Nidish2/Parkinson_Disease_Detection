import apiClient from './api';
import type { AppointmentRecord, AppointmentStatus, AppUser, AvailabilitySlot, ChatMessageRecord, ReportStatus, UnifiedReport, UserRole } from '../types/healthcare';

export const getDashboardRouteForRole = (role?: UserRole | null) => {
  if (role === 'doctor') return '/doctor-dashboard';
  if (role === 'admin') return '/admin-dashboard';
  return '/patient-dashboard';
};

export const listApprovedDoctors = async () => {
  const response = await apiClient.get<{ data: AppUser[] }>('/doctors');
  return response.data.data || [];
};

export const ensureUnifiedReport = async (payload: { reportId?: string; testId?: string } = {}) => {
  const response = await apiClient.post<{ data: UnifiedReport }>('/reports/ensure', payload);
  return response.data.data;
};

export const getReports = async () => {
  const response = await apiClient.get<{ data: UnifiedReport[] }>('/reports');
  return response.data.data || [];
};

export const getReportById = async (reportId: string) => {
  const response = await apiClient.get<{ data: UnifiedReport }>(`/reports/${reportId}`);
  return response.data.data;
};

export const updateDoctorReport = async (
  reportId: string,
  payload: {
    doctorNotes: string;
    prescription: string[];
    suggestions: string;
    status: ReportStatus;
  },
) => {
  const response = await apiClient.patch<{ data: UnifiedReport }>(`/reports/${reportId}/doctor-review`, payload);
  return response.data.data;
};

export const getAppointments = async () => {
  const response = await apiClient.get<{ data: AppointmentRecord[] }>('/appointments');
  return response.data.data || [];
};

export const createAppointment = async (payload: {
  doctorId: string;
  reportId?: string;
  testId?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  consultationType?: string;
  status?: string;
  notes?: string;
  previousPrescriptionPath?: string;
}) => {
  const response = await apiClient.post<{ data: AppointmentRecord }>('/appointments', payload);
  return response.data.data;
};

export const reviewAppointmentByDoctor = async (
  appointmentId: string,
  payload: {
    status: AppointmentStatus;
    appointmentDate?: string;
    appointmentTime?: string;
    doctorResponseNotes?: string;
  },
) => {
  const response = await apiClient.patch<{ data: AppointmentRecord }>(`/appointments/${appointmentId}/review`, payload);
  return response.data.data;
};

export const getAdminUsers = async () => {
  const response = await apiClient.get<{ data: AppUser[] }>('/admin/users');
  return response.data.data || [];
};

export const getAdminDoctors = async () => {
  const response = await apiClient.get<{ data: AppUser[] }>('/admin/doctors');
  return response.data.data || [];
};

export const updateDoctorApproval = async (doctorId: string, approvalStatus: 'approved' | 'rejected' | 'pending') => {
  const response = await apiClient.patch<{ data: AppUser }>(`/admin/doctors/${doctorId}/approval`, { approvalStatus });
  return response.data.data;
};

export const deleteUser = async (userId: string) => {
  await apiClient.delete(`/admin/users/${userId}`);
};

export const updateDoctorAvailability = async (availabilitySlots: AvailabilitySlot[]) => {
  const response = await apiClient.patch<{ data: AppUser }>('/doctors/me/availability', { availabilitySlots });
  return response.data.data;
};

export const getAppointmentMessages = async (appointmentId: string) => {
  const response = await apiClient.get<{ data: ChatMessageRecord[] }>(`/appointments/${appointmentId}/messages`);
  return response.data.data || [];
};

export const sendAppointmentMessage = async (appointmentId: string, message: string) => {
  const response = await apiClient.post<{ data: ChatMessageRecord }>(`/appointments/${appointmentId}/messages`, { message });
  return response.data.data;
};
