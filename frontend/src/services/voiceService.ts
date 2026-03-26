// API calls handled via direct backend URL

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
export interface AudioPredictionResponse {
  label: 'Healthy' | 'Parkinsons';
  probabilityOfParkinsons: number;
  confidence: number;
  predictions: {
    Parkinsons: number;
    Healthy: number;
  };
  modelInfo: {
    name: string;
    dataset: string;
    ready: boolean;
    metadata?: any;
  };
  warnings?: string[];
}

/**
 * Predicts Parkinson's disease from raw audio blob using the backend CNN model.
 */
export async function predictFromAudioBlob(
  audioBlob: Blob,
  token?: string | null
): Promise<AudioPredictionResponse> {
  const formData = new FormData();
  // Provide a filename with extension
  formData.append('audio', audioBlob, 'recording.wav');

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}/api/voice/predict-audio`, {
    method: 'POST',
    headers, // Do NOT set Content-Type header manually for FormData
    body: formData,
  });

  if (!res.ok) {
    let errorMsg = 'Failed to analyze audio';
    try {
      const errorData = await res.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch (e) {
      // Ignored
    }
    throw new Error(errorMsg);
  }

  return await res.json();
}
