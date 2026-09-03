import fs from 'fs';
import path from 'path';

// Create a 1-second 440 Hz (Left track tone) mono WAV buffer
function createWav(freq: number, filename: string) {
  const sampleRate = 44100;
  const numSamples = sampleRate * 2; // 2 seconds
  const dataByteLength = numSamples;
  const buffer = Buffer.alloc(44 + dataByteLength);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate, 28); // ByteRate
  buffer.writeUInt16LE(1, 32); // BlockAlign
  buffer.writeUInt16LE(8, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

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
