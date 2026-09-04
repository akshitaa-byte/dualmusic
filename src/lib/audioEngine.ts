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
 * Saved so they can be explicitly stopped, restarted, or garbage collected.
 */
let currentSourceA: AudioBufferSourceNode | null = null;
let currentSourceB: AudioBufferSourceNode | null = null;

/**
 * References to Left and Right GainNodes for channel-independent volume control.
 * 
 * WHY: Inserting a GainNode into each audio channel's signal path before the ChannelMergerNode
 * allows real-time amplification/attenuation of Left or Right audio independently without altering
 * the raw sample PCM buffer in memory or affecting the other ear.
 */
let leftGainNode: GainNode | null = null;
let rightGainNode: GainNode | null = null;

/**
 * Stores current volume level preferences (0.0 to 1.0) so volume persists across restarts.
 */
let currentLeftVolume = 1.0;
let currentRightVolume = 1.0;

/**
 * Tracks playback timing metadata needed to compute real-time scrub position.
 *
 * WHY: AudioBufferSourceNode does not expose a live `currentTime` position. Instead,
 * we record the AudioContext time when playback started (`startContextTime`) and the
 * seek offset each channel began from (`startOffsetA`, `startOffsetB`). The UI then
 * computes elapsed = (audioCtx.currentTime - startContextTime) + startOffset.
 */
let startContextTime = 0;   // audioContext.currentTime at the moment play was called
let startOffsetA = 0;       // seconds into bufferA that playback began from
let startOffsetB = 0;       // seconds into bufferB that playback began from

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
 * Adjusts the gain (volume) for the Left ear channel in real time.
 * 
 * WHAT: Sets the gain parameter of the Left ear's GainNode.
 * WHY: Provides real-time volume adjustment (0.0 = silent, 1.0 = 100% volume) while audio is playing.
 * 
 * @param {number} volume - Normalized volume level between 0.0 and 1.0.
 */
export function setLeftVolume(volume: number): void {
  currentLeftVolume = volume;
  if (leftGainNode && audioContextInstance) {
    leftGainNode.gain.setValueAtTime(volume, audioContextInstance.currentTime);
  }
}

/**
 * Adjusts the gain (volume) for the Right ear channel in real time.
 * 
 * WHAT: Sets the gain parameter of the Right ear's GainNode.
 * WHY: Provides real-time volume adjustment (0.0 = silent, 1.0 = 100% volume) while audio is playing.
 * 
 * @param {number} volume - Normalized volume level between 0.0 and 1.0.
 */
export function setRightVolume(volume: number): void {
  currentRightVolume = volume;
  if (rightGainNode && audioContextInstance) {
    rightGainNode.gain.setValueAtTime(volume, audioContextInstance.currentTime);
  }
}

/**
 * Plays two AudioBuffers simultaneously, splitting one to the Left ear and one to the Right ear,
 * passing through dedicated GainNodes for per-ear volume control.
 * 
 * WHAT: Creates two AudioBufferSourceNodes, routes bufferA -> leftGainNode -> Channel 0 (Left)
 * and bufferB -> rightGainNode -> Channel 1 (Right) using a 2-channel ChannelMergerNode,
 * and schedules both to start at exact `audioContext.currentTime`.
 * WHY: Inserting GainNodes before ChannelMergerNode allows independent volume adjustment per ear.
 * ChannelMergerNode isolates each track strictly to one speaker output pin.
 * 
 * @param {AudioBuffer} bufferA - Audio track intended exclusively for the LEFT ear.
 * @param {AudioBuffer} bufferB - Audio track intended exclusively for the RIGHT ear.
 * @param {number} [targetTime] - Optional precise AudioContext target execution timestamp.
 * @param {number} [offsetSeconds] - Optional start offset in seconds to skip ahead into the AudioBuffers.
 */
