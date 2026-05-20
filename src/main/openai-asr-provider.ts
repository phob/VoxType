import { type AsrResult, type FileAsrProvider, type FileAsrRequest } from "../shared/asr";
import { classifyOpenAiError, formatOpenAiFriendlyError } from "../shared/openai-errors";
import { getProviderLanguageHint } from "../shared/provider-language";
import { OpenAiCredentialStore } from "./openai-credential-store";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

export class OpenAiFileAsrProvider implements FileAsrProvider {
  readonly providerId = "openai" as const;

  constructor(private readonly credentials: OpenAiCredentialStore) {}

  async testConnection(modelId: string): Promise<{ ok: boolean; message: string }> {
    const apiKey = (await this.credentials.getApiKey())?.trim() ?? null;

    if (!apiKey) {
      return { ok: false, message: "OpenAI API key is required before testing Cloud Dictation." };
    }

    const response = await fetch(`${OPENAI_MODELS_URL}/${encodeURIComponent(modelId)}`, {
      headers: { Authorization: buildOpenAiAuthorizationHeader(apiKey) }
    });

    if (!response.ok) {
      return { ok: false, message: await formatOpenAiError(response) };
    }

    return { ok: true, message: `${modelId} is available for this API key.` };
  }

  async transcribeFile(request: FileAsrRequest): Promise<AsrResult> {
    const apiKey = (await this.credentials.getApiKey())?.trim() ?? null;

    if (!apiKey) {
      throw new Error("OpenAI API key is required before Cloud Dictation can start.");
    }

    const startedAt = Date.now();
    const form = new FormData();
    form.set("model", request.mode.modelId);
    form.set("file", new Blob([copyAudioBytesForUpload(request.audioBytes)], { type: "audio/wav" }), "dictation.wav");

    const languageHint = getProviderLanguageHint(this.providerId, request.language);

    if (languageHint.parameterValue) {
      form.set("language", languageHint.parameterValue);
    }

    if (request.promptPack?.text) {
      form.set("prompt", request.promptPack.text);
    }

    const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: buildOpenAiAuthorizationHeader(apiKey)
      },
      body: form
    });

    if (!response.ok) {
      throw new Error(await formatOpenAiError(response));
    }

    const payload = await response.json() as { text?: unknown };
    const providerText = typeof payload.text === "string" ? payload.text.trim() : "";

    if (!providerText) {
      throw new Error("OpenAI returned no transcript text.");
    }

    return {
      providerId: this.providerId,
      modelId: request.mode.modelId,
      modeId: request.mode.id,
      providerText,
      durationMs: Date.now() - startedAt
    };
  }
}

function buildOpenAiAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey.trim()}`;
}

function copyAudioBytesForUpload(audioBytes: Uint8Array): ArrayBuffer {
  // Copy processed WAV bytes at the provider boundary so later local mutations cannot affect the upload body.
  const copy = new Uint8Array(audioBytes.byteLength);
  copy.set(audioBytes);
  return copy.buffer;
}

async function formatOpenAiError(response: Response): Promise<string> {
  let payload: { error?: { code?: unknown; type?: unknown; message?: unknown } } = {};

  try {
    payload = await response.json() as { error?: { code?: unknown; type?: unknown; message?: unknown } };
  } catch {
    // Keep metadata-only error details; never include provider response bodies because they may echo text.
  }

  return formatOpenAiFriendlyError(classifyOpenAiError({
    status: response.status,
    statusText: response.statusText,
    code: typeof payload.error?.code === "string" ? payload.error.code : null,
    type: typeof payload.error?.type === "string" ? payload.error.type : null,
    message: typeof payload.error?.message === "string" ? payload.error.message : null
  }));
}
