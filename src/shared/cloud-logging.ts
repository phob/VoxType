import { type AsrProviderId, type DictationModeId } from "./asr";

export type CloudDictationLogInput = {
  providerId: AsrProviderId;
  modelId: string;
  modeId: DictationModeId;
  durationMs: number;
  status: "started" | "completed" | "failed" | "cancelled";
  errorCode?: string | null;
};

export type CloudDictationLogEntry = CloudDictationLogInput & {
  createdAt: string;
};

const sensitiveKeys = [
  "apiKey",
  "authorization",
  "bearer",
  "credential",
  "secret",
  "audio",
  "pcm",
  "wav",
  "prompt",
  "promptPack",
  "transcript",
  "text",
  "screenshot",
  "image",
  "ocr",
  "targetContent",
  "response"
];

export function createCloudDictationLogEntry(
  input: CloudDictationLogInput,
  now = new Date()
): CloudDictationLogEntry {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    modeId: input.modeId,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    status: input.status,
    errorCode: sanitizeErrorCode(input.errorCode),
    createdAt: now.toISOString()
  };
}

export function assertCloudDictationLogIsMetadataOnly(entry: Record<string, unknown>): void {
  for (const key of Object.keys(entry)) {
    const normalized = key.toLowerCase();

    if (sensitiveKeys.some((sensitive) => normalized.includes(sensitive.toLowerCase()))) {
      throw new Error(`Cloud Dictation logs metadata only; refusing sensitive field: ${key}`);
    }
  }
}

function sanitizeErrorCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/[^a-z0-9_.:/-]/gi, "").slice(0, 120) || null;
}
