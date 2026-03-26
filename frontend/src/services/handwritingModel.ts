import type { HandwritingClass, HandwritingType } from '../types/database';

let tensorflowInstance: typeof import('@tensorflow/tfjs') | null = null;
let mobilenetModel: any = null;

async function loadTensorflow() {
  if (!tensorflowInstance) {
    console.log('[TF] Loading TensorFlow.js...');
    tensorflowInstance = await import('@tensorflow/tfjs');
    await tensorflowInstance.ready();
    console.log('[TF] Backend:', tensorflowInstance.getBackend());
  }
  return tensorflowInstance;
}

async function loadMobileNet() {
  if (!mobilenetModel) {
    console.log('[MobileNet] Loading pre-trained MobileNetV2...');
    const tf = await loadTensorflow();
    
    // Load MobileNetV2 from TensorFlow.js Hub
    const mobilenet = await import('@tensorflow-models/mobilenet');
    mobilenetModel = await mobilenet.load({
      version: 2,
      alpha: 1.0,
    });
    console.log('[MobileNet] ✓ Loaded successfully');
  }
  return mobilenetModel;
}

function normaliseLabel(output: Float32Array): {
  label: HandwritingClass;
  confidence: number;
  probabilities: Record<HandwritingClass, number>;
} {
  const sigmoidValue = output[0] ?? 0.5;
  const healthyScore = sigmoidValue;
  const parkinsonsScore = 1 - sigmoidValue;
  const label: HandwritingClass = parkinsonsScore > healthyScore ? 'Parkinsons' : 'Healthy';
  const confidence = Math.max(parkinsonsScore, healthyScore);

  return {
    label,
    confidence,
    probabilities: {
      Parkinsons: parkinsonsScore,
      Healthy: healthyScore,
    },
  };
}

function preprocessImage(
  tf: typeof import('@tensorflow/tfjs'),
  img: HTMLImageElement
): import('@tensorflow/tfjs').Tensor3D {
  console.log('[preprocess] Input image:', img.width, 'x', img.height);
  
  let tensor = tf.browser.fromPixels(img);
  console.log('[preprocess] Tensor shape:', tensor.shape);
  
  // Resize to 224x224
  tensor = tf.image.resizeBilinear(tensor, [224, 224]);
  console.log('[preprocess] Resized:', tensor.shape);
  
  // Normalize to [-1, 1] for MobileNetV2
  tensor = tensor.div(127.5).sub(1.0);
  console.log('[preprocess] Normalized to [-1, 1]');
  
  return tensor as import('@tensorflow/tfjs').Tensor3D;
}

// Simple heuristic-based prediction for now
function analyzeSpiral(features: number[]): {
  label: HandwritingClass;
  confidence: number;
} {
  // For now, use a simple threshold on feature variance
  // This is a placeholder until we can properly load the trained model
  const variance = features.reduce((sum, val) => sum + Math.abs(val), 0) / features.length;
  
  // Higher variance in MobileNet features tends to indicate more tremor/irregularity
  const parkinsonsScore = Math.min(Math.max((variance - 0.3) / 0.4, 0), 1);
  const healthyScore = 1 - parkinsonsScore;
  
  return {
    label: parkinsonsScore > healthyScore ? 'Parkinsons' : 'Healthy',
    confidence: Math.max(parkinsonsScore, healthyScore),
  };
}

export async function predictHandwriting(
  img: HTMLImageElement,
  type?: HandwritingType | null
): Promise<{
  label: HandwritingClass;
  confidence: number;
  probabilities: Record<HandwritingClass, number>;
  modelInfo: {
    name: string;
    inputShape: number[];
  };
}> {
  console.log(`[PREDICT] Starting prediction for: ${type || 'auto-detect'}`);
  
  try {
    // Convert image to blob
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Could not convert canvas to blob'));
      }, 'image/png');
    });
    
    console.log('[PREDICT] Sending to backend API...');
    
    // Send to backend with image type (if specified)
    const formData = new FormData();
    formData.append('image', blob, `${type || 'unknown'}.png`);
    if (type) {
      formData.append('type', type);  // Send type if known, otherwise backend auto-detects
      console.log(`[PREDICT] Using model type: ${type}`);
    } else {
      console.log('[PREDICT] Type not specified - backend will auto-detect');
    }
    
    const response = await fetch('http://localhost:5000/predict', {
      method: 'POST',
      body: formData,
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      // Handle validation errors specially
      if (result.validation_failed) {
        throw new Error(result.error || 'Image validation failed');
      }
      throw new Error(result.error || `Backend API error: ${response.statusText}`);
    }
    
    console.log('[PREDICT] Backend result:', result);
    
    return {
      label: result.label,
      confidence: result.confidence,
      probabilities: result.probabilities,
      modelInfo: result.modelInfo,
    };
  } catch (error: any) {
    console.error('[PREDICT] Error:', error);
    // Preserve the original error message for validation errors
    throw new Error(error.message || 'Prediction failed');
  }
}

export function isHandwritingModelLoaded(type: HandwritingType): boolean {
  return mobilenetModel !== null;
}

export async function preloadHandwritingModel(type: HandwritingType = 'spiral'): Promise<void> {
  console.log(`[preload] Preloading ${type} model...`);
  await loadMobileNet();
  console.log(`[preload] ${type} model ready`);
}
