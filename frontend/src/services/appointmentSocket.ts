import { io, type Socket } from 'socket.io-client';
import { mongodb } from '../lib/mongodbClient';
import type { ChatMessageRecord } from '../types/healthcare';

const SOCKET_URL = typeof window !== 'undefined'
  ? window.location.origin
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000');
const SOCKET_UNAVAILABLE_KEY = 'appointment_socket_unavailable';

let appointmentSocket: Socket | null = null;

export const isRealtimeSocketUnavailable = () => {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(SOCKET_UNAVAILABLE_KEY) === 'true';
};

export const markRealtimeSocketUnavailable = () => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(SOCKET_UNAVAILABLE_KEY, 'true');
  }
  if (appointmentSocket) {
    appointmentSocket.disconnect();
    appointmentSocket = null;
  }
};

export const getAppointmentSocket = () => {
  if (isRealtimeSocketUnavailable()) {
    return null;
  }

  const token = mongodb.getToken();

  if (!appointmentSocket) {
    appointmentSocket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      autoConnect: false,
      reconnection: false,
      reconnectionDelay: 1000,
      path: '/socket.io',
      timeout: 2500,
      auth: {
        token,
      },
    });

    appointmentSocket.on('connect_error', () => {
      markRealtimeSocketUnavailable();
    });
  } else {
    appointmentSocket.auth = {
      token,
    };
  }

  return appointmentSocket;
};

export const connectAppointmentSocket = () => {
  const socket = getAppointmentSocket();
  if (!socket) {
    return null;
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

export const disconnectAppointmentSocket = () => {
  if (appointmentSocket?.connected) {
    appointmentSocket.disconnect();
  }
};

export const joinAppointmentRoom = (appointmentId: string) => {
  const socket = connectAppointmentSocket();
  socket?.emit('join_appointment', { appointmentId });
  return socket;
};

export const leaveAppointmentRoom = (appointmentId: string) => {
  appointmentSocket?.emit('leave_appointment', { appointmentId });
};

export const sendRealtimeAppointmentMessage = (appointmentId: string, message: string) => {
  const socket = connectAppointmentSocket();
  if (!socket) {
    return Promise.reject(new Error('Realtime chat unavailable'));
  }
  return new Promise<ChatMessageRecord>((resolve, reject) => {
    socket.emit(
      'send_appointment_message',
      { appointmentId, message },
      (response: { ok?: boolean; data?: ChatMessageRecord; error?: string }) => {
        if (response?.ok && response.data) {
          resolve(response.data);
          return;
        }
        reject(new Error(response?.error || 'Unable to send message'));
      },
    );
  });
};
