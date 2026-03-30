/**
 * Utility to convert raw browser audio files (webm, mp4, ogg, etc.) into clean standard PCM WAV.
 * This completely eliminates server-side ffmpeg dependencies.
 */
export async function convertBlobToWav(blob: Blob, sampleRate: number = 44100): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  
  // Use OfflineAudioContext for extremely fast, non-realtime offline decoding and resampling
  const audioContext = new window.AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Create an offline context at the exact target sample rate (44100)
  const offlineContext = new OfflineAudioContext(
    1, // mono
    audioBuffer.duration * sampleRate,
    sampleRate
  );
  
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  
  const resampledBuffer = await offlineContext.startRendering();
  
  // Convert AudioBuffer to WAV ArrayBuffer
  const wavArrayBuffer = audioBufferToWavData(resampledBuffer);
  
  // Return a new Blob typed precisely as audio/wav
  return new Blob([wavArrayBuffer], { type: 'audio/wav' });
}

function audioBufferToWavData(buffer: AudioBuffer): ArrayBuffer {
  const numOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  // Float32Array from AudioBuffer
  const channelData = buffer.getChannelData(0);
  
  const dataLength = channelData.length * (bitDepth / 8);
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // ChunkSize
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numOfChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numOfChannels * (bitDepth / 8), true); // ByteRate
  view.setUint16(32, numOfChannels * (bitDepth / 8), true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true); // Subchunk2Size
  
  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < channelData.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return arrayBuffer;
}
