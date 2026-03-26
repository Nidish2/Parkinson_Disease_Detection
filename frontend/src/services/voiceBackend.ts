import type { VoiceFeatureVector, VoiceModelMetadata, VoicePrediction } from './voiceKnnModel';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `Voice backend request failed with status ${response.status}.`,
    );
  }
  return payload as T;
}

interface VoiceModelInfoResponse {
  modelInfo: VoiceModelMetadata;
}

interface VoicePredictionResponse {
  label: VoicePrediction['label'];
  probabilityOfParkinsons: number;
  probabilities?: VoicePrediction['probabilities'];
  k: number;
  warnings?: string[];
  featureCoverage?: VoicePrediction['featureCoverage'];
  modelInfo?: VoicePrediction['modelInfo'];
}

export async function fetchVoiceModelMetadata(): Promise<VoiceModelMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/voice/model-info`);
  const payload = await parseApiResponse<VoiceModelInfoResponse>(response);
  return payload.modelInfo;
}

export async function predictVoiceWithBackend(
  audioBlob: Blob,
  features: VoiceFeatureVector,
): Promise<VoicePrediction> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice-sample.webm');
  formData.append('features', JSON.stringify(features));

  const response = await fetch(`${API_BASE_URL}/api/voice/predict`, {
    method: 'POST',
    body: formData,
  });
  const payload = await parseApiResponse<VoicePredictionResponse>(response);

  return {
    label: payload.label,
    probabilityOfParkinsons: payload.probabilityOfParkinsons,
    probabilities: payload.probabilities,
    neighbourVotes: [],
    k: payload.k,
    warnings: payload.warnings ?? [],
    featureCoverage: payload.featureCoverage,
    modelInfo: payload.modelInfo,
  };
}
