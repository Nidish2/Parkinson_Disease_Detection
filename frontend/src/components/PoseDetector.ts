import {
  POSE_CONNECTIONS,
  Pose,
  type NormalizedLandmark,
  type Results,
} from '@mediapipe/pose';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import poseLandmarkLiteUrl from '@mediapipe/pose/pose_landmark_lite.tflite?url';
import posePackedAssetsUrl from '@mediapipe/pose/pose_solution_packed_assets.data?url';
import posePackedAssetsLoaderUrl from '@mediapipe/pose/pose_solution_packed_assets_loader.js?url';
import poseSimdDataUrl from '@mediapipe/pose/pose_solution_simd_wasm_bin.data?url';
import poseSimdJsUrl from '@mediapipe/pose/pose_solution_simd_wasm_bin.js?url';
import poseSimdWasmUrl from '@mediapipe/pose/pose_solution_simd_wasm_bin.wasm?url';
import poseWasmJsUrl from '@mediapipe/pose/pose_solution_wasm_bin.js?url';
import poseWasmUrl from '@mediapipe/pose/pose_solution_wasm_bin.wasm?url';
import poseWebBinaryUrl from '@mediapipe/pose/pose_web.binarypb?url';
import type { PoseFrame } from './therapyTypes';

const POSE_ASSET_URLS: Record<string, string> = {
  'pose_landmark_lite.tflite': poseLandmarkLiteUrl,
  'pose_solution_packed_assets.data': posePackedAssetsUrl,
  'pose_solution_packed_assets_loader.js': posePackedAssetsLoaderUrl,
  'pose_solution_simd_wasm_bin.data': poseSimdDataUrl,
  'pose_solution_simd_wasm_bin.js': poseSimdJsUrl,
  'pose_solution_simd_wasm_bin.wasm': poseSimdWasmUrl,
  'pose_solution_wasm_bin.js': poseWasmJsUrl,
  'pose_solution_wasm_bin.wasm': poseWasmUrl,
  'pose_web.binarypb': poseWebBinaryUrl,
};

const getVideoDimensions = (video: HTMLVideoElement) => ({
  width: video.videoWidth || 640,
  height: video.videoHeight || 480,
});

export class BrowserPoseDetector {
  private pose: Pose | null = null;
  private latestFrame: PoseFrame | null = null;
  private latestRawLandmarks: NormalizedLandmark[] = [];
  private busy = false;
  private initialized = false;
  private initializationFailed = false;
  private lastSendTime = 0;
  private pendingSubmit: Promise<void> | null = null;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;

  async initialize() {
    if (this.initialized && this.pose) {
      return;
    }

    this.initializationFailed = false;

    try {
      const pose = new Pose({
        locateFile: (file) => POSE_ASSET_URLS[file] ?? file,
      });

      pose.setOptions({
        selfieMode: true,
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: Results) => {
        try {
          const poseLandmarks = Array.isArray(results.poseLandmarks) ? results.poseLandmarks : [];
          this.latestRawLandmarks = poseLandmarks;

          if (!poseLandmarks.length) {
            this.latestFrame = null;
            return;
          }

          const image = results.image as HTMLVideoElement | undefined;
          const dimensions = image ? getVideoDimensions(image) : { width: 640, height: 480 };

          this.latestFrame = {
            landmarks: poseLandmarks.map((landmark) => ({
              x: landmark.x ?? 0,
              y: landmark.y ?? 0,
              z: landmark.z ?? 0,
              visibility: landmark.visibility ?? 0,
            })),
            timestamp: performance.now(),
            ...dimensions,
          };
          this.consecutiveErrors = 0;
        } catch (callbackError) {
          console.error('Error processing pose results:', callbackError);
        }
      });

      await pose.initialize();

      this.pose = pose;
      this.initialized = true;
      this.consecutiveErrors = 0;
    } catch (initError) {
      this.initializationFailed = true;
      throw new Error(
        `Failed to initialize pose model: ${initError instanceof Error ? initError.message : 'Unknown error'}`,
      );
    }
  }

  async estimate(video: HTMLVideoElement) {
    if (this.initializationFailed) {
      return null;
    }

    if (!this.pose || !this.initialized) {
      return this.latestFrame;
    }

    if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
      const timeSinceLastSend = performance.now() - this.lastSendTime;
      if (timeSinceLastSend < 2000) {
        return this.latestFrame;
      }
      this.consecutiveErrors = 0;
    }

    if (this.pendingSubmit) {
      try {
        await Promise.race([
          this.pendingSubmit,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100)),
        ]);
      } catch {
        this.pendingSubmit = null;
        this.busy = false;
      }
      return this.latestFrame;
    }

    if (this.busy) {
      return this.latestFrame;
    }

    this.busy = true;
    this.lastSendTime = performance.now();

    try {
      this.pendingSubmit = Promise.race([
        this.pose.send({ image: video }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Pose detection timeout')), 900),
        ),
      ]);

      await this.pendingSubmit;
      this.pendingSubmit = null;
      return this.latestFrame;
    } catch (error) {
      this.consecutiveErrors += 1;
      console.debug('Pose detection error (will retry):', error instanceof Error ? error.message : error);
      this.pendingSubmit = null;
      return this.latestFrame;
    } finally {
      this.busy = false;
    }
  }

  draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, frame: PoseFrame | null) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = getVideoDimensions(video);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    if (!frame || !this.latestRawLandmarks.length) return;

    try {
      drawConnectors(ctx, this.latestRawLandmarks, POSE_CONNECTIONS, {
        color: '#D3A15D',
        lineWidth: 3,
      });
      drawLandmarks(ctx, this.latestRawLandmarks, {
        color: '#F7F2E8',
        fillColor: '#5D7052',
        radius: 4,
      });
    } catch {
      // Drawing can fail if canvas context is lost, just skip
    }
  }

  isReady() {
    return this.initialized && this.pose !== null;
  }

  dispose() {
    try {
      void this.pose?.close();
    } catch {
      // Ignore dispose errors
    }
    this.pose = null;
    this.latestFrame = null;
    this.latestRawLandmarks = [];
    this.initialized = false;
    this.initializationFailed = false;
    this.busy = false;
    this.consecutiveErrors = 0;
    this.pendingSubmit = null;
  }
}
