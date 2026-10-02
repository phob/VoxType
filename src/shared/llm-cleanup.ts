// Catalog and status types for LLM transcript cleanup: local (llama.cpp `llama-server` + a small GGUF model)
// or a cloud model through the user's own OpenAI or Anthropic API key.

/** Where cleanup runs. */
export type LlmCleanupProvider = "local" | "openai" | "anthropic";
export type CloudCleanupProvider = Exclude<LlmCleanupProvider, "local">;

export const llmCleanupProviderValues = ["local", "openai", "anthropic"] as const;

/**
 * How much cleanup may change. "light" keeps the spoken words (fillers, self-corrections, punctuation);
 * "rewrite" also fixes grammar, word choice and phrasing, like an editor would.
 */
export type CleanupLevel = "light" | "rewrite";

export const cleanupLevelValues = ["light", "rewrite"] as const;

export function isLlmCleanupProvider(value: unknown): value is LlmCleanupProvider {
  return typeof value === "string" && (llmCleanupProviderValues as readonly string[]).includes(value);
}

export function isCleanupLevel(value: unknown): value is CleanupLevel {
  return typeof value === "string" && (cleanupLevelValues as readonly string[]).includes(value);
}

export interface CloudCleanupModel {
  id: string;
  provider: CloudCleanupProvider;
  name: string;
  description: string;
  /** OpenAI reasoning models: "none" answers without a reasoning pass. Omitted for models without the parameter. */
  reasoningEffort?: "none" | "minimal" | "low";
  /** Anthropic: how to keep thinking short. "off" sends no thinking config (models without thinking by default). */
  anthropicThinking?: "off" | "between-tools" | "low-effort";
}

// Default per provider is chosen from the cleanup E2E corpus (bun run e2e:cleanup --provider ...).
export const cloudCleanupModelCatalog: CloudCleanupModel[] = [
  { id: "gpt-6-luna", provider: "openai", name: "GPT-6 Luna", description: "Best OpenAI rewrites in our tests, and the cheapest.", reasoningEffort: "none" },
  { id: "gpt-5.4-mini", provider: "openai", name: "GPT-5.4 mini", description: "Slightly faster; misses some self-corrections.", reasoningEffort: "none" },
  { id: "gpt-4.1-mini", provider: "openai", name: "GPT-4.1 mini", description: "Older; sometimes repeats the text before the cursor." },
  { id: "claude-haiku-4-5", provider: "anthropic", name: "Claude Haiku 4.5", description: "Fast and cheap.", anthropicThinking: "off" },
  { id: "claude-sonnet-5-5", provider: "anthropic", name: "Claude Sonnet 5.5", description: "Strong rewrites, thinking off.", anthropicThinking: "between-tools" },
  { id: "claude-opus-5-5", provider: "anthropic", name: "Claude Opus 5.5", description: "Best quality; always thinks, so slowest.", anthropicThinking: "low-effort" }
];

export const defaultCloudCleanupModelIds: Record<CloudCleanupProvider, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-sonnet-5-5"
};

export function getCloudCleanupModel(provider: CloudCleanupProvider, id: string): CloudCleanupModel {
  const model =
    cloudCleanupModelCatalog.find((item) => item.provider === provider && item.id === id) ??
    cloudCleanupModelCatalog.find((item) => item.id === defaultCloudCleanupModelIds[provider]);

  if (!model) {
    throw new Error(`Cloud cleanup catalog is missing ${defaultCloudCleanupModelIds[provider]}.`);
  }

  return model;
}

export function isCloudCleanupModelId(provider: CloudCleanupProvider, value: unknown): value is string {
  return typeof value === "string" && cloudCleanupModelCatalog.some((item) => item.provider === provider && item.id === value);
}

/**
 * Cloud cleanup budget: a network round trip plus output time that grows with the dictation. Past it the
 * deterministic cleanup is inserted instead.
 */
export function cloudCleanupTimeoutMs(text: string): number {
  return Math.min(30_000, 8_000 + text.length * 10);
}

export type LlamaRuntimeBackend = "cpu" | "vulkan";
export type LlmCleanupBackendPreference = "auto" | LlamaRuntimeBackend;

export const llmCleanupBackendPreferenceValues = ["auto", "vulkan", "cpu"] as const;

export interface LlamaRuntimeCatalogItem {
  id: string;
  name: string;
  version: string;
  backend: LlamaRuntimeBackend;
  archiveName: string;
  url: string;
}

export interface LlamaRuntime extends LlamaRuntimeCatalogItem {
  status: "installed" | "not-installed";
  executablePath: string | null;
}

// llama.cpp publishes binaries on bNNNNN tags. The zip ships llama-server.exe as a small stub next to
// the DLLs it loads, so the whole extracted folder is kept together.
const llamaBuild = "b11325";

