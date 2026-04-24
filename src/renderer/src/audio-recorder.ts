export type PcmRecorder = {
  stop: () => Promise<Uint8Array>;
};

export async function startPcmRecorder(): Promise<PcmRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
  const audioContext = new AudioContext();
  await loadPcmWorklet(audioContext);
  const source = audioContext.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(audioContext, "voxtype-pcm-recorder", {
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1]
  });
  const silentMonitor = audioContext.createGain();
  const chunks: Float32Array[] = [];

  silentMonitor.gain.value = 0;
  processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
    chunks.push(event.data);
  };

  source.connect(processor);
  processor.connect(silentMonitor);
  silentMonitor.connect(audioContext.destination);

  return {
    stop: async () => {
      const sampleRate = audioContext.sampleRate;
      processor.port.onmessage = null;
      processor.disconnect();
      silentMonitor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();

      const merged = mergeChunks(chunks);
      const resampled = resampleLinear(merged, sampleRate, 16000);

      return encodeWav(resampled, 16000);
    }
  };
}

async function loadPcmWorklet(audioContext: AudioContext): Promise<void> {
  const workletUrl = URL.createObjectURL(
    new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" })
  );

  try {
    await audioContext.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }

  const outputLength = Math.round((input.length * outputRate) / inputRate);
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const weight = sourceIndex - before;

    output[index] = input[before] * (1 - weight) + input[after] * weight;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;

  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

const PCM_WORKLET_SOURCE = `
class VoxTypePcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];

    if (channel && channel.length > 0) {
      const copy = new Float32Array(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor("voxtype-pcm-recorder", VoxTypePcmRecorder);
`;
