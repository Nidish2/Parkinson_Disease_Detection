// API calls handled via direct backend URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Type definitions for voice model (CNN-based backend)
export type VoiceClass = "Parkinsons" | "Healthy";

export interface VoiceModelMetadata {
  name?: string;
  accuracy?: number | null;
  sampleCount?: number;
  features?: string[];
  featureKeys?: string[];
  expectedFeatureCount?: number;
  liveFeatureCount?: number;
  modelFile?: string;
  scalerFile?: string;
  usesBackend?: boolean;
  decisionThreshold?: number;
  scalerType?: string;
  usesSmote?: boolean;
  usesCalibration?: boolean;
  k?: number;
}

export interface VoiceFeatureVector {
  [key: string]: number;
}

export interface VoiceFeatureCoverage {
  provided: number;
  expected: number;
  filledFromDataset: number;
  providedFeatureNames?: string[];
  outOfDistributionFeatures?: string[];
}

export interface VoicePrediction {
  label: VoiceClass;
  probabilityOfParkinsons: number;
  neighbourVotes?: Array<{ label: VoiceClass; distance: number }>;
  k?: number;
  probabilities?: Record<VoiceClass, number>;
  warnings?: string[];
  featureCoverage?: VoiceFeatureCoverage;
  modelInfo?: Partial<VoiceModelMetadata>;
}

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

interface VoiceModelInfoResponse {
  modelInfo: VoiceModelMetadata;
}

interface VoicePredictionResponse {
  label: VoicePrediction["label"];
  probabilityOfParkinsons: number;
  probabilities?: VoicePrediction["probabilities"];
  k: number;
  warnings?: string[];
  featureCoverage?: VoicePrediction["featureCoverage"];
  modelInfo?: VoicePrediction["modelInfo"];
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Voice backend request failed with status ${response.status}.`,
    );
  }
  return payload as T;
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
  formData.append("audio", audioBlob, "voice-sample.webm");
  formData.append("features", JSON.stringify(features));

  const response = await fetch(`${API_BASE_URL}/api/voice/predict`, {
    method: "POST",
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

/**
 * Predicts Parkinson's disease from raw audio blob using the backend CNN model.
 */
export async function predictFromAudioBlob(
  audioBlob: Blob,
  token?: string | null,
  fileName?: string
): Promise<AudioPredictionResponse> {
  const formData = new FormData();
  // Provide a filename with extension
  formData.append('audio', audioBlob, fileName || 'recording.webm');

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
