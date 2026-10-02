import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  isLlmCleanupBackendPreference,
  llmModelCatalog,
  type LlmCleanupStatus
} from "../../../shared/llm-cleanup";
import { type AppSettings } from "../../../shared/settings";

// Settings rows for local AI cleanup. Owns its install/status state so the rest of the app only sees
// the three settings fields.
export function ReleaseCleanupSettings({
  settings,
  updateSettings
}: {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}): ReactElement {
  const [status, setStatus] = useState<LlmCleanupStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changedAt, setChangedAt] = useState(0);

  const refresh = useCallback(async () => {
    setStatus(await window.voxtype.llmCleanup.getStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, settings.llmCleanupEnabled, settings.llmCleanupModelId, settings.llmCleanupBackend]);

  // The server loads the model in the background after a change; poll until it settles. After idle
  // time it is stopped on purpose and loads again when a recording starts, so "stopped" alone is final.
  useEffect(() => {
    const justChanged = Date.now() - changedAt < 10_000;
    if (status?.server !== "starting" && !(justChanged && status?.enabled && status.server === "stopped")) {
      return;
    }
    const timer = window.setTimeout(() => void refresh(), 1_000);
    return () => { window.clearTimeout(timer); };
  }, [refresh, status, changedAt]);

  async function applyAndInstall(patch: Partial<AppSettings>): Promise<void> {
    setError(null);
    setChangedAt(Date.now());
    await updateSettings(patch);
    const next = await window.voxtype.llmCleanup.getStatus();
    setStatus(next);

    if (!(patch.llmCleanupEnabled ?? settings.llmCleanupEnabled) || (next.runtime.status === "installed" && next.model.status === "downloaded")) {
      return;
    }

    setInstalling(true);
    try {
      setStatus(await window.voxtype.llmCleanup.install());
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
      if (patch.llmCleanupEnabled) {
        await updateSettings({ llmCleanupEnabled: false });
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <>
      <label className="setting-row">
        <span>
          <strong>Clean up dictation with local AI</strong>
          <small>{installing ? `Downloading ${downloadLabel(status)}...` : error ?? statusLabel(status)}</small>
        </span>
        <input
          checked={settings.llmCleanupEnabled}
          disabled={installing}
          type="checkbox"
          onChange={(event) => void applyAndInstall({ llmCleanupEnabled: event.target.checked })}
        />
      </label>
      {settings.llmCleanupEnabled ? (
        <>
          <label className="setting-row">
            <span>
              <strong>AI cleanup model</strong>
              <small>Auto uses Qwen3.5 4B with a GPU and Qwen3.5 2B without one.</small>
            </span>
            <select
              disabled={installing}
              value={settings.llmCleanupModelId}
              onChange={(event) => void applyAndInstall({ llmCleanupModelId: event.target.value })}
            >
              <option value="auto">Auto</option>
              {llmModelCatalog.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.sizeLabel})
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>AI cleanup hardware</strong>
              <small>The GPU runs through Vulkan and works with NVIDIA, AMD and Intel graphics.</small>
            </span>
            <select
              disabled={installing}
              value={settings.llmCleanupBackend}
              onChange={(event) => {
                const value = event.target.value;
                if (isLlmCleanupBackendPreference(value)) {
                  void applyAndInstall({ llmCleanupBackend: value });
                }
              }}
            >
              <option value="auto">Auto</option>
              <option value="vulkan">GPU</option>
              <option value="cpu">CPU</option>
            </select>
          </label>
        </>
      ) : null}
    </>
  );
}

function statusLabel(status: LlmCleanupStatus | null): string {
  if (!status) {
    return "Removes filler words and self-corrections, fixes punctuation and formats lists. Runs on this computer.";
  }

  const where = status.backend === "vulkan" ? "GPU" : "CPU";

  if (!status.enabled) {
    return `Removes filler words and self-corrections, fixes punctuation and formats lists. Runs on this computer (${where}).`;
  }

  if (status.runtime.status !== "installed" || status.model.status !== "downloaded") {
    return `Not installed. Needs a one-time download of ${downloadLabel(status)}.`;
  }

  if (status.server === "error") {
    return `Could not start: ${status.error ?? "unknown error"}. Dictation still works without cleanup.`;
  }

  if (status.server === "ready") {
    return `Ready. ${status.model.name} on ${where}. Set an app profile's style to Raw to skip cleanup there.`;
  }

  if (status.server === "stopped") {
    return `Ready. ${status.model.name} on ${where} loads when you start dictating and unloads after 15 idle minutes.`;
  }

  return `Starting ${status.model.name} on ${where}...`;
}

function downloadLabel(status: LlmCleanupStatus | null): string {
  if (!status) {
    return "the AI runtime and model";
  }

  return status.runtime.status === "installed" ? status.model.sizeLabel : `${status.model.sizeLabel} plus the runtime`;
}