export function playStereoSplit(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  targetTime?: number,
  offsetSeconds?: number
): void {
  const ctx = getAudioContext();

  // Stop any active playback before starting a new one
  stopPlayback();

  // Create source nodes for PCM playback
  const sourceA = ctx.createBufferSource();
  const sourceB = ctx.createBufferSource();

  sourceA.buffer = bufferA;
  sourceB.buffer = bufferB;

  /**
   * ChannelMergerNode(2): combines two mono inputs into one stereo output.
   *
   * CRITICAL: Each input pin of ChannelMergerNode must receive exactly ONE channel.
   * If a stereo node (e.g., a default GainNode fed by a 2-channel AudioBuffer) is
   * connected to a single merger input pin, the Web Audio spec sums ALL channels of
   * that node into that one pin, producing a mono downmix of BOTH sub-channels.
   * This is the root cause of the cross-ear bleed: track A's right sub-channel was
   * bleeding into the left output because the stereo GainNode was passing both
   * L and R samples into merger pin 0.
   *
   * FIX: Insert a ChannelSplitterNode(2) after each source to extract only channel 0
   * (the left/primary sub-channel of the decoded stereo buffer). Force each GainNode
   * to strict mono with channelCount=1 + channelCountMode="explicit" so the Web Audio
   * engine cannot silently re-upgrade it to stereo based on its input's channel count.
   *
   * FINAL GRAPH (every .connect() call listed explicitly below):
   *   sourceA -> splitterA -> (output 0) -> leftGain (mono) -> merger (input 0) -> destination
   *   sourceB -> splitterB -> (output 0) -> rightGain (mono) -> merger (input 1) -> destination
   *
   * There are NO direct connections from any gain node to destination.
   * There are NO connections from any source directly to the merger.
   * Each merger input pin receives exactly one mono channel. Zero ghost connections.
   */
  const mergerNode = ctx.createChannelMerger(2);

  /**
   * ChannelSplitterNode(2): extracts individual channels from a stereo source.
   * Output index 0 = left sub-channel, output index 1 = right sub-channel.
   * We only use output 0 from each splitter, giving us the primary mono signal
   * from the decoded audio buffer without any cross-channel contamination.
   */
  const splitterA = ctx.createChannelSplitter(2);
  const splitterB = ctx.createChannelSplitter(2);

  /**
   * GainNodes for independent per-ear volume control.
   *
   * channelCount: 1 — explicit mono.
   * channelCountMode: "explicit" — prevents the node from silently upgrading its
   *   channel count to match its input. Without this, a GainNode connected after
   *   a stereo splitter output would stay at 1 channel, but with a default-mode
   *   GainNode fed directly by a stereo source it would upgrade to 2 — undoing
   *   the isolation we need before the merger.
   * channelInterpretation: "speakers" — standard interpretation for the mono channel.
   */
  leftGainNode = ctx.createGain();
  leftGainNode.channelCount = 1;
  leftGainNode.channelCountMode = "explicit";
  leftGainNode.channelInterpretation = "speakers";
  leftGainNode.gain.setValueAtTime(currentLeftVolume, ctx.currentTime);

  rightGainNode = ctx.createGain();
  rightGainNode.channelCount = 1;
  rightGainNode.channelCountMode = "explicit";
  rightGainNode.channelInterpretation = "speakers";
  rightGainNode.gain.setValueAtTime(currentRightVolume, ctx.currentTime);

  // Track A: source → splitter → channel 0 only → leftGain (mono) → merger pin 0 (LEFT ear)
  sourceA.connect(splitterA);
  splitterA.connect(leftGainNode, 0);      // splitter output 0 → leftGain (only output 0, never output 1)
  leftGainNode.connect(mergerNode, 0, 0);  // leftGain output 0 → merger input 0 (LEFT channel)

  // Track B: source → splitter → channel 0 only → rightGain (mono) → merger pin 1 (RIGHT ear)
  sourceB.connect(splitterB);
  splitterB.connect(rightGainNode, 0);     // splitter output 0 → rightGain (only output 0, never output 1)
  rightGainNode.connect(mergerNode, 0, 1); // rightGain output 0 → merger input 1 (RIGHT channel)

  // Merger → speakers/headphones. This is the ONLY connection to ctx.destination.
  mergerNode.connect(ctx.destination);

  // Store references for cleanup / stop / volume modification
  currentSourceA = sourceA;
  currentSourceB = sourceB;

  // Schedule both source nodes to start at target time (or default 50ms buffer) with optional offsetSeconds
  const startTime = targetTime !== undefined ? targetTime : ctx.currentTime + 0.05;
  const startOffset = offsetSeconds && offsetSeconds > 0 ? offsetSeconds : 0;

  // Record timing for scrub bar calculations
  startContextTime = startTime;
  startOffsetA = startOffset;
  startOffsetB = startOffset;

  sourceA.start(startTime, startOffset);
  sourceB.start(startTime, startOffset);
}

/**
 * Pauses active synchronized playback across both ear channels.
 * 
 * WHAT: Suspends the global `AudioContext` clock using `audioContext.suspend()`.
 * WHY: `AudioBufferSourceNode` does not have a native `pause()` method. Suspending the `AudioContext`
 * pauses the hardware clock immediately for all active nodes simultaneously, maintaining sample synchronization.
 * 
 * @returns {Promise<void>} Resolves when AudioContext is suspended.
 */
export async function pausePlayback(): Promise<void> {
  if (audioContextInstance && audioContextInstance.state === "running") {
    await audioContextInstance.suspend();
  }
}

/**
 * Resumes paused synchronized playback across both ear channels.
 * 
 * WHAT: Resumes the suspended global `AudioContext` clock using `audioContext.resume()`.
 * WHY: Resuming the `AudioContext` clock unblocks playback for both tracks simultaneously at exact same hardware sample position.
 * 
 * @returns {Promise<void>} Resolves when AudioContext is resumed.
 */
