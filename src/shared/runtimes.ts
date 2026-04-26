export type WhisperRuntimeBackend = "cpu" | "cuda" | "vulkan";
export type WhisperRuntimePreference = "auto" | WhisperRuntimeBackend;
export type WhisperRuntimeStatus = "not-installed" | "installed" | "unavailable";

export type WhisperRuntime = {
  id: string;
  name: string;
  version: string;
  backend: WhisperRuntimeBackend;
  platform: string;
  archiveName: string | null;
  url: string | null;
  managed: boolean;
  status: WhisperRuntimeStatus;
  executablePath: string | null;
  notes: string;
};

export type WhisperRuntimeCatalogItem = Omit<WhisperRuntime, "status" | "executablePath">;

export const whisperRuntimePreferenceValues = ["auto", "cpu", "cuda", "vulkan"] as const;

export const whisperRuntimeCatalog: WhisperRuntimeCatalogItem[] = [
  {
    id: "whisper.cpp-cpu-x64",
    name: "whisper.cpp CPU x64",
    version: "v1.8.4",
    backend: "cpu",
    platform: "Windows x64",
    archiveName: "whisper-bin-x64.zip",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip",
    managed: true,
    notes: "Official CPU runtime. Reliable fallback for all Windows x64 machines."
  },
  {
    id: "whisper.cpp-cuda-12.4-x64",
    name: "whisper.cpp CUDA 12.4 x64",
    version: "v1.8.4",
    backend: "cuda",
    platform: "Windows x64 NVIDIA",
    archiveName: "whisper-cublas-12.4.0-bin-x64.zip",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-cublas-12.4.0-bin-x64.zip",
    managed: true,
    notes: "Official CUDA runtime for recent NVIDIA drivers. Preferred GPU runtime."
  },
  {
    id: "whisper.cpp-cuda-11.8-x64",
    name: "whisper.cpp CUDA 11.8 x64",
    version: "v1.8.4",
    backend: "cuda",
    platform: "Windows x64 NVIDIA",
    archiveName: "whisper-cublas-11.8.0-bin-x64.zip",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-cublas-11.8.0-bin-x64.zip",
    managed: true,
    notes: "Official CUDA runtime for older NVIDIA driver stacks."
  },
  {
    id: "whisper.cpp-vulkan-x64",
    name: "whisper.cpp Vulkan x64",
    version: "v1.8.4",
    backend: "vulkan",
    platform: "Windows x64 Vulkan",
    archiveName: null,
    url: null,
    managed: false,
    notes: "Supported runtime slot for a Vulkan build. ggml-org v1.8.4 does not publish a Windows Vulkan zip, so install uses a custom executable for now."
  }
];

export function isWhisperRuntimePreference(
  value: unknown
): value is WhisperRuntimePreference {
  return (
    typeof value === "string" &&
    whisperRuntimePreferenceValues.includes(value as WhisperRuntimePreference)
  );
}

export function getRuntimeById(id: string): WhisperRuntimeCatalogItem | undefined {
  return whisperRuntimeCatalog.find((runtime) => runtime.id === id);
}
