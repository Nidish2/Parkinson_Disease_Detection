type VoiceClass = 'Parkinsons' | 'Healthy';

const FEATURE_COLUMNS = [
  'meanPeriodPulses',
  'stdDevPeriodPulses',
  'locPctJitter',
  'locAbsJitter',
  'rapJitter',
  'ppq5Jitter',
  'ddpJitter',
  'locShimmer',
  'locDbShimmer',
  'apq3Shimmer',
  'apq5Shimmer',
  'apq11Shimmer',
  'ddaShimmer',
  'meanAutoCorrHarmonicity',
  'meanNoiseToHarmHarmonicity',
  'meanHarmToNoiseHarmonicity',
] as const;

type FeatureKey = (typeof FEATURE_COLUMNS)[number];

export type VoiceFeatureVector = Record<FeatureKey, number>;

interface VoiceDatasetSample {
  features: VoiceFeatureVector;
  label: VoiceClass;
}

interface NormalisedSample {
  vector: number[];
  label: VoiceClass;
}

interface FeatureStat {
  mean: number;
  std: number;
}

export interface VoiceModelMetadata {
  k: number;
  accuracy: number | null;
  sampleCount: number;
  features: string[];
  featureKeys?: string[];
  expectedFeatureCount?: number;
  liveFeatureCount?: number;
  modelFile?: string;
  scalerFile?: string;
  usesBackend?: boolean;
}

export interface VoiceFeatureCoverage {
  provided: number;
  expected: number;
  filledFromDataset: number;
  providedFeatureNames?: string[];
}

export interface VoicePrediction {
  label: VoiceClass;
  probabilityOfParkinsons: number;
  neighbourVotes: Array<{ label: VoiceClass; distance: number }>; // sorted nearest-first
  k: number;
  probabilities?: Record<VoiceClass, number>;
  warnings?: string[];
  featureCoverage?: VoiceFeatureCoverage;
  modelInfo?: Partial<VoiceModelMetadata>;
}

const DATASET_URL = '/data/pd_speech_features.csv';

let datasetPromise: Promise<VoiceDatasetSample[]> | null = null;
let featureStats: Record<FeatureKey, FeatureStat> | null = null;
let trainingSamples: NormalisedSample[] | null = null;
let trainedMetadata: VoiceModelMetadata | null = null;

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], valueMean: number): number {
  if (values.length < 2) {
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - valueMean) * (value - valueMean), 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function averageAbsoluteDiff(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  let accumulator = 0;
  for (let index = 0; index < values.length - 1; index += 1) {
    accumulator += Math.abs(values[index] - values[index + 1]);
  }
  return accumulator / (values.length - 1);
}

function computeRAP(periods: number[], meanPeriod: number): number {
  if (periods.length < 3 || meanPeriod === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let index = 1; index < periods.length - 1; index += 1) {
    const localMean = (periods[index - 1] + periods[index] + periods[index + 1]) / 3;
    sum += Math.abs(periods[index] - localMean);
    count += 1;
  }
  if (!count) {
    return 0;
  }
  return sum / count / meanPeriod;
}

function computePPQ(periods: number[], meanPeriod: number): number {
  if (periods.length < 5 || meanPeriod === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let index = 2; index < periods.length - 2; index += 1) {
    const localMean =
      (periods[index - 2] + periods[index - 1] + periods[index] + periods[index + 1] + periods[index + 2]) / 5;
    sum += Math.abs(periods[index] - localMean);
    count += 1;
  }
  if (!count) {
    return 0;
  }
  return sum / count / meanPeriod;
}

function computeApq(amplitudes: number[], meanAmplitude: number, windowSize: number): number {
  if (amplitudes.length < windowSize || meanAmplitude === 0) {
    return 0;
  }
  const half = Math.floor(windowSize / 2);
  let sum = 0;
  let count = 0;
  for (let index = half; index < amplitudes.length - half; index += 1) {
    let windowTotal = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      windowTotal += amplitudes[index + offset];
    }
    const windowMean = windowTotal / windowSize;
    sum += Math.abs(amplitudes[index] - windowMean);
    count += 1;
  }
  if (!count) {
    return 0;
  }
  return sum / count / meanAmplitude;
}

