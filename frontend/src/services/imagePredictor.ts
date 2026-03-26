// Lightweight image prediction helper using TensorFlow.js feature extractor (MobileNet)
// Tries to load MobileNet (MobileNetV2 style) and use it as an embedding extractor.
// It will attempt to build class centroids from images placed under `/spiral/...` or `/wave/...`
// folders. The loader tries sequential filenames 1..100 for each label subfolder.

type PredictResult = {
  label: string;
  confidence: number; // 0..1
  details?: string;
}

async function loadTf() {
  const tf = await import('@tensorflow/tfjs');
  // prefer WebGL backend if available
  try {
    await import('@tensorflow/tfjs-backend-webgl');
    await tf.setBackend('webgl');
  } catch (e) {
    // ignore - will fallback to cpu
    console.warn('tfjs webgl backend not available, using default backend', e);
  }
  await tf.ready();
  return tf;
}

async function loadMobileNet() {
  // dynamic import of mobilenet model
  const mm = await import('@tensorflow-models/mobilenet');
  const model = await mm.load({ version: 2, alpha: 1.0 });
  return model; // has embedder via model.infer(img, true)
}

async function loadImageElementFromBlob(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function fetchDatasetEmbeddings(model: any, basePath: string, labels: string[], maxPerLabel = 50) {
  const embeddingsByLabel: Record<string, number[][]> = {};
  
  // Helper to load images from a directory using manifest.json
  const tryLoadImagesFromDir = async (dirPath: string) => {
    const embeddings: number[][] = [];
    
    // Strategy 1: Try loading manifest.json file (fastest)
    try {
      const manifestResp = await fetch(`${dirPath}/manifest.json`);
      if (manifestResp.ok) {
        const filenames = await manifestResp.json() as string[];
        console.info(`Found manifest with ${filenames.length} files in ${dirPath}`);
        
        // Load up to maxPerLabel images
        const toLoad = filenames.slice(0, maxPerLabel);
        let loadedCount = 0;
        
        for (const filename of toLoad) {
          // Skip the manifest file itself
          if (filename === 'manifest.json') continue;
          
          try {
            const imgUrl = `${dirPath}/${filename}`;
            const resp = await fetch(imgUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              const imgEl = await loadImageElementFromBlob(blob);
              const embedding = model.infer(imgEl, true) as any;
              const arr = Array.from(await embedding.data()) as number[];
              embeddings.push(arr);
              embedding.dispose?.();
              loadedCount++;
              
              // Show progress every 5 images
              if (loadedCount % 5 === 0) {
                console.info(`Loaded ${loadedCount}/${toLoad.length} images from ${dirPath}`);
              }
            }
          } catch (e) {
            console.warn(`Failed to load ${filename}:`, e);
          }
        }
        
        return embeddings;
      }
    } catch (e) {
      console.warn('No manifest.json found, trying pattern matching:', e);
    }
    
    // Strategy 2: Fallback to pattern matching (slower)
    // Try actual patterns from your dataset: V01HE02.png, V01PE02.png, V01HO02.png
    const healthyPatterns = ['HE', 'HO']; // healthy patterns
    const parkinsonPatterns = ['PE', 'PO']; // parkinson patterns
    const allPatterns = [...healthyPatterns, ...parkinsonPatterns];
    
    for (let v = 1; v <= 30; v++) { // V01 to V30
      const vNum = v.toString().padStart(2, '0');
      
      for (const pattern of allPatterns) {
        for (let suffix = 2; suffix <= 9; suffix++) { // 02 to 09
          const filename = `V${vNum}${pattern}${suffix < 10 ? '0' + suffix : suffix}.png`;
          
          try {
            const imgUrl = `${dirPath}/${filename}`;
            const resp = await fetch(imgUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              const imgEl = await loadImageElementFromBlob(blob);
              const embedding = model.infer(imgEl, true) as any;
              const arr = Array.from(await embedding.data()) as number[];
              embeddings.push(arr);
              embedding.dispose?.();
              
              if (embeddings.length >= maxPerLabel) {
                return embeddings;
              }
            }
          } catch (e) {
            // continue to next pattern
          }
        }
      }
    }
    
    return embeddings;
  };
  
  for (const label of labels) {
    const dirPath = `${basePath}/training/${label}`;
    console.info(`Loading embeddings for ${label} from ${dirPath}...`);
    embeddingsByLabel[label] = await tryLoadImagesFromDir(dirPath);
    console.info(`✓ Loaded ${embeddingsByLabel[label].length} embeddings for label: ${label}`);
  }
  
  return embeddingsByLabel;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

function averageVector(vecs: number[][]) {
  if (!vecs.length) return [];
  const len = vecs[0].length;
  const acc = new Array(len).fill(0);
  for (const v of vecs) for (let i = 0; i < len; i++) acc[i] += v[i];
  for (let i = 0; i < len; i++) acc[i] /= vecs.length;
  return acc;
}

export async function predictImageLocally(file: File, testKind: 'spiral' | 'wave' | 'auto' = 'auto') : Promise<PredictResult> {
  // load TF and mobilenet
  console.info('🧠 Loading TensorFlow.js and MobileNet...');
  await loadTf();
  const mobilenet = await loadMobileNet();
  console.info('✓ MobileNet loaded successfully');

  // determine basePath and labels
  const baseSpiral = '/spiral';
  const baseWave = '/wave';
  const labels = ['healthy', 'parkinson'];

  // pick which dataset to use
  let basePath = baseSpiral;
  if (testKind === 'wave') basePath = baseWave;
  if (testKind === 'auto') {
    // try spiral first by checking existence of the first image
    try {
      const check = await fetch(`${baseSpiral}/training/healthy/manifest.json`, { method: 'HEAD' });
      if (check.ok) basePath = baseSpiral; else basePath = baseWave;
    } catch (e) {
      basePath = baseWave;
    }
  }

  console.info('📂 Using dataset basePath for local prediction:', basePath);

  // Use fewer images for faster loading (15 per class is enough for centroid)
  const embeddingsByLabel = await fetchDatasetEmbeddings(mobilenet, basePath, labels, 15);
  const counts = labels.map(l => embeddingsByLabel[l].length);
  console.info('📊 Dataset class counts', counts);

  // if no dataset images were found, return error
  if (counts.every(c => c === 0)) {
    return { label: 'unknown', confidence: 0, details: 'No dataset images available under ' + basePath };
  }

  // compute centroids
  console.info('🧮 Computing class centroids...');
  const centroids: Record<string, number[]> = {};
  for (const l of labels) centroids[l] = averageVector(embeddingsByLabel[l]);

  // load uploaded image
  console.info('📸 Analyzing uploaded image...');
  const imgEl = await loadImageElementFromBlob(file);
  const embTensor = mobilenet.infer(imgEl, true) as any;
  const embArr = Array.from(await embTensor.data());
  embTensor.dispose?.();

  // compute similarity to centroids
  const sims: Record<string, number> = {};
  for (const l of labels) {
    if (!centroids[l] || centroids[l].length === 0) { sims[l] = -1; continue; }
    sims[l] = cosineSimilarity(embArr as number[], centroids[l] as number[]);
  }

  const sorted = labels.slice().sort((a,b) => sims[b] - sims[a]);
  const best = sorted[0];
  const second = sorted[1];
  
  // Improved confidence calculation
  const bestSim = sims[best];
  const secondSim = sims[second] ?? 0;
  const margin = bestSim - secondSim;
  
  // Normalize confidence: higher margin = higher confidence
  const confidence = Math.min(0.95, Math.max(0.5, (margin + 0.5)));
  
  console.info('✅ Prediction complete:', { best, confidence, similarities: sims });

  return {
    label: best === 'parkinson' ? 'Parkinson-like' : 'Healthy-like',
    confidence: confidence,
    details: `Similarity scores - Healthy: ${sims.healthy?.toFixed(3)}, Parkinson: ${sims.parkinson?.toFixed(3)}`
  };
}export default predictImageLocally;
