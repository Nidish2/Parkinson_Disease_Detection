export interface VoicePrediction {
  label: 'Parkinsons' | 'Healthy';
  confidence: number;
  reasoning: string;
  probabilities: {
    Parkinsons: number;
    Healthy: number;
  };
  raw_output: number;
  modelInfo: {
    name: string;
    type: string;
    inputShape: number[];
  };
  assessment?: {
    status: 'high_risk' | 'borderline' | 'healthy_range';
    threshold: number;
    borderlineMargin: number;
    sigmoidPositiveClass: 'parkinsons' | 'healthy';
  };
  summary?: string;
  modelUsed?: string;
}

export async function predictVoice(audioBlob: Blob): Promise<VoicePrediction> {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'voice.wav');

    const response = await fetch('http://localhost:5000/api/voice/predict', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Voice prediction failed');
    }

    const result = await response.json();

    // Format response to match VoicePrediction interface
    return {
      label: result.label,
      confidence: result.confidence,
      reasoning: result.reasoning,
      probabilities: result.probabilities,
      raw_output: result.raw_output,
      modelInfo: result.modelInfo,
      assessment: result.assessment,
      summary: result.reasoning,
      modelUsed: 'voice',
    };
  } catch (error) {
    console.error('Voice prediction error:', error);
    throw error;
  }
}
