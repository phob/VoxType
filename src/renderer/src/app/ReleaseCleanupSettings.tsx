import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  cloudCleanupModelCatalog,
  isCleanupLevel,
  isLlmCleanupBackendPreference,
  isLlmCleanupProvider,
  llmModelCatalog,
  type CloudCleanupProvider,
  type LlmCleanupStatus,
  type LlmCleanupTestResult
} from "../../../shared/llm-cleanup";
import { type OpenAiCredentialStatus } from "../../../shared/openai-credentials";
import { type AppSettings } from "../../../shared/settings";

const providerNames: Record<CloudCleanupProvider, string> = { openai: "OpenAI", anthropic: "Anthropic" };

// Settings rows for AI cleanup. Owns its install/status, API key and try-it state so the rest of the app
// only sees the settings fields.
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
  const cloudProvider = settings.llmCleanupProvider === "local" ? null : settings.llmCleanupProvider;

  const refresh = useCallback(async () => {
    setStatus(await window.voxtype.llmCleanup.getStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [
    refresh,
    settings.llmCleanupEnabled,
    settings.llmCleanupModelId,
    settings.llmCleanupBackend,
    settings.llmCleanupProvider,
    settings.llmCleanupLevel,
    settings.llmCleanupOpenAiModelId,
    settings.llmCleanupAnthropicModelId,
    settings.offlineMode
  ]);

  // The server loads the model in the background after a change; poll until it settles. After idle
  // time it is stopped on purpose and loads again when a recording starts, so "stopped" alone is final.
  useEffect(() => {
    const justChanged = Date.now() - changedAt < 10_000;
    if (status?.provider !== "local" || (status.server !== "starting" && !(justChanged && status.enabled && status.server === "stopped"))) {
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

    if (
      !(patch.llmCleanupEnabled ?? settings.llmCleanupEnabled) ||
      next.provider !== "local" ||
      (next.runtime.status === "installed" && next.model.status === "downloaded")
    ) {
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
          <strong>Clean up dictation with AI</strong>
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
              <strong>AI cleanup editing</strong>
              <small>
                {settings.llmCleanupLevel === "rewrite"
                  ? "Fixes grammar, word choice and phrasing. Keeps meaning, names and numbers."
                  : "Removes fillers and self-corrections, fixes punctuation, formats lists."}
              </small>
            </span>
            <select
              disabled={installing}
              value={settings.llmCleanupLevel}
              onChange={(event) => {
                const value = event.target.value;
                if (isCleanupLevel(value)) {
                  void applyAndInstall({ llmCleanupLevel: value });
                }
              }}
            >
              <option value="light">Light: keep my words</option>
              <option value="rewrite">Rewrite: fix grammar and phrasing</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>AI cleanup runs on</strong>
              <small>
                {cloudProvider
                  ? `Sends each dictation and the text before the cursor to ${providerNames[cloudProvider]}.`
                  : "Nothing leaves this computer."}
              </small>
            </span>
            <select
              disabled={installing}
              value={settings.llmCleanupProvider}
              onChange={(event) => {
                const value = event.target.value;
                if (isLlmCleanupProvider(value)) {
                  void applyAndInstall({ llmCleanupProvider: value });
                }
              }}
            >
              <option value="local">This computer</option>
              <option value="openai">OpenAI (API key)</option>
              <option value="anthropic">Anthropic (API key)</option>
            </select>
          </label>
          {cloudProvider ? (
            <CloudCleanupRows provider={cloudProvider} settings={settings} updateSettings={applyAndInstall} onKeyChange={refresh} />
          ) : (
            <LocalCleanupRows installing={installing} settings={settings} updateSettings={applyAndInstall} />
          )}
          <CleanupTryRow disabled={installing} />
        </>
      ) : null}
    </>
  );
}

function LocalCleanupRows({
  installing,
  settings,
  updateSettings
}: {
  installing: boolean;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}): ReactElement {
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>AI cleanup model</strong>
          <small>Auto uses Qwen3.5 4B with a GPU and Qwen3.5 2B without one. Small local models rewrite poorly.</small>
        </span>
        <select
          disabled={installing}
          value={settings.llmCleanupModelId}
          onChange={(event) => void updateSettings({ llmCleanupModelId: event.target.value })}
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
              void updateSettings({ llmCleanupBackend: value });
            }
          }}
        >
          <option value="auto">Auto</option>
          <option value="vulkan">GPU</option>
          <option value="cpu">CPU</option>
        </select>
      </label>
    </>
  );
}

