import { mongodb } from '../lib/mongodbClient';

export interface OnSchedTimeSlot {
  id: string;
  start: string;
  end: string;
  serviceName?: string;
  providerName?: string;
  locationName?: string;
  source: 'live' | 'demo';
}

export interface CreateOnSchedAppointmentInput {
  slotId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
}

export interface CreateOnSchedAppointmentResult {
  success: boolean;
  confirmationCode?: string;
  rawResponse?: unknown;
  message?: string;
  source: 'live' | 'demo';
}

const onschedApiKey = import.meta.env.VITE_ONSCHED_API_KEY?.trim();
const baseUrl = (import.meta.env.VITE_ONSCHED_BASE_URL?.trim() || 'https://api.onsched.com/v2').replace(/\/$/, '');
const locationId = import.meta.env.VITE_ONSCHED_LOCATION_ID?.trim();
const serviceId = import.meta.env.VITE_ONSCHED_SERVICE_ID?.trim();
const providerId = import.meta.env.VITE_ONSCHED_PROVIDER_ID?.trim();

const mockSlots: OnSchedTimeSlot[] = [
  {
    id: 'demo-slot-1',
    start: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    end: new Date(Date.now() + 1000 * 60 * 60 * 25).toISOString(),
    serviceName: 'Parkinson\'s Medication Review',
    providerName: 'Dr. N. Carter',
    locationName: 'Virtual Clinic',
    source: 'demo',
  },
  {
    id: 'demo-slot-2',
    start: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    end: new Date(Date.now() + 1000 * 60 * 60 * 49).toISOString(),
    serviceName: 'Physiotherapy Coaching',
    providerName: 'Alex Kim, PT',
    locationName: 'Virtual Clinic',
    source: 'demo',
  },
  {
    id: 'demo-slot-3',
    start: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
    end: new Date(Date.now() + 1000 * 60 * 60 * 73).toISOString(),
    serviceName: 'Care Partner Consult',
    providerName: 'Jamie Singh, RN',
    locationName: 'Virtual Clinic',
    source: 'demo',
  },
];

const authHeaders = () => {
  if (!onschedApiKey) {
    return undefined;
  }

  return {
    'Content-Type': 'application/json',
    'x-api-key': onschedApiKey,
    Authorization: `Bearer ${onschedApiKey}`,
  } as Record<string, string>;
};

const buildAvailabilityUrl = () => {
  const url = new URL(`${baseUrl}/availability`);
  if (locationId) url.searchParams.append('locationId', locationId);
  if (serviceId) url.searchParams.append('serviceId', serviceId);
  if (providerId) url.searchParams.append('providerId', providerId);
  url.searchParams.append('pageSize', '12');
  url.searchParams.append('from', new Date().toISOString());
  return url.toString();
};

export const fetchOnSchedAvailability = async (): Promise<{ slots: OnSchedTimeSlot[]; source: 'live' | 'demo' }> => {
  if (!onschedApiKey) {
    return { slots: mockSlots, source: 'demo' };
  }

  try {
    const url = buildAvailabilityUrl();
    const response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to load availability (${response.status}): ${body}`);
    }

    const data = await response.json();
    const slots: OnSchedTimeSlot[] = Array.isArray(data?.availability ?? data?.data ?? data)
      ? (data.availability ?? data.data ?? data).map((slot: any) => ({
          id: slot.id ?? slot.slotId ?? crypto.randomUUID(),
          start: slot.start ?? slot.startTime ?? slot.startDate,
          end: slot.end ?? slot.endTime ?? slot.endDate,
          serviceName: slot.serviceName ?? slot.service?.name,
          providerName: slot.providerName ?? slot.provider?.name,
          locationName: slot.locationName ?? slot.location?.name,
          source: 'live' as const,
        }))
      : mockSlots;

    return { slots, source: 'live' };
  } catch (error) {
    console.error('[OnSched] availability error:', error);
    return { slots: mockSlots, source: 'demo' };
  }
};

export const createOnSchedAppointment = async (
  payload: CreateOnSchedAppointmentInput
): Promise<CreateOnSchedAppointmentResult> => {
  if (!onschedApiKey) {
    return {
      success: true,
      confirmationCode: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      message: 'Demo mode: appointment request logged locally.',
      source: 'demo',
    };
  }

  const url = `${baseUrl}/bookings`;

  try {
    const { slotId, firstName, lastName, email, phone, notes } = payload;

    const requestBody = {
      slotId,
      customer: {
        firstName,
        lastName,
        email,
        phone,
      },
      locationId: locationId || undefined,
      serviceId: serviceId || undefined,
      providerId: providerId || undefined,
      notes,
      // Attempt to attach MongoDB authenticated user metadata if available
      metadata: await buildMetadata(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create booking (${response.status}): ${body}`);
    }

    const data = await response.json();

    return {
      success: true,
      confirmationCode: data?.confirmationCode ?? data?.id ?? data?.bookingId,
      rawResponse: data,
      source: 'live',
    };
  } catch (error: any) {
    console.error('[OnSched] booking error:', error);
    return {
      success: false,
      message: error?.message ?? 'Unknown error creating appointment.',
      rawResponse: error,
      source: 'live',
    };
  }
};

const buildMetadata = async () => {
  try {
    const { data: { session } } = await mongodb.auth.getSession();
    if (!session?.user) return undefined;

    const { user } = session;
    return {
      mongodbUserId: user.id,
      email: user.email,
      fullName: user.user_metadata?.full_name || `${user.user_metadata?.first_name ?? ''} ${user.user_metadata?.last_name ?? ''}`.trim(),
    };
  } catch (error) {
    console.warn('[OnSched] unable to attach MongoDB session metadata', error);
    return undefined;
  }
};
