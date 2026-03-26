/**
 * Model Information Configuration
 * Update these values when models are retrained
 */

export const MODEL_INFO = {
  spiral: {
    name: 'MobileNetV2',
    accuracy: '85.00%', // Update after training - trained with 216 images
    description: 'MobileNetV2 fine-tuned model trained on combined spiral datasets',
  },
  wave: {
    name: 'InceptionV3',
    accuracy: '90.00%',
    description: 'InceptionV3 model for wave pattern detection',
  },
} as const;

export function getModelAccuracy(type: 'spiral' | 'wave'): string {
  return MODEL_INFO[type].accuracy;
}

export function getModelName(type: 'spiral' | 'wave'): string {
  return MODEL_INFO[type].name;
}

export function getModelDisplay(type: 'spiral' | 'wave'): string {
  return `${MODEL_INFO[type].name} (${MODEL_INFO[type].accuracy})`;
}

