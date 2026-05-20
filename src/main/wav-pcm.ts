export function wavToMonoPcm16(
  wavBytes: Uint8Array,
  targetSampleRateHz: number
): Uint8Array {
  const source = parsePcm16Wav(wavBytes);
  const mono = mixToMono(source.samples, source.channelCount);
  const resampled = source.sampleRateHz === targetSampleRateHz
    ? mono
    : resampleLinear(mono, source.sampleRateHz, targetSampleRateHz);

  return int16ArrayToBytes(resampled);
}

function parsePcm16Wav(wavBytes: Uint8Array): {
  sampleRateHz: number;
  channelCount: number;
  samples: Int16Array;
} {
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);

  if (wavBytes.byteLength < 44 || readAscii(wavBytes, 0, 4) !== "RIFF" || readAscii(wavBytes, 8, 4) !== "WAVE") {
    throw new Error("Realtime Cloud Dictation fallback audio was not a WAV file.");
  }

  let offset = 12;
  let format: {
    audioFormat: number;
    channelCount: number;
    sampleRateHz: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBytes.byteLength) {
    const chunkId = readAscii(wavBytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > wavBytes.byteLength) {
      break;
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error("Realtime Cloud Dictation fallback WAV format chunk is invalid.");
      }

      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channelCount: view.getUint16(chunkDataOffset + 2, true),
        sampleRateHz: view.getUint32(chunkDataOffset + 4, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true)
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format) {
    throw new Error("Realtime Cloud Dictation fallback WAV did not include a format chunk.");
  }

  if (format.audioFormat !== 1 || format.bitsPerSample !== 16 || format.channelCount < 1) {
    throw new Error("Realtime Cloud Dictation fallback requires PCM16 WAV audio.");
  }

  if (dataOffset < 0 || dataSize < 2) {
    throw new Error("Realtime Cloud Dictation fallback WAV did not include audio samples.");
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true);
  }

  return {
    sampleRateHz: format.sampleRateHz,
    channelCount: format.channelCount,
    samples
  };
}

function mixToMono(samples: Int16Array, channelCount: number): Int16Array {
  if (channelCount === 1) {
    return samples;
  }

  const frameCount = Math.floor(samples.length / channelCount);
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      sum += samples[frame * channelCount + channel];
    }

    mono[frame] = clampInt16(Math.round(sum / channelCount));
  }

  return mono;
}

function resampleLinear(
  samples: Int16Array,
  sourceSampleRateHz: number,
  targetSampleRateHz: number
): Int16Array {
  if (sourceSampleRateHz <= 0 || targetSampleRateHz <= 0) {
    throw new Error("Realtime Cloud Dictation fallback WAV sample rate is invalid.");
  }

  const targetLength = Math.max(1, Math.round(samples.length * targetSampleRateHz / sourceSampleRateHz));
  const output = new Int16Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * (sourceSampleRateHz / targetSampleRateHz);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = sourcePosition - leftIndex;
    const value = samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
    output[index] = clampInt16(Math.round(value));
  }

  return output;
}

function int16ArrayToBytes(samples: Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}
