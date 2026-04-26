import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildHardwareAccelerationReport,
  type GpuDevice,
  type GpuVendor,
  type HardwareAccelerationReport
} from "../shared/hardware";

const execFileAsync = promisify(execFile);

export class HardwareService {
  async getAccelerationReport(): Promise<HardwareAccelerationReport> {
    const [nvidiaGpus, windowsGpus] = await Promise.all([
      detectNvidiaGpus(),
      detectWindowsVideoControllers()
    ]);
    const gpus = mergeGpuDetections([...nvidiaGpus, ...windowsGpus]);

    return buildHardwareAccelerationReport(gpus);
  }
}

async function detectNvidiaGpus(): Promise<GpuDevice[]> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader,nounits"
    ]);

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = "NVIDIA GPU", memoryMb, driverVersion] = line
          .split(",")
          .map((part) => part.trim());

        return {
          name,
          vendor: "nvidia",
          dedicatedVramMb: parsePositiveInteger(memoryMb),
          driverVersion,
          source: "nvidia-smi",
          supportsCuda: true,
          supportsVulkan: true
        };
      });
  } catch {
    return [];
  }
}

async function detectWindowsVideoControllers(): Promise<GpuDevice[]> {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "Get-CimInstance Win32_VideoController",
        "Select-Object Name,AdapterRAM,DriverVersion",
        "ConvertTo-Json -Compress"
      ].join(" | ")
    ]);
    const parsed: unknown = JSON.parse(stdout);
    const controllers = Array.isArray(parsed) ? parsed : [parsed];

    return controllers
      .map((controller) => normalizeWindowsGpu(controller))
      .filter((gpu): gpu is GpuDevice => Boolean(gpu));
  } catch {
    return [];
  }
}

function normalizeWindowsGpu(controller: unknown): GpuDevice | null {
  if (!controller || typeof controller !== "object") {
    return null;
  }

  const record = controller as Record<string, unknown>;
  const name = typeof record.Name === "string" ? record.Name.trim() : "";

  if (!name) {
    return null;
  }

  const vendor = detectVendor(name);
  const adapterRam = typeof record.AdapterRAM === "number" ? record.AdapterRAM : null;
  const dedicatedVramMb = adapterRam && adapterRam > 0
    ? Math.round(adapterRam / 1024 / 1024)
    : null;
  const driverVersion =
    typeof record.DriverVersion === "string" ? record.DriverVersion.trim() : undefined;

  return {
    name,
    vendor,
    dedicatedVramMb,
    driverVersion,
    source: "windows-video-controller",
    supportsCuda: vendor === "nvidia",
    supportsVulkan: vendor === "nvidia" || vendor === "amd" || vendor === "intel" ? true : null
  };
}

function mergeGpuDetections(gpus: GpuDevice[]): GpuDevice[] {
  const byName = new Map<string, GpuDevice>();

  for (const gpu of gpus) {
    const key = gpu.name.toLowerCase();
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, gpu);
      continue;
    }

    byName.set(key, {
      ...existing,
      dedicatedVramMb: existing.dedicatedVramMb ?? gpu.dedicatedVramMb,
      driverVersion: existing.driverVersion ?? gpu.driverVersion,
      supportsCuda: existing.supportsCuda || gpu.supportsCuda,
      supportsVulkan: existing.supportsVulkan ?? gpu.supportsVulkan,
      source: existing.source === "nvidia-smi" ? existing.source : gpu.source
    });
  }

  return [...byName.values()];
}

function detectVendor(name: string): GpuVendor {
  if (/\bnvidia\b|\bgeforce\b|\brtx\b|\bgtx\b/i.test(name)) {
    return "nvidia";
  }

  if (/\bamd\b|\bradeon\b/i.test(name)) {
    return "amd";
  }

  if (/\bintel\b|\barc\b|\biris\b|\buhd\b/i.test(name)) {
    return "intel";
  }

  return "unknown";
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
