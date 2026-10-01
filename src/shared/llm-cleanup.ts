// Catalog and status types for local LLM transcript cleanup (llama.cpp `llama-server` + a small GGUF model).

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
  backend: LlamaRuntimeBackend;
  runtime: LlamaRuntime;
  model: LlmModel;
  server: LlmCleanupServerState;
  error: string | null;
}

/** What happened to one dictation's cleanup, stored in transcript history. */
export interface TranscriptCleanup {
  status: "applied" | "unchanged" | "rejected" | "failed";
  /** Why the cleaned text was not used (rejected/failed). */
  reason?: string;
  modelId: string;
  durationMs: number;
  /** Text before cleanup, kept when cleanup changed it. */
  inputText?: string;
  /** The model's output when the guard rejected it, for diagnosis. */
  rejectedText?: string;
}
