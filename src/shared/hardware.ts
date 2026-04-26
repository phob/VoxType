import { whisperModelCatalog } from "./models";

export type GpuVendor = "nvidia" | "amd" | "intel" | "unknown";

export type GpuDevice = {
  name: string;
  vendor: GpuVendor;
  dedicatedVramMb: number | null;
  driverVersion?: string;
  source: "nvidia-smi" | "windows-video-controller";
  supportsCuda: boolean;
  supportsVulkan: boolean | null;
};

export type ModelGpuFit = {
  modelId: string;
  requiredVramMb: number;
  status: "fits" | "low-vram" | "unknown-vram" | "no-gpu";
  note: string;
};

export type HardwareAccelerationReport = {
  checkedAt: string;
  gpus: GpuDevice[];
  bestGpu: GpuDevice | null;
  canUseGpuRuntime: boolean;
  recommendedBackend: "cuda" | "vulkan" | "cpu";
  modelFits: ModelGpuFit[];
  notes: string[];
};

const vramSafetyMarginMb = 512;

export function buildHardwareAccelerationReport(gpus: GpuDevice[]): HardwareAccelerationReport {
  const bestGpu = [...gpus].sort((left, right) => {
    const leftVram = left.dedicatedVramMb ?? -1;
    const rightVram = right.dedicatedVramMb ?? -1;
    return rightVram - leftVram;
  })[0] ?? null;
  const recommendedBackend = bestGpu?.supportsCuda
    ? "cuda"
    : bestGpu?.supportsVulkan
      ? "vulkan"
      : "cpu";
  const canUseGpuRuntime = recommendedBackend !== "cpu";

  return {
    checkedAt: new Date().toISOString(),
    gpus,
    bestGpu,
    canUseGpuRuntime,
    recommendedBackend,
    modelFits: whisperModelCatalog.map((model) => {
      const requiredVramMb = model.minimumVramMb + vramSafetyMarginMb;

      if (!bestGpu) {
        return {
          modelId: model.id,
          requiredVramMb,
          status: "no-gpu",
          note: "No supported GPU was detected."
        };
      }

      if (bestGpu.dedicatedVramMb === null) {
        return {
          modelId: model.id,
          requiredVramMb,
          status: "unknown-vram",
          note: "GPU detected, but VRAM could not be read."
        };
      }

      const fits = bestGpu.dedicatedVramMb >= requiredVramMb;

      return {
        modelId: model.id,
        requiredVramMb,
        status: fits ? "fits" : "low-vram",
        note: fits
          ? `Fits ${bestGpu.name} with a ${vramSafetyMarginMb} MB safety margin.`
          : `Needs about ${requiredVramMb} MB VRAM including safety margin.`
      };
    }),
    notes: [
      "Whisper GPU use requires a GPU-enabled runtime binary; the current managed VoxType runtime is CPU-only.",
      "CUDA is preferred for NVIDIA GPUs. Vulkan is the cross-vendor fallback once VoxType ships a Vulkan build.",
      "VRAM checks are conservative estimates for model loading, not a promise of exact throughput."
    ]
  };
}