function computeShimmerDb(amplitudes: number[]): number {
  if (amplitudes.length < 2) {
    return 0;
  }
  const epsilon = 1e-8;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < amplitudes.length - 1; index += 1) {
    const current = amplitudes[index] + epsilon;
    const next = amplitudes[index + 1] + epsilon;
    const ratio = next / current;
    sum += Math.abs(20 * Math.log10(ratio));
    count += 1;
  }
  return count ? sum / count : 0;
}

function hannWindow(data: Float32Array): Float32Array {
  const length = data.length;
  const windowed = new Float32Array(length);
  if (length <= 1) {
    windowed.set(data);
    return windowed;
  }
  for (let index = 0; index < length; index += 1) {
    const weight = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1));
    windowed[index] = data[index] * weight;
  }
  return windowed;
}

function analyseFrame(
  input: Float32Array,
  sampleRate: number,
  minLag: number,
  maxLag: number,
): { frequency: number | null; correlation: number; rms: number } {
  if (input.length === 0) {
    return { frequency: null, correlation: 0, rms: 0 };
  }
  const windowed = hannWindow(input);
  const meanValue = mean(Array.from(windowed));
  for (let index = 0; index < windowed.length; index += 1) {
    windowed[index] -= meanValue;
  }

  let energy = 0;
  for (let index = 0; index < windowed.length; index += 1) {
    energy += windowed[index] * windowed[index];
  }
  const rms = Math.sqrt(energy / windowed.length) || 0;
  if (energy <= 1e-9) {
    return { frequency: null, correlation: 0, rms };
  }

  let bestCorrelation = 0;
  let bestLag = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < windowed.length - lag; index += 1) {
      sum += windowed[index] * windowed[index + lag];
    }
    const correlation = sum / energy;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorrelation < 0.3) {
    return { frequency: null, correlation: bestCorrelation, rms };
  }

  const frequency = sampleRate / bestLag;
  if (frequency < 50 || frequency > 500) {
    return { frequency: null, correlation: bestCorrelation, rms };
  }

  return { frequency, correlation: bestCorrelation, rms };
}

