import fs from 'fs';
import path from 'path';

/**
 * Generates an 8-bit uncompressed mono PCM WAV file containing a pure sine wave tone.
 * 
 * WHAT: Constructs a raw 44-byte RIFF/WAVE binary header followed by 8-bit unsigned PCM audio sample data
 * generated from a sine wave equation at the given frequency, and writes the output file to disk.
 * 
 * WHY: Browser Web Audio API engine tests require reliable, CORS-accessible audio test fixtures.
 * Generating pure tone audio files programmatically ensures deterministic audio frequencies (e.g. 440 Hz vs 880 Hz)
 * to verify channel isolation without requiring external network fetches or copyright-restricted audio assets.
 * 
 * @param {number} freq - Frequency of the generated sine wave tone in Hertz (Hz).
 * @param {string} filename - Output filename (saved inside the `public/` folder).
 */
function createWav(freq: number, filename: string): void {
  const sampleRate = 44100;
  const numSamples = sampleRate * 2; // 2 seconds duration
  const dataByteLength = numSamples;
  const buffer = Buffer.alloc(44 + dataByteLength);

  // RIFF header chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk (PCM format description)
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 bytes for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = uncompressed PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono channel)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate (44.1 kHz standard)
  buffer.writeUInt32LE(sampleRate, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample / 8)
  buffer.writeUInt16LE(1, 32); // BlockAlign (NumChannels * BitsPerSample / 8)
  buffer.writeUInt16LE(8, 34); // BitsPerSample (8-bit depth)

  // data subchunk header
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  // Generate discrete 8-bit PCM sine wave sample bytes (value range: 0 - 255)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.floor(127 * Math.sin(2 * Math.PI * freq * t) + 128);
    buffer.writeUInt8(sample, 44 + i);
  }

  const outPath = path.join(process.cwd(), 'public', filename);
  fs.writeFileSync(outPath, buffer);
  console.log(`Generated ${outPath}`);
}

createWav(440, 'left_tone_440.wav');
createWav(880, 'right_tone_880.wav');
