export type UserRole = 'patient' | 'doctor' | 'admin';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ReportStatus = 'pending' | 'reviewed' | 'completed';
export type AppointmentStatus = 'pending' | 'accepted' | 'rejected' | 'rescheduled' | 'completed' | 'cancelled';

export interface AvailabilitySlot {
  date: string;
  time: string;
  mode?: 'video' | 'in-person';
  label?: string;
}

export interface AppUser {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  approval_status?: ApprovalStatus;
  phone?: string | null;
  hospital?: string | null;
  specialties?: string[];
  doctor_identifier?: string | null;
  age?: number | null;
  gender?: string | null;
  qualification?: string | null;
  years_experience?: number | null;
  availability_slots?: AvailabilitySlot[];
  created_at?: string;
}

export interface PatientSnapshot {
  id: string;
  full_name: string;
  email?: string;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  age?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  stage?: string | null;
  bmi?: number | null;
  bmiClass?: string | null;
}

export interface DoctorSnapshot {
  id: string;
  full_name: string;
  email?: string;
  phone?: string | null;
  hospital?: string | null;
  specialties?: string[];
  doctor_identifier?: string | null;
  age?: number | null;
  gender?: string | null;
  qualification?: string | null;
  years_experience?: number | null;
  availability_slots?: AvailabilitySlot[];
  approval_status?: ApprovalStatus;
}

export interface ReportAiResults {
  sourceTestId: string;
  sourceTestType: string;
  generatedAt: string;
  summary?: {
    label?: string;
    riskLevel?: string;
    riskScore?: number;
    confidence?: number;
  };
  fusion?: Record<string, any> | null;
  recentTests: Array<{
    id: string;
    test_type: string;
    created_at: string;
    confidence?: number | null;
    result?: Record<string, any> | null;
    model_versions?: Record<string, any> | null;
  }>;
}

export interface UnifiedReport {
  id: string;
  patient_id: string;
  test_id: string;
  patientDetails: PatientSnapshot;
  doctorDetails?: DoctorSnapshot | null;
  aiResults: ReportAiResults;
  doctorNotes: string;
  prescription: string[];
  suggestions: string;
  status: ReportStatus;
  doctor_id?: string | null;
  appointment_id?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface AppointmentRecord {
  id: string;
  patient_id: string;
  doctor_id: string;
  doctor_name?: string;
  doctor_hospital?: string | null;
  appointment_date: string;
  appointment_time: string;
  status: AppointmentStatus | string;
  consultation_type: string;
  notes?: string | null;
  prescription_storage_path?: string | null;
  report_id: string;
  call_room?: string;
  call_url?: string;
  doctor_response_notes?: string | null;
  requested_appointment_date?: string | null;
  requested_appointment_time?: string | null;
  patientDetails?: PatientSnapshot;
  doctorDetails?: DoctorSnapshot | null;
  report?: UnifiedReport | null;
  created_at: string;
  updated_at?: string;
}

export interface ChatMessageRecord {
  id: string;
  appointment_id: string;
  report_id?: string | null;
  sender_id: string;
  sender_role: UserRole;
  sender_name: string;
  message: string;
  created_at: string;
}
