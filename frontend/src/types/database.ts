export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Profile = Database['public']['Tables']['patient_profiles']['Row'];
export type Test = Database['public']['Tables']['tests']['Row'];
export type Appointment = Database['public']['Tables']['appointments']['Row'];

export type HandwritingClass = 'Parkinsons' | 'Healthy';
export type HandwritingType = 'spiral' | 'wave';

export interface Database {
  public: {
    Tables: {
      patient_profiles: {
        Row: {
          id: string
          full_name: string | null
          date_of_birth: string | null
          gender: string | null
          phone: string | null
          emergency_contact: string | null
          consent_flags: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          date_of_birth?: string | null
          gender?: string | null
          phone?: string | null
          emergency_contact?: string | null
          consent_flags?: Json | null
        }
        Update: {
          full_name?: string | null
          date_of_birth?: string | null
          gender?: string | null
          phone?: string | null
          emergency_contact?: string | null
          consent_flags?: Json | null
          updated_at?: string
        }
      }
      tests: {
        Row: {
          id: string
          patient_id: string
          test_type: string
          raw_storage_path: string | null
          processed_storage_path: string | null
          result: Json | null
          model_versions: Json | null
          confidence: number | null
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          test_type: string
          raw_storage_path?: string | null
          processed_storage_path?: string | null
          result?: Json | null
          model_versions?: Json | null
          confidence?: number | null
        }
        Update: {
          raw_storage_path?: string | null
          processed_storage_path?: string | null
          result?: Json | null
          model_versions?: Json | null
          confidence?: number | null
          test_type?: string
        }
      }
      reports: {
        Row: {
          id: string
          test_id: string
          patient_id: string
          pdf_storage_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          test_id: string
          patient_id: string
          pdf_storage_path?: string | null
        }
        Update: {
          pdf_storage_path?: string | null
        }
      }
      orders: {
        Row: {
          id: string
          patient_id: string
          order_payload: Json | null
          status: string | null
          external_order_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          order_payload?: Json | null
          status?: string | null
          external_order_id?: string | null
        }
        Update: {
          order_payload?: Json | null
          status?: string | null
          external_order_id?: string | null
        }
      }
      appointments: {
        Row: {
          id: string
          patient_id: string
          doctor_id: string
          doctor_name: string
          doctor_hospital: string | null
          appointment_date: string
          appointment_time: string
          status: string
          consultation_type: string
          notes: string | null
          prescription_storage_path: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          doctor_id: string
          doctor_name: string
          doctor_hospital?: string | null
          appointment_date: string
          appointment_time: string
          status?: string
          consultation_type?: string
          notes?: string | null
          prescription_storage_path?: string | null
        }
        Update: {
          appointment_date?: string
          appointment_time?: string
          status?: string
          consultation_type?: string
          notes?: string | null
          prescription_storage_path?: string | null
          updated_at?: string
        }
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: {
        test_type: 'speech' | 'spiral' | 'wave' | 'video'
    }
    CompositeTypes: { [_ in never]: never }
  }
}