export const llamaRuntimeCatalog: LlamaRuntimeCatalogItem[] = [
  {
    id: "llama.cpp-vulkan-x64",
    name: "llama.cpp Vulkan x64",
    version: llamaBuild,
    backend: "vulkan",
    archiveName: `llama-${llamaBuild}-bin-win-vulkan-x64.zip`,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${llamaBuild}/llama-${llamaBuild}-bin-win-vulkan-x64.zip`
  },
  {
    id: "llama.cpp-cpu-x64",
    name: "llama.cpp CPU x64",
    version: llamaBuild,
    backend: "cpu",
    archiveName: `llama-${llamaBuild}-bin-win-cpu-x64.zip`,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${llamaBuild}/llama-${llamaBuild}-bin-win-cpu-x64.zip`
  }
];

export interface LlmModelCatalogItem {
  id: string;
  name: string;
  fileName: string;
  url: string;
  sizeLabel: string;
  /** Approximate VRAM for weights plus a 4k context, used for the fit hint. */
  minimumVramMb: number;
  description: string;
}

export interface LlmModel extends LlmModelCatalogItem {
  status: "downloaded" | "not-downloaded";
  localPath: string;
}

export const llmModelCatalog: LlmModelCatalogItem[] = [
  {
    id: "qwen3.5-2b-q4km",
    name: "Qwen3.5 2B",
    fileName: "Qwen3.5-2B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
    sizeLabel: "1.28 GB",
    minimumVramMb: 1_800,
    description: "Fast enough without a GPU. Misses some German self-corrections."
  },
  {
    id: "qwen3.5-4b-q4km",
    name: "Qwen3.5 4B",
    fileName: "Qwen3.5-4B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    sizeLabel: "2.74 GB",
    minimumVramMb: 3_400,
    description: "Best cleanup quality. Recommended with a GPU."
  }
];

// Chosen with the cleanup E2E corpus (bun run e2e:cleanup): on a GPU the 4B model passes the most
// fixtures at ~140 ms p50; on CPU it is ~1 s p50 / ~5 s p95, so CPU-only machines get the 2B model.
export const gpuLlmCleanupModelId = "qwen3.5-4b-q4km";
export const cpuLlmCleanupModelId = "qwen3.5-2b-q4km";

/** "auto" (picks the model for the resolved backend) or a catalog model id. */
export type LlmCleanupModelPreference = string;

/** A cleanup that takes longer than this falls back to the uncleaned text. Includes waiting for a cold server. */
export const llmCleanupTimeoutMs = 6_000;

export function getLlmModelById(id: string): LlmModelCatalogItem | undefined {
  return llmModelCatalog.find((model) => model.id === id);
}

export function isLlmCleanupModelPreference(value: unknown): value is LlmCleanupModelPreference {
  return typeof value === "string" && (value === "auto" || llmModelCatalog.some((model) => model.id === value));
}

export function resolveLlmCleanupModel(preference: LlmCleanupModelPreference, backend: LlamaRuntimeBackend): LlmModelCatalogItem {
  const fallbackId = backend === "vulkan" ? gpuLlmCleanupModelId : cpuLlmCleanupModelId;
  const model = getLlmModelById(preference === "auto" ? fallbackId : preference) ?? getLlmModelById(fallbackId);

  if (!model) {
    throw new Error(`LLM cleanup model catalog is missing ${fallbackId}.`);
  }

  return model;
}

export function isLlmCleanupBackendPreference(value: unknown): value is LlmCleanupBackendPreference {
  return typeof value === "string" && (llmCleanupBackendPreferenceValues as readonly string[]).includes(value);
}

export type LlmCleanupServerState = "stopped" | "starting" | "ready" | "error";

export interface LlmCleanupStatus {
  enabled: boolean;
  provider: LlmCleanupProvider;
  level: CleanupLevel;
  /** For a cloud provider: the model in use and whether its API key is available. */
  cloud: { model: CloudCleanupModel; hasApiKey: boolean; blockedByOfflineMode: boolean } | null;
  backend: LlamaRuntimeBackend;
  runtime: LlamaRuntime;
  model: LlmModel;
  server: LlmCleanupServerState;
  error: string | null;
}

export interface LlmCleanupTestResult {
  text: string;
  cleanup: TranscriptCleanup | null;
}

/** What happened to one dictation's cleanup, stored in transcript history. */
export interface TranscriptCleanup {
  status: "applied" | "unchanged" | "rejected" | "failed";
  /** Why the cleaned text was not used (rejected/failed). */
  reason?: string;
  modelId: string;
  /** Missing in entries from before cloud cleanup: those ran locally at the light level. */
  provider?: LlmCleanupProvider;
  level?: CleanupLevel;
  durationMs: number;
  /** Text before cleanup, kept when cleanup changed it. */
  inputText?: string;
  /** The model's output when the guard rejected it, for diagnosis. */
  rejectedText?: string;
  /** The first answer was rejected and the model was asked once more. */
  retried?: boolean;
}