function CloudCleanupRows({
  provider,
  settings,
  updateSettings,
  onKeyChange
}: {
  provider: CloudCleanupProvider;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onKeyChange: () => Promise<void>;
}): ReactElement {
  const credentials = credentialsFor(provider);
  const [keyStatus, setKeyStatus] = useState<OpenAiCredentialStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const models = cloudCleanupModelCatalog.filter((model) => model.provider === provider);
  const modelId = provider === "openai" ? settings.llmCleanupOpenAiModelId : settings.llmCleanupAnthropicModelId;
  const selectedModel = models.find((model) => model.id === modelId);

  useEffect(() => {
    setDraft("");
    setKeyError(null);
    void credentialsFor(provider).getStatus().then(setKeyStatus);
  }, [provider]);

  async function saveKey(apply: () => Promise<OpenAiCredentialStatus>): Promise<void> {
    setKeyError(null);
    try {
      setKeyStatus(await apply());
      setDraft("");
      await onKeyChange();
    } catch (saveError) {
      setKeyError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  return (
    <>
      <label className="setting-row">
        <span>
          <strong>AI cleanup model</strong>
          <small>{selectedModel?.description ?? ""}</small>
        </span>
        <select
          value={modelId}
          onChange={(event) =>
            void updateSettings(
              provider === "openai" ? { llmCleanupOpenAiModelId: event.target.value } : { llmCleanupAnthropicModelId: event.target.value }
            )
          }
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <div className="setting-row setting-row-wide">
        <span>
          <strong>{providerNames[provider]} API key</strong>
          <small>{keyError ?? keyStatusLabel(provider, keyStatus)}</small>
        </span>
        <div className="setting-actions setting-actions-with-input">
          <input
            aria-label={`${providerNames[provider]} API key`}
            autoComplete="off"
            placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
            type="password"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); }}
          />
          <button disabled={!draft.trim()} onClick={() => void saveKey(() => credentials.setApiKey(draft))} type="button">Save key</button>
          <button
            disabled={!keyStatus?.hasApiKey || keyStatus.source === "environment"}
            onClick={() => void saveKey(() => credentials.clearApiKey())}
            type="button"
          >Clear</button>
        </div>
      </div>
    </>
  );
}

function credentialsFor(provider: CloudCleanupProvider): typeof window.voxtype.anthropicCredentials {
  return provider === "openai" ? window.voxtype.openaiCredentials : window.voxtype.anthropicCredentials;
}

const sampleText = "um so I am working on this since two weeks and I become every day the same error, can you look on it until Friday";

function CleanupTryRow({ disabled }: { disabled: boolean }): ReactElement {
  const [text, setText] = useState(sampleText);
  const [result, setResult] = useState<LlmCleanupTestResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run(): Promise<void> {
    setRunning(true);
    try {
      setResult(await window.voxtype.llmCleanup.test(text));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="setting-row setting-row-wide">
      <span>
        <strong>Try AI cleanup</strong>
        <small>{running ? "Cleaning..." : result ? tryResultLabel(result) : "Paste a rough dictation to see what cleanup makes of it."}</small>
        {result ? <small className="cleanup-try-output">{result.text || "(nothing)"}</small> : null}
      </span>
      <div className="setting-actions setting-actions-with-input">
        <input aria-label="Text to clean up" value={text} onChange={(event) => { setText(event.target.value); }} />
        <button disabled={disabled || running || !text.trim()} onClick={() => void run()} type="button">Clean up</button>
      </div>
    </div>
  );
}

function tryResultLabel(result: LlmCleanupTestResult): string {
  const cleanup = result.cleanup;

  if (!cleanup) {
    return "AI cleanup is off.";
  }

  const took = `${cleanup.modelId}, ${(cleanup.durationMs / 1000).toFixed(1)} s`;

  if (cleanup.status === "failed" || cleanup.status === "rejected") {
    return `Not used (${cleanup.reason ?? cleanup.status}). Inserted text, ${took}:`;
  }

  return `${took}:`;
}

function keyStatusLabel(provider: CloudCleanupProvider, status: OpenAiCredentialStatus | null): string {
  if (!status) {
    return "";
  }

  if (status.source === "environment") {
    return `Using the ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} environment variable.`;
  }

  if (status.hasApiKey) {
    return provider === "openai"
      ? "Stored encrypted for this Windows account. Shared with Cloud Dictation."
      : "Stored encrypted for this Windows account.";
  }

  return status.encryptionAvailable ? "Not set. AI cleanup does nothing until a key is saved." : "Windows credential encryption is not available.";
}

function statusLabel(status: LlmCleanupStatus | null): string {
  if (!status) {
    return "Removes filler words and self-corrections, fixes punctuation and formats lists, or rewrites into fluent text.";
  }

  if (status.cloud) {
    const model = status.cloud.model.name;

    if (!status.enabled) {
      return `Cleans each dictation with ${model} through your API key.`;
    }
    if (status.cloud.blockedByOfflineMode) {
      return `Offline Mode is on, so ${model} is not used. Dictation still works without AI cleanup.`;
    }
    if (!status.cloud.hasApiKey) {
      return `Needs an API key for ${model}.`;
    }
    return `Ready. ${model} through your API key. Set an app profile's style to Raw to skip cleanup there.`;
  }

  const where = status.backend === "vulkan" ? "GPU" : "CPU";

  if (!status.enabled) {
    return `Removes filler words and self-corrections, fixes punctuation and formats lists. Runs on this computer (${where}) or with your OpenAI or Anthropic key.`;
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
