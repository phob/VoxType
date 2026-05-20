import { app } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { type UpdateStatus } from "../shared/updates";

const latestReleaseUrl = "https://api.github.com/repos/phob/VoxType/releases/latest";
const updateRequestTimeoutMs = 15000;
const staleCheckingTimeoutMs = 30000;
const updateDirectory = join(app.getPath("userData"), "updates");

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

interface UpdateCandidate {
  version: string;
  releaseName: string | null;
  releaseUrl: string | null;
  installerName: string;
  installerUrl: string;
}

export class UpdateService {
  private status: UpdateStatus = {
    available: false,
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseName: null,
    releaseUrl: null,
    installerName: null,
    state: "idle",
    error: null
  };
  private candidate: UpdateCandidate | null = null;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private checkingStartedAt: number | null = null;
  private readonly updateCleanupPromise: Promise<void>;

  constructor() {
    this.updateCleanupPromise = cleanupUpdateDirectory();
  }

  getStatus(): UpdateStatus {
    if (
      this.status.state === "checking" &&
      this.checkingStartedAt !== null &&
      Date.now() - this.checkingStartedAt > staleCheckingTimeoutMs
    ) {
      this.status = {
        ...this.status,
        available: false,
        state: "error",
        error: "Update check timed out."
      };
      this.checkPromise = null;
      this.checkingStartedAt = null;
    }

    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.checkPromise = this.performCheck();
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private async performCheck(): Promise<UpdateStatus> {
    this.status = {
      ...this.status,
      state: "checking",
      error: null
    };
    this.checkingStartedAt = Date.now();

    try {
      const release = await withTimeout(
        fetchJson<GitHubRelease>(latestReleaseUrl),
        updateRequestTimeoutMs,
        "Update check timed out."
      );
      const candidate = releaseToCandidate(release);
      const currentVersion = app.getVersion();
      const available = Boolean(candidate && isNewerVersion(candidate.version, currentVersion));

      this.candidate = available ? candidate : null;
      this.status = {
        available,
        currentVersion,
        latestVersion: candidate?.version ?? null,
        releaseName: candidate?.releaseName ?? null,
        releaseUrl: candidate?.releaseUrl ?? null,
        installerName: candidate?.installerName ?? null,
        state: available ? "available" : "idle",
        error: null
      };
    } catch (error) {
      this.status = {
        ...this.status,
        available: false,
        state: "error",
        error: formatUpdateError(error)
      };
    } finally {
      this.checkingStartedAt = null;
    }

    return this.status;
  }

  async install(): Promise<UpdateStatus> {
    const candidate = this.candidate ?? (await this.check(), this.candidate);

    if (!candidate) {
      return this.status;
    }

    if (process.platform !== "win32") {
      throw new Error("Automatic installer updates are currently only supported on Windows.");
    }

    this.status = {
      ...this.status,
      state: "downloading",
      error: null
    };

    let temporaryInstallerPath: string | null = null;

    try {
      await this.updateCleanupPromise;
      const installerPath = join(updateDirectory, candidate.installerName);
      temporaryInstallerPath = `${installerPath}.download`;

      await mkdir(updateDirectory, { recursive: true });
      await rm(temporaryInstallerPath, { force: true });
      await downloadFile(candidate.installerUrl, temporaryInstallerPath);
      await rm(installerPath, { force: true });
      await rename(temporaryInstallerPath, installerPath);

      this.status = {
        ...this.status,
        state: "installing"
      };

      const child = spawn(installerPath, [], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();

      app.quit();
    } catch (error) {
      if (temporaryInstallerPath) {
        await rm(temporaryInstallerPath, { force: true }).catch(() => undefined);
      }

      this.status = {
        ...this.status,
        state: "error",
        error: formatUpdateError(error)
      };
    }

    return this.status;
  }
}

async function cleanupUpdateDirectory(): Promise<void> {
  await rm(updateDirectory, { recursive: true, force: true }).catch(() => undefined);
}

function releaseToCandidate(release: GitHubRelease): UpdateCandidate | null {
  const version = versionFromTag(release.tag_name);
  const installer = release.assets?.find((asset) =>
    /^VoxType-Setup-.+-x64\.exe$/i.test(asset.name)
  );

  if (!version || !installer?.browser_download_url) {
    return null;
  }

  return {
    version,
    releaseName: release.name ?? null,
    releaseUrl: release.html_url ?? null,
    installerName: installer.name,
    installerUrl: installer.browser_download_url
  };
}

function versionFromTag(tag: string | undefined): string | null {
  const normalized = tag?.trim().replace(/^voxtype-/i, "").replace(/^v/i, "");
  return normalized && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : null;
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);

  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) {
      return true;
    }

    if (candidateParts[index] < currentParts[index]) {
      return false;
    }
  }

  return false;
}

function parseVersion(version: string): [number, number, number] {
  const stableVersion = version.replace(/^voxtype-/i, "").replace(/^v/i, "").replace(/[-+].*$/, "");
  const [major = "0", minor = "0", patch = "0"] = stableVersion.split(".");
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: T): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const request = get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "User-Agent": "VoxType-Updater"
        }
      },
      (response) => {
        response.setTimeout(updateRequestTimeoutMs, () => {
          response.destroy(new Error("Update check timed out."));
        });

        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const redirect = response.headers.location;
          response.resume();
          if (redirect) {
            fetchJson<T>(redirect).then(resolveOnce, rejectOnce);
            return;
          }
        }

        if (response.statusCode !== 200) {
          response.resume();
          rejectOnce(new Error(`GitHub returned ${String(response.statusCode ?? "an unknown status")}.`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolveOnce(JSON.parse(body) as T);
          } catch (error) {
            rejectOnce(error);
          }
        });
        response.on("error", rejectOnce);
      }
    );

    request.setTimeout(updateRequestTimeoutMs, () => {
      request.destroy(new Error("Update check timed out."));
    });
    request.on("error", rejectOnce);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        headers: {
          "User-Agent": "VoxType-Updater"
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const redirect = response.headers.location;
          response.resume();
          if (redirect) {
            downloadFile(redirect, destination).then(resolve, reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download returned ${String(response.statusCode ?? "an unknown status")}.`));
          return;
        }

        const file = createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => {
          file.close(() => { resolve(); });
        });
        file.on("error", reject);
      }
    );

    request.on("error", reject);
  });
}

function formatUpdateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