export async function resumePlayback(): Promise<void> {
  if (audioContextInstance && audioContextInstance.state === "suspended") {
    await audioContextInstance.resume();
  }
}

/**
 * Restarts synchronized stereo split playback from the beginning (t = 0).
 * 
 * WHAT: Stops existing AudioBufferSourceNodes, creates brand new source node instances with the existing AudioBuffers,
 * ensures AudioContext is active, and starts both nodes at `currentTime + 0.05`.
 * WHY: Web Audio API `AudioBufferSourceNode` instances are strictly single-use. Once stopped, they cannot be restarted.
 * Re-instantiating source nodes from the already-decoded in-memory AudioBuffers provides instantaneous restart without network/re-decoding overhead.
 * 
 * @param {AudioBuffer} bufferA - Already-decoded Left ear AudioBuffer.
 * @param {AudioBuffer} bufferB - Already-decoded Right ear AudioBuffer.
 */
export async function restartPlayback(bufferA: AudioBuffer, bufferB: AudioBuffer): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  startOffsetA = 0;
  startOffsetB = 0;
  playStereoSplit(bufferA, bufferB);
}

/**
 * Returns real-time playback position info for the scrub bar UI.
 *
 * WHAT: Computes the current elapsed position for each channel by subtracting
 * `startContextTime` from `audioContext.currentTime` and adding the channel's
 * seek offset. Called every animation frame from the React component.
 * WHY: AudioBufferSourceNode has no `.currentTime` property; this is the standard
 * pattern for deriving live position from the AudioContext's monotonic clock.
 *
 * @returns {{ elapsedA: number; elapsedB: number; contextTime: number }}
 */
export function getPlaybackInfo(): { elapsedA: number; elapsedB: number; contextTime: number } {
  const ctx = audioContextInstance;
  if (!ctx || ctx.state === "suspended") {
    return { elapsedA: startOffsetA, elapsedB: startOffsetB, contextTime: 0 };
  }
  const elapsed = ctx.currentTime - startContextTime;
  return {
    elapsedA: startOffsetA + elapsed,
    elapsedB: startOffsetB + elapsed,
    contextTime: ctx.currentTime,
  };
}

/**
 * Plays two AudioBuffers with INDEPENDENT seek offsets per channel.
 *
 * WHAT: Same stereo-split graph as `playStereoSplit` but each source starts
 * at its own offset (offsetA for the left ear, offsetB for the right ear).
 * WHY: Allows the user to position left and right tracks at completely different
 * timestamps — e.g. Left starts at 0:15, Right starts at 0:02.
 *
 * @param {AudioBuffer} bufferA   - Left ear PCM buffer.
 * @param {AudioBuffer} bufferB   - Right ear PCM buffer.
 * @param {number}      offsetA   - Start position in seconds for bufferA.
 * @param {number}      offsetB   - Start position in seconds for bufferB.
 */
export function playStereoSplitIndependent(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  offsetA: number,
  offsetB: number
): void {
  const ctx = getAudioContext();
  stopPlayback();

  const sourceA = ctx.createBufferSource();
  const sourceB = ctx.createBufferSource();
  sourceA.buffer = bufferA;
  sourceB.buffer = bufferB;

  const mergerNode = ctx.createChannelMerger(2);
  const splitterA = ctx.createChannelSplitter(2);
  const splitterB = ctx.createChannelSplitter(2);

  leftGainNode = ctx.createGain();
  leftGainNode.channelCount = 1;
  leftGainNode.channelCountMode = "explicit";
  leftGainNode.channelInterpretation = "speakers";
  leftGainNode.gain.setValueAtTime(currentLeftVolume, ctx.currentTime);

  rightGainNode = ctx.createGain();
  rightGainNode.channelCount = 1;
  rightGainNode.channelCountMode = "explicit";
  rightGainNode.channelInterpretation = "speakers";
  rightGainNode.gain.setValueAtTime(currentRightVolume, ctx.currentTime);

  sourceA.connect(splitterA);
  splitterA.connect(leftGainNode, 0);
  leftGainNode.connect(mergerNode, 0, 0);

  sourceB.connect(splitterB);
  splitterB.connect(rightGainNode, 0);
  rightGainNode.connect(mergerNode, 0, 1);

  mergerNode.connect(ctx.destination);

  currentSourceA = sourceA;
  currentSourceB = sourceB;

  const startTime = ctx.currentTime + 0.05;
  startContextTime = startTime;
  startOffsetA = offsetA >= 0 ? offsetA : 0;
  startOffsetB = offsetB >= 0 ? offsetB : 0;

  sourceA.start(startTime, startOffsetA);
  sourceB.start(startTime, startOffsetB);
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

  if (leftGainNode) {
    leftGainNode.disconnect();
    leftGainNode = null;
  }

  if (rightGainNode) {
    rightGainNode.disconnect();
    rightGainNode = null;
  }
}

