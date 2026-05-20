import { openAiRealtimeAudioConfig } from "../shared/asr";
import { RealtimeCloudSession } from "./realtime-cloud-session";
import { wavToMonoPcm16 } from "./wav-pcm";

const realtimeFallbackAppendChunkBytes = 1024 * 1024;

export class RealtimeAudioBuffer {
  private pendingBytes = 0;
  private pendingDroppedBytes = 0;
  private readonly pendingBuffer: Uint8Array[] = [];
  private readonly pendingBufferLimitBytes = openAiRealtimeAudioConfig.sampleRateHz * 2 * 5;
  recordingChunkCount = 0;
  recordingByteCount = 0;

  appendSafely(
    session: RealtimeCloudSession | null,
    bytes: Uint8Array,
    onStreamingError: (error: Error) => void
  ): Error | null {
    if (!session) {
      this.bufferPending(bytes);
      return null;
    }

    try {
      session.appendPcm16Audio(bytes);
      return null;
    } catch (error) {
      const streamingError = error instanceof Error
        ? error
        : new Error("Realtime Cloud Dictation audio streaming failed.");
      onStreamingError(streamingError);
      return streamingError;
    }
  }

  resetPending(): void {
    this.pendingBuffer.length = 0;
    this.pendingBytes = 0;
    this.pendingDroppedBytes = 0;
  }

  resetRecordingCounters(): void {
    this.recordingChunkCount = 0;
    this.recordingByteCount = 0;
  }

  addRecordingChunk(bytes: Uint8Array): void {
    this.recordingChunkCount += 1;
    this.recordingByteCount += bytes.byteLength;
  }

  get pendingByteCount(): number {
    return this.pendingBytes;
  }

  drainPending(
    session: RealtimeCloudSession | null,
    append: (bytes: Uint8Array) => Error | null,
    onDroppedAudio: () => void
  ): Error | null {
    if (!session) {
      this.resetPending();
      return null;
    }

    for (const bytes of this.pendingBuffer) {
      const error = append(bytes);
      if (error) {
        this.resetPending();
        return error;
      }
    }

    if (this.pendingDroppedBytes > 0) {
      onDroppedAudio();
    }

    this.resetPending();
    return null;
  }

  appendFallbackWav(session: RealtimeCloudSession, wavBytes: Uint8Array | undefined): void {
    if (!wavBytes || wavBytes.byteLength === 0 || session.getAudioDiagnostics().providerAppendedBytes > 0) {
      return;
    }

    const pcm16Audio = wavToMonoPcm16(wavBytes, openAiRealtimeAudioConfig.sampleRateHz);

    for (let offset = 0; offset < pcm16Audio.byteLength; offset += realtimeFallbackAppendChunkBytes) {
      const end = Math.min(offset + realtimeFallbackAppendChunkBytes, pcm16Audio.byteLength);
      const alignedEnd = end % 2 === 0 ? end : end - 1;

      if (alignedEnd > offset) {
        session.appendPcm16Audio(pcm16Audio.slice(offset, alignedEnd));
      }
    }
  }

  private bufferPending(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
      return;
    }

    this.pendingBuffer.push(bytes);
    this.pendingBytes += bytes.byteLength;

    while (this.pendingBytes > this.pendingBufferLimitBytes) {
      const removed = this.pendingBuffer.shift();
      const removedBytes = removed?.byteLength ?? 0;
      this.pendingBytes -= removedBytes;
      this.pendingDroppedBytes += removedBytes;
    }
  }
}
