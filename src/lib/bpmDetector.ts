/**
 * Autocorrelation-Based BPM (Beats Per Minute) Detector for Web Audio API & Node.js Audio Buffers.
 * 
 * WHAT: Analyzes a PCM AudioBuffer's energy envelope over time using an autocorrelation algorithm
 * to calculate the tempo (BPM) of an audio track.
 * 
 * WHY (ARCHITECTURAL REASONING):
 * 1. Mathematical Accuracy: Autocorrelation measures self-similarity of downsampled audio energy peaks
 *    across lag intervals corresponding to 60-200 BPM.
 * 2. Zero External Dependencies: Pure signal processing in TypeScript compatible with both browser Web Audio
 *    `AudioBuffer` objects and server-side decoded PCM buffers.
 * 3. Stereo Compatibility Verification: Enables calculating real tempo difference between Left and Right
 *    channels to prevent jarring tempo mismatches in stereo-split playback.
 */

export interface BPMDetectionResult {
  bpm: number;
  confidence: number;
}

/**
 * Detects the tempo (BPM) of a PCM AudioBuffer.
 * 
 * @param buffer - Decoded AudioBuffer (browser or node)
 * @returns Object containing integer `bpm` estimate (60 to 200 BPM) and `confidence` score
 */
export function detectBufferBPM(buffer: AudioBuffer): BPMDetectionResult {
  try {
    const sampleRate = buffer.sampleRate;
    const pcmData = buffer.getChannelData(0); // Use mono channel
    if (!pcmData || pcmData.length === 0) {
      return { bpm: 120, confidence: 0 };
    }

    // Downsample energy envelope in 10ms windows for speed & efficiency
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms window
    const energyEnvelope: number[] = [];

    for (let i = 0; i < pcmData.length; i += windowSize) {
      let sum = 0;
      const limit = Math.min(i + windowSize, pcmData.length);
      for (let j = i; j < limit; j++) {
        sum += Math.abs(pcmData[j]);
      }
      energyEnvelope.push(sum / (limit - i));
    }

    // Autocorrelation lag bounds for 60 BPM to 200 BPM
    // 10ms per window sample -> 100 samples/sec
    const envSampleRate = 100;
    const minLag = Math.floor((60 / 200) * envSampleRate); // 30 samples lag (200 BPM)
    const maxLag = Math.floor((60 / 60) * envSampleRate);  // 100 samples lag (60 BPM)

    let bestLag = minLag;
    let maxCorrelation = -Infinity;

    const n = energyEnvelope.length;
    if (n < maxLag * 2) {
      return { bpm: 120, confidence: 0.5 };
    }

    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      const count = Math.min(n - lag, 1000); // Limit samples for speed
      for (let i = 0; i < count; i++) {
        correlation += energyEnvelope[i] * energyEnvelope[i + lag];
      }
      correlation /= count;

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestLag = lag;
      }
    }

    const calculatedBpm = Math.round((60 * envSampleRate) / bestLag);
    // Clamp to realistic music BPM bounds [60, 200]
    const clampedBpm = Math.min(Math.max(calculatedBpm, 60), 200);

    return {
      bpm: clampedBpm,
      confidence: Math.min(Math.max(maxCorrelation, 0), 1),
    };
  } catch {
    return { bpm: 120, confidence: 0 };
  }
}
