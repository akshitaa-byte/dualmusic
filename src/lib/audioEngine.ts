/**
 * Web Audio API Engine for Stereo Split Playback.
 * 
 * WHY: Standard HTML5 `<audio>` elements do not provide direct channel-level matrix routing.
 * By utilizing the native Web Audio API (`AudioContext`, `AudioBufferSourceNode`, and `ChannelMergerNode`),
 * we can take two independent PCM `AudioBuffer` objects decoded from raw user files or stream URLs and route them
 * explicitly to separate stereo channels (Left = channel index 0, Right = channel index 1).
 * 
 * INTERVIEW EXPLANATION:
 * 1. DRM Workaround: We decode raw PCM byte streams into uncompressed `AudioBuffer` instances.
 *    Protected streams (e.g. Spotify/Apple Music) block access to raw sample buffers due to EME/DRM.
 *    Royalty-free streams (Jamendo API) expose raw stream URLs with CORS headers enabled.
 * 2. Precise Synchronization: We trigger `sourceNode.start(startTime)` using the single `audioContext.currentTime`
 *    clock. This ensures sample-accurate simultaneous start across both independent audio buffers without drift.
 */

/**
 * Global singleton reference to the browser's AudioContext.
 * Reusing a single AudioContext avoids hitting browser limits on total concurrent audio contexts.
 */
let audioContextInstance: AudioContext | null = null;

/**
 * References to active AudioBufferSourceNodes currently playing.
 * Saved so they can be explicitly stopped and garbage collected.
 */
let currentSourceA: AudioBufferSourceNode | null = null;
let currentSourceB: AudioBufferSourceNode | null = null;

/**
 * Retrieves or initializes the shared web `AudioContext`.
 * 
 * WHAT: Returns a singleton AudioContext, creating one if it doesn't exist yet,
 * and resuming it if it was suspended by browser autoplay policies.
 * WHY: Browsers block AudioContext initialization until user gesture. A lazy singleton getter
 * guarantees AudioContext is resumed upon user interaction (e.g. clicking Play).
 * 
 * @returns {AudioContext} The active browser AudioContext instance.
 */
export function getAudioContext(): AudioContext {
  if (!audioContextInstance) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContextInstance = new AudioContextClass();
  }
  if (audioContextInstance.state === "suspended") {
    audioContextInstance.resume();
  }
  return audioContextInstance;
}

/**
 * Decodes a raw File object into a Web Audio API `AudioBuffer`.
 * 
 * WHAT: Reads a File input, reads its raw data into an ArrayBuffer, and decodes it asynchronously.
 * WHY: Web Audio nodes require uncompressed linear PCM sample buffers to perform real-time channel routing.
 * 
 * @param {File} file - User-selected audio file (e.g., MP3, WAV, AAC).
 * @returns {Promise<AudioBuffer>} Decoded audio buffer containing PCM channels.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  // decodeAudioData consumes the ArrayBuffer and returns an AudioBuffer containing PCM data
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Decodes an HTTP audio stream URL into a Web Audio API `AudioBuffer`.
 * 
 * WHAT: Fetches a remote audio stream URL (e.g. from Jamendo API), reads its response array buffer,
 * and decodes it into an AudioBuffer using `decodeAudioData`.
 * WHY: Enables remote CORS-supported audio streams to be converted into playable PCM buffers
 * for ChannelMergerNode stereo split routing without saving the audio file locally.
 * 
 * @param {string} url - Direct audio stream URL.
 * @returns {Promise<AudioBuffer>} Decoded audio buffer containing PCM channels.
 */
export async function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error fetching stream! Status: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Plays two AudioBuffers simultaneously, splitting one to the Left ear and one to the Right ear.
 * 
 * WHAT: Creates two AudioBufferSourceNodes, routes bufferA to Channel 0 (Left) and bufferB to Channel 1 (Right)
 * using a 2-channel ChannelMergerNode, and schedules both to start at exact `audioContext.currentTime`.
 * WHY: ChannelMergerNode allows custom routing of mono/stereo inputs into distinct output speaker channels.
 * By connecting sourceA -> merger input 0 and sourceB -> merger input 1, we isolate each track to one ear.
 * 
 * @param {AudioBuffer} bufferA - Audio track intended exclusively for the LEFT ear.
 * @param {AudioBuffer} bufferB - Audio track intended exclusively for the RIGHT ear.
 */
export function playStereoSplit(bufferA: AudioBuffer, bufferB: AudioBuffer): void {
  const ctx = getAudioContext();

  // Stop any active playback before starting a new one
  stopPlayback();

  // Create source nodes for PCM playback
  const sourceA = ctx.createBufferSource();
  const sourceB = ctx.createBufferSource();

  sourceA.buffer = bufferA;
  sourceB.buffer = bufferB;

  /**
   * ChannelMergerNode(2) combines single-channel inputs into a multi-channel output stream.
   * Input pin 0 -> Left channel (Output 0)
   * Input pin 1 -> Right channel (Output 1)
   */
  const mergerNode = ctx.createChannelMerger(2);

  // Connect bufferA output to merger input 0 (Left ear)
  sourceA.connect(mergerNode, 0, 0);

  // Connect bufferB output to merger input 1 (Right ear)
  sourceB.connect(mergerNode, 0, 1);

  // Connect merger node directly to default audio output destination (speakers / headphones)
  mergerNode.connect(ctx.destination);

  // Store references for cleanup / stop functionality
  currentSourceA = sourceA;
  currentSourceB = sourceB;

  // Schedule both source nodes to start at exact same execution time
  const startTime = ctx.currentTime + 0.05; // 50ms buffer to guarantee synchronized start
  sourceA.start(startTime);
  sourceB.start(startTime);
}

/**
 * Stops active audio playback and clears node references.
 * 
 * WHAT: Stops sourceA and sourceB if currently running and releases node references.
 * WHY: AudioBufferSourceNodes are single-use objects in Web Audio API. Once stopped, they cannot be restarted;
 * stopping them prevents lingering sound and allows garbage collection.
 */
export function stopPlayback(): void {
  if (currentSourceA) {
    try {
      currentSourceA.stop();
      currentSourceA.disconnect();
    } catch {
      // Node may already have ended naturally
    }
    currentSourceA = null;
  }

  if (currentSourceB) {
    try {
      currentSourceB.stop();
      currentSourceB.disconnect();
    } catch {
      // Node may already have ended naturally
    }
    currentSourceB = null;
  }
}
