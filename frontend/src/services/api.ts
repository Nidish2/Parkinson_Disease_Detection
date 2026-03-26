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
const openRouterApiKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();
const openRouterModel = import.meta.env.VITE_OPENROUTER_MODEL?.trim() || 'google/gemini-2.0-flash-exp:free';
const openRouterFallbackModel = import.meta.env.VITE_OPENROUTER_FALLBACK_MODEL?.trim();
const customSystemPrompt = import.meta.env.VITE_OPENROUTER_SYSTEM_PROMPT?.trim();
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

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
 * Sends a message to the AI assistant backend.
 * @param messages - The history of the conversation.
 */
export const postChatMessage = async (messages: ChatMessage[], options: ChatOptions = {}) => {
  if (openRouterApiKey) {
    try {
      const referer = import.meta.env.VITE_APP_URL?.trim() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');
      const conversation = messages.map((message) => ({
        role: message.from === 'user' ? 'user' : 'assistant',
        content: message.text,
      }));

      const systemPromptBase = customSystemPrompt || 'You are an empathetic medical assistant helping people living with Parkinson\'s disease. Provide concise, supportive answers, include practical next steps, and remind users to seek professional medical advice for diagnosis or treatment decisions.';
      const systemPrompt = options.systemInstruction
        ? `${systemPromptBase} ${options.systemInstruction}`.trim()
        : systemPromptBase;
      const sharedPayload = {
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversation,
        ],
        stream: false,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
      } satisfies Record<string, unknown>;

      const modelsToTry = [openRouterModel, openRouterFallbackModel]
        .filter((model): model is string => Boolean(model))
        .filter((model, index, array) => array.indexOf(model) === index);

      let lastErrorStatus: number | undefined;
      let lastErrorBody: string | undefined;

      for (const model of modelsToTry) {
        const response = await fetch(OPENROUTER_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openRouterApiKey}`,
            'HTTP-Referer': referer,
            'X-Title': 'Parkinson\'s Care Assistant',
          },
          body: JSON.stringify({ ...sharedPayload, model }),
        });

        const rawBody = await response.text();
        let parsedBody: any;
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
        } catch (parseError) {
          parsedBody = undefined;
        }

        if (response.ok && parsedBody) {
          if (model !== openRouterModel) {
            const firstChoice = parsedBody?.choices?.[0]?.message;
            if (firstChoice?.content && typeof firstChoice.content === 'string') {
              firstChoice.content += `\n\n_(Responded using fallback model ${model} after ${openRouterModel} was unavailable.)_`;
            }
          }
          return parsedBody;
        }

        lastErrorStatus = response.status;
        lastErrorBody = rawBody || parsedBody?.error?.message;

        const shouldRetry = response.status === 429 || response.status === 503 || response.status === 500;
        if (!shouldRetry) {
          break;
        }
      }

      if (lastErrorStatus === 429) {
        const detail = lastErrorBody ? `\n\nDetails: ${lastErrorBody}` : '';
        return {
          choices: [
            {
              message: {
                content: `OpenRouter is temporarily rate-limited. Please wait a few seconds and try again, or add your own API key at https://openrouter.ai/settings/integrations to get dedicated quota.${detail}`,
              },
            },
          ],
        };
      }

      throw new Error(`OpenRouter request failed (${lastErrorStatus ?? 'network error'}): ${lastErrorBody ?? 'No error body returned.'}`);
    } catch (error) {
      console.error('Error communicating with OpenRouter:', error);
      throw new Error('Could not reach OpenRouter. Check your API key, model name, and network connection.');
    }
  }

  if (!isRealBackendEnabled) {
    console.log('DEMO MODE: Simulating chatbot response.');
    const tone = options.systemInstruction ? ` (${options.systemInstruction})` : '';
    const demoResponse = {
      choices: [{
        message: {
          content: `The AI Assistant is currently in demo mode as the backend is not connected${tone}. To enable live responses, please start your backend server and set VITE_ENABLE_REAL_BACKEND to true in your .env file.`,
        },
      }],
    };
    return Promise.resolve(demoResponse);
  }

  try {
    const response = await apiClient.post('/chat', { messages, options });
    return response.data;
  } catch (error) {
    console.error('Error communicating with chatbot API:', error);
    throw new Error('Could not get a response from the assistant. Is your backend server running?');
  }
}