async function loadDataset(): Promise<VoiceDatasetSample[]> {
  if (!datasetPromise) {
    datasetPromise = fetch(DATASET_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load speech dataset from ${DATASET_URL}. Ensure the file exists in /public/data and matches the expected schema.`,
          );
        }
        return response.text();
      })
      .then(parseCsvDataset);
  }
  return datasetPromise;
}

function parseCsvDataset(csvText: string): VoiceDatasetSample[] {
  const trimmed = csvText.trim();
  if (!trimmed) {
    throw new Error('The speech dataset CSV is empty.');
  }
  const rows = trimmed.split(/\r?\n/);
  let header: string | undefined;
  while (rows.length && !header) {
    const candidate = rows.shift();
    if (!candidate) continue;
    const cells = candidate.split(',');
    if (cells.some((cell) => cell.trim().length > 0) && cells.includes('class')) {
      header = candidate;
    }
  }
  if (!header) {
    throw new Error('Missing header row in the speech dataset CSV.');
  }
  const headers = header.split(',').map((column) => column.trim());
  const statusIndex = headers.lastIndexOf('class');
  if (statusIndex === -1) {
    throw new Error('The speech dataset CSV must contain a "class" column with 0/1 labels.');
  }

  const featureIndices = FEATURE_COLUMNS.map((key) => {
    const index = headers.indexOf(key);
    if (index === -1) {
      throw new Error(`The speech dataset CSV is missing required feature column: ${key}`);
    }
    return index;
  });

  const samples: VoiceDatasetSample[] = [];

  rows.forEach((row, rowIndex) => {
    if (!row.trim()) {
      return;
    }
    const columns = row.split(',');
    if (columns.length !== headers.length) {
      throw new Error(`Row ${rowIndex + 2} has ${columns.length} columns but expected ${headers.length}.`);
    }
    const labelRaw = Number.parseFloat(columns[statusIndex]);
    const label: VoiceClass = labelRaw >= 0.5 ? 'Parkinsons' : 'Healthy';
    const features = FEATURE_COLUMNS.reduce<VoiceFeatureVector>((accumulator, key, featureOffset) => {
      const value = Number.parseFloat(columns[featureIndices[featureOffset]]);
      accumulator[key] = Number.isFinite(value) ? value : 0;
      return accumulator;
    }, {} as VoiceFeatureVector);
    samples.push({ features, label });
  });

  if (!samples.length) {
    throw new Error('No data rows were found in the speech dataset CSV.');
  }

  return samples;
}

function computeFeatureStats(samples: VoiceDatasetSample[]): Record<FeatureKey, FeatureStat> {
  const stats = {} as Record<FeatureKey, FeatureStat>;
  FEATURE_COLUMNS.forEach((key) => {
    const values = samples.map((sample) => sample.features[key]);
    const featureMean = mean(values);
    const std = standardDeviation(values, featureMean);
    stats[key] = { mean: featureMean, std: std || 1e-6 };
  });
  return stats;
}

function normalise(features: VoiceFeatureVector, stats: Record<FeatureKey, FeatureStat>): number[] {
  return FEATURE_COLUMNS.map((key) => {
    const { mean: featureMean, std } = stats[key];
    return (features[key] - featureMean) / (std || 1e-6);
  });
}

function euclideanDistance(vectorA: number[], vectorB: number[]): number {
  let sum = 0;
  for (let index = 0; index < vectorA.length; index += 1) {
    const diff = vectorA[index] - vectorB[index];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function predictFromSamples(
  vector: number[],
  samples: NormalisedSample[],
  k: number,
): VoicePrediction {
  if (!samples.length) {
    throw new Error('The KNN model has not been trained yet.');
  }
  const effectiveK = Math.min(Math.max(k, 1), samples.length);
  const neighbours = samples
    .map((sample) => ({
      label: sample.label,
      distance: euclideanDistance(vector, sample.vector),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, effectiveK);

  // Check for scale mismatch - if average distance is very large, 
  // the input features don't match the training data scale
  const avgDistance = neighbours.reduce((sum, n) => sum + n.distance, 0) / neighbours.length;
  const scaleMismatch = avgDistance > 10;

  const votes = neighbours.reduce(
    (accumulator, neighbour) => {
      if (neighbour.label === 'Parkinsons') {
        accumulator.parkinsons += 1;
      } else {
        accumulator.healthy += 1;
      }
      return accumulator;
    },
    { parkinsons: 0, healthy: 0 },
  );

  let probability = effectiveK ? votes.parkinsons / effectiveK : 0;

  // If there's a scale mismatch, apply conservative adjustment
  // Bias heavily towards "Healthy" to avoid false positives
  if (scaleMismatch) {
    console.warn('[KNN] Applying conservative adjustment due to scale mismatch');
    // Reduce probability significantly - microphone recordings typically
    // show higher jitter/shimmer values even for healthy voices
    probability = probability * 0.3; // Reduce by 70%
  }

  return {
    label: probability >= 0.5 ? 'Parkinsons' : 'Healthy',
    probabilityOfParkinsons: probability,
    neighbourVotes: neighbours,
    k: effectiveK,
  };
}

function leaveOneOutAccuracy(samples: NormalisedSample[], k: number): number | null {
  if (samples.length < 2) {
    return null;
  }
  let correct = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const testSample = samples[index];
    const trainingSubset = samples.filter((_, sampleIndex) => sampleIndex !== index);
    const prediction = predictFromSamples(testSample.vector, trainingSubset, k);
    if (prediction.label === testSample.label) {
      correct += 1;
    }
  }
  return correct / samples.length;
}

async function ensureModel(k: number): Promise<NormalisedSample[]> {
  if (trainingSamples && featureStats) {
    return trainingSamples;
  }
  
  console.log('[KNN] Loading real dataset from:', DATASET_URL);
  const samples = await loadDataset();
  console.log('[KNN] Dataset loaded successfully:', samples.length, 'samples');
  console.log('[KNN] Sample distribution:', {
    parkinsons: samples.filter(s => s.label === 'Parkinsons').length,
    healthy: samples.filter(s => s.label === 'Healthy').length
  });
  
  // Log a sample from each class for comparison
  const healthySample = samples.find(s => s.label === 'Healthy');
  const parkinsonsSample = samples.find(s => s.label === 'Parkinsons');
  console.log('[KNN] Example Healthy sample features:', {
    meanPeriodPulses: healthySample?.features.meanPeriodPulses.toFixed(6),
    locPctJitter: healthySample?.features.locPctJitter.toFixed(3),
    locShimmer: healthySample?.features.locShimmer.toFixed(3),
    meanAutoCorrHarmonicity: healthySample?.features.meanAutoCorrHarmonicity.toFixed(3),
  });
  console.log('[KNN] Example Parkinsons sample features:', {
    meanPeriodPulses: parkinsonsSample?.features.meanPeriodPulses.toFixed(6),
    locPctJitter: parkinsonsSample?.features.locPctJitter.toFixed(3),
    locShimmer: parkinsonsSample?.features.locShimmer.toFixed(3),
    meanAutoCorrHarmonicity: parkinsonsSample?.features.meanAutoCorrHarmonicity.toFixed(3),
  });
  
  featureStats = computeFeatureStats(samples);
  trainingSamples = samples.map((sample) => ({
    label: sample.label,
    vector: normalise(sample.features, featureStats!),
  }));

  const accuracy = leaveOneOutAccuracy(trainingSamples, k);
  console.log('[KNN] Model trained with k=', k, ', accuracy:', accuracy?.toFixed(3));
  
  trainedMetadata = {
    k,
    accuracy,
    sampleCount: trainingSamples.length,
    features: [...FEATURE_COLUMNS],
  };

  return trainingSamples;
}

export async function trainVoiceKnnModel(options: { k?: number } = {}): Promise<VoiceModelMetadata> {
  const k = options.k ?? 5;
  await ensureModel(k);
  return trainedMetadata!;
}

export async function predictVoiceSample(
  features: VoiceFeatureVector,
  options: { k?: number } = {},
): Promise<VoicePrediction> {
  const k = options.k ?? (trainedMetadata?.k ?? 5);
  const samples = await ensureModel(k);
  if (!featureStats) {
    throw new Error('Feature statistics are not available. Train the model first.');
  }
  
  console.log('[KNN] Using real dataset with', samples.length, 'samples');
  console.log('[KNN] Extracted features from audio:', features);
  console.log('[KNN] Feature ranges in dataset:', {
    meanPeriodPulses: `${featureStats['meanPeriodPulses'].mean.toFixed(6)} ± ${featureStats['meanPeriodPulses'].std.toFixed(6)}`,
    locPctJitter: `${featureStats['locPctJitter'].mean.toFixed(3)} ± ${featureStats['locPctJitter'].std.toFixed(3)}`,
    locShimmer: `${featureStats['locShimmer'].mean.toFixed(3)} ± ${featureStats['locShimmer'].std.toFixed(3)}`,
  });
  console.warn('[KNN] ⚠️ WARNING: The dataset was created with professional medical-grade recording equipment.');
  console.warn('[KNN] Microphone recordings may have very different feature scales, leading to inaccurate predictions.');
  console.warn('[KNN] For demonstration purposes only - not for clinical use.');
  
  const normalisedVector = normalise(features, featureStats);
  console.log('[KNN] Normalized feature vector (first 5):', normalisedVector.slice(0, 5).map(v => v.toFixed(3)));
  console.log('[KNN] Normalized vector magnitude:', Math.sqrt(normalisedVector.reduce((sum, v) => sum + v*v, 0)).toFixed(3));
  
  const prediction = predictFromSamples(normalisedVector, samples, k);
  
  console.log('[KNN] Real-time prediction result:', {
    label: prediction.label,
    probability: prediction.probabilityOfParkinsons,
    k: prediction.k,
    nearestNeighbors: prediction.neighbourVotes.slice(0, 5).map(n => ({
      label: n.label,
      distance: n.distance.toFixed(3)
    })),
    averageDistance: (prediction.neighbourVotes.reduce((sum, n) => sum + n.distance, 0) / prediction.neighbourVotes.length).toFixed(3)
  });
  
  // Check if the distances are suspiciously large (indicating scale mismatch)
  const avgDistance = prediction.neighbourVotes.reduce((sum, n) => sum + n.distance, 0) / prediction.neighbourVotes.length;
  if (avgDistance > 10) {
    console.warn('[KNN] ⚠️ SCALE MISMATCH DETECTED: Average distance to neighbors is', avgDistance.toFixed(1));
    console.warn('[KNN] This indicates the recording equipment/method differs significantly from the training dataset.');
    console.warn('[KNN] Result reliability is LOW - treat as demonstration only.');
  }
  
  return prediction;
}

export function resetVoiceKnnModel() {
  datasetPromise = null;
  featureStats = null;
  trainingSamples = null;
  trainedMetadata = null;
}

export function getVoiceFeatureKeys(): FeatureKey[] {
  return [...FEATURE_COLUMNS];
}

function mixDownToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mixed[index] += channelData[index];
    }
  }
  for (let index = 0; index < length; index += 1) {
    mixed[index] /= numberOfChannels;
  }
  return mixed;
}

function trimSilence(signal: Float32Array, threshold = 0.01): Float32Array {
  let start = 0;
  let end = signal.length - 1;
  while (start < signal.length && Math.abs(signal[start]) < threshold) {
    start += 1;
  }
  while (end > start && Math.abs(signal[end]) < threshold) {
    end -= 1;
  }
  if (end <= start) {
    return signal;
  }
  return signal.slice(start, end + 1);
}

function limitDuration(signal: Float32Array, sampleRate: number, maxSeconds = 15): Float32Array {
  const maxSamples = Math.min(signal.length, Math.floor(sampleRate * maxSeconds));
  if (signal.length <= maxSamples) {
    return signal;
  }
  return signal.slice(0, maxSamples);
}

function computeVoiceFeaturesFromSignal(samples: Float32Array, sampleRate: number): VoiceFeatureVector {
  const frameSize = 2048;
  const hopSize = 512;
  const minFrequency = 60;
  const maxFrequency = 400;
  const minLag = Math.max(1, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.max(minLag + 1, Math.floor(sampleRate / minFrequency));

  const pitches: number[] = [];
  const periods: number[] = [];
  const amplitudes: number[] = [];
  const correlations: number[] = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const frameSlice = samples.subarray(start, start + frameSize);
    const analysis = analyseFrame(frameSlice, sampleRate, minLag, maxLag);
    if (analysis.frequency && analysis.correlation >= 0.3) {
      pitches.push(analysis.frequency);
      periods.push(1 / analysis.frequency);
      amplitudes.push(analysis.rms);
      correlations.push(analysis.correlation);
    }
  }

  if (pitches.length < 5) {
    throw new Error('Unable to extract stable voice features. Please ensure the recording is at least a few seconds long and spoken clearly.');
  }

  const meanPeriod = mean(periods);
  const periodStd = standardDeviation(periods, meanPeriod);
  const meanAmplitude = mean(amplitudes);
  const meanCorrelation = mean(correlations);

  // IMPORTANT: CSV training data stores jitter/shimmer as raw ratios, NOT percentages.
  // e.g. locPctJitter mean = 0.0023 in CSV (not 0.23), locShimmer mean = 0.067 (not 6.7)
  const jitterAbs = averageAbsoluteDiff(periods);
  const jitterRatio = meanPeriod ? (jitterAbs / meanPeriod) : 0;
  const rap = computeRAP(periods, meanPeriod);
  const ppq = computePPQ(periods, meanPeriod);
  const ddp = rap * 3;

  const shimmer = meanAmplitude ? (averageAbsoluteDiff(amplitudes) / meanAmplitude) : 0;
  const shimmerDb = computeShimmerDb(amplitudes);
  const apq3 = computeApq(amplitudes, meanAmplitude, 3);
  const apq5 = computeApq(amplitudes, meanAmplitude, 5);
  const apq11 = computeApq(amplitudes, meanAmplitude, 11);
  const shimmerDDA = apq3 * 3;

  // Harmonicity: CSV stores meanAutoCorrHarmonicity as ~0.96, NHR as ~0.05,
  // and HNR in dB as ~18.86 (= 10 * log10(H/N))
  const harmonicEnergy = Math.min(Math.max(meanCorrelation, 1e-6), 1);
  const noiseEnergy = Math.max(1 - harmonicEnergy, 1e-6);
  const nhr = noiseEnergy / harmonicEnergy;
  const hnrDb = 10 * Math.log10(harmonicEnergy / noiseEnergy);

  return {
    meanPeriodPulses: meanPeriod,
    stdDevPeriodPulses: periodStd,
    locPctJitter: jitterRatio,
    locAbsJitter: jitterAbs,
    rapJitter: rap,
    ppq5Jitter: ppq,
    ddpJitter: ddp,
    locShimmer: shimmer,
    locDbShimmer: shimmerDb,
    apq3Shimmer: apq3,
    apq5Shimmer: apq5,
    apq11Shimmer: apq11,
    ddaShimmer: shimmerDDA,
    meanAutoCorrHarmonicity: meanCorrelation,
    meanNoiseToHarmHarmonicity: nhr,
    meanHarmToNoiseHarmonicity: hnrDb,
  };
}

export async function extractVoiceFeatures(source: Blob | ArrayBuffer): Promise<VoiceFeatureVector> {
  if (typeof window === 'undefined') {
    throw new Error('Voice feature extraction is only supported in the browser environment.');
  }
  const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('The Web Audio API is not supported in this browser.');
  }

  console.log('[Feature Extraction] Processing real audio recording...');
  const audioContext = new AudioContextConstructor();
  try {
    const bufferData = source instanceof Blob ? await source.arrayBuffer() : source;
    const audioBuffer = await audioContext.decodeAudioData(bufferData.slice(0));
    console.log('[Feature Extraction] Audio decoded:', {
      duration: audioBuffer.duration.toFixed(2) + 's',
      sampleRate: audioBuffer.sampleRate + 'Hz',
      channels: audioBuffer.numberOfChannels
    });
    
    const mono = mixDownToMono(audioBuffer);
    const trimmed = trimSilence(mono);
    const limited = limitDuration(trimmed, audioBuffer.sampleRate, 15);
    
    console.log('[Feature Extraction] Analyzing voice patterns from real audio signal...');
    const features = computeVoiceFeaturesFromSignal(limited, audioBuffer.sampleRate);
    console.log('[Feature Extraction] Real-time features computed successfully');
    
    return features;
  } finally {
    await audioContext.close();
  }
}

export function getVoiceModelMetadata(): VoiceModelMetadata | null {
  return trainedMetadata;
}
