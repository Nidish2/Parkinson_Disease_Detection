import axios, { AxiosError } from 'axios';
import { mongodb } from '../lib/mongodbClient';

const apiClient = axios.create({
  baseURL: '/api', // This will be proxied by Vite to your backend
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the MongoDB auth token
apiClient.interceptors.request.use(async (config) => {
  const token = mongodb.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

const isRealBackendEnabled = import.meta.env.VITE_ENABLE_REAL_BACKEND === 'true';

type ChatMessage = { from: string; text: string };

interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  systemInstruction?: string;
}

/**
 * Triggers the backend to process a newly uploaded test file.
 * @param testId - The ID of the test record in the database.
 */
export const processTest = async (testId: string) => {
  if (!isRealBackendEnabled) {
    console.log('DEMO MODE: Simulating test processing trigger for test ID:', testId);
    return Promise.resolve({ message: 'Processing triggered in demo mode.' });
  }

  try {
    const response = await apiClient.post('/process-test', { testId });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    const underlyingCause =
      (typeof axiosError.cause === 'object' && axiosError.cause && 'message' in axiosError.cause)
        ? String((axiosError.cause as { message?: unknown }).message ?? '')
        : '';
    const connectionRefused =
      axiosError.code === 'ECONNREFUSED' ||
      axiosError.message?.includes('ECONNREFUSED') ||
      underlyingCause.includes('ECONNREFUSED');

    if (connectionRefused) {
      console.warn('Backend unavailable (ECONNREFUSED); test uploads will save metadata but skip cloud inference for test ID:', testId);
      return { message: 'Backend offline; local screening only.' };
    }

    // Handle 500 errors specifically
    if (axiosError.response?.status === 500) {
      console.error('Backend returned 500 error. This usually means the backend is running but has internal issues (database connection, etc.):', axiosError.response.data);
      return { message: 'Backend error; test saved with local screening results.' };
    }

    console.error('Error triggering test processing:', error);
    console.warn('Test will be saved without backend processing. You can re-run analysis when the backend is available.');
    return { message: 'Backend error; test saved for manual processing.' };
  }
};

/**
 * Sends chat to the Flask backend, which calls Google Gemini (key stays on the server).
 * @param messages - The history of the conversation.
 */
export const postChatMessage = async (messages: ChatMessage[], options: ChatOptions = {}) => {
  try {
    const response = await apiClient.post<{ choices?: { message?: { content?: string } }[] }>(
      '/chat',
      { messages, options },
    );
    return response.data;
  } catch (error) {
    const ax = error as AxiosError<{ error?: string }>;
    const fromBody =
      (typeof ax.response?.data === 'object' && ax.response?.data && 'error' in ax.response.data
        ? (ax.response.data as { error?: string }).error
        : undefined) || (ax.response?.data as { message?: string } | undefined)?.message;
    const msg =
      fromBody ||
      (ax.code === 'ECONNREFUSED' || ax.message?.includes('Network Error')
        ? 'Cannot reach the backend. Start the Flask server (port 5000) and ensure the Vite proxy is enabled.'
        : undefined) ||
      ax.message;
    console.error('Chat API error:', error);
    throw new Error(msg || 'Could not get a response from the assistant.');
  }
}

// Export apiClient as default for direct API calls
export default apiClient;
