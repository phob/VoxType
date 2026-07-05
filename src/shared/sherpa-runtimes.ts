// Backend preference for the sherpa-onnx (Parakeet) engine. Deliberately NOT a
// superset with an "auto" that resolves to CUDA the way Whisper's runtime does:
// for Parakeet the default is always CPU and CUDA is an explicit opt-in
// (see planning/parakeet-phase1-plan.md §3.2).
export type SherpaRuntimeBackend = "cpu" | "cuda";
export type SherpaRuntimeStatus = "not-installed" | "installed" | "unavailable";

export interface SherpaRuntime {
  id: string;
  name: string;
  version: string;
  backend: SherpaRuntimeBackend;
  platform: string;
  archiveName: string | null;
  url: string | null;
  managed: boolean;
  status: SherpaRuntimeStatus;
  executablePath: string | null;
  notes: string;
}

export type SherpaRuntimeCatalogItem = Omit<SherpaRuntime, "status" | "executablePath">;

export const sherpaRuntimeBackends = ["cpu", "cuda"] as const;

// Pinned to sherpa-onnx v1.13.3 (verified 2026-07-05). Asset names confirmed
// against the GitHub release. The CPU build uses the statically-linked MSVC
// runtime (MT) so it does not require a VC++ redistributable on the target box.
export const sherpaRuntimeCatalog: SherpaRuntimeCatalogItem[] = [
  {
    id: "sherpa-cpu-x64",
    name: "sherpa-onnx CPU x64",
    version: "v1.13.3",
    backend: "cpu",
    platform: "Windows x64",
    archiveName: "sherpa-onnx-v1.13.3-win-x64-shared-MT-Release.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-v1.13.3-win-x64-shared-MT-Release.tar.bz2",
    managed: true,
    notes:
      "Default Parakeet runtime. INT8 CPU inference is already ~10x faster than Whisper for short utterances."
  },
  {
    id: "sherpa-cuda-12.x-x64",
    name: "sherpa-onnx CUDA 12.x x64",
    version: "v1.13.3",
    backend: "cuda",
    platform: "Windows x64 NVIDIA",
    archiveName: "sherpa-onnx-v1.13.3-cuda-12.x-cudnn-9.x-win-x64-cuda.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-v1.13.3-cuda-12.x-cudnn-9.x-win-x64-cuda.tar.bz2",
    managed: true,
    notes:
      "Opt-in NVIDIA runtime. Requires an NVIDIA GPU with CUDA 12.x + cuDNN 9.x runtime libraries available; otherwise transcription fails to start."
  }
];

export function isSherpaRuntimeBackend(value: unknown): value is SherpaRuntimeBackend {
  return typeof value === "string" && sherpaRuntimeBackends.includes(value as SherpaRuntimeBackend);
}

export function getSherpaRuntimeById(id: string): SherpaRuntimeCatalogItem | undefined {
  return sherpaRuntimeCatalog.find((runtime) => runtime.id === id);
}

export function getSherpaRuntimeForBackend(
  backend: SherpaRuntimeBackend
): SherpaRuntimeCatalogItem | undefined {
  return sherpaRuntimeCatalog.find((runtime) => runtime.backend === backend);
}
