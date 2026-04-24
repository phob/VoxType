import { useEffect, useState } from "react";
import { type AppSettings, type InsertionMode } from "../../shared/settings";

type Capability = {
  title: string;
  description: string;
  status: "planned" | "next" | "later";
};

const capabilities: Capability[] = [
  {
    title: "Local Whisper dictation",
    description: "Record speech, transcribe locally, and insert text into the active Windows app.",
    status: "next"
  },
  {
    title: "Screen-aware dictionary",
    description: "Use OCR from screenshots as temporary vocabulary for names, codes, and visible UI terms.",
    status: "planned"
  },
  {
    title: "Windows insertion profiles",
    description: "Choose clipboard paste, keyboard emulation, or slower remote-safe typing per target app.",
    status: "planned"
  },
  {
    title: "Model manager",
    description: "Download, verify, activate, and remove local ASR and OCR models.",
    status: "planned"
  }
];

export function App(): JSX.Element {
  const [version, setVersion] = useState<string>("0.1.0");
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.voxtype.getVersion().then(setVersion);
    void window.voxtype.settings.get().then(setSettings);
  }, []);

  async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
    setSettings(await window.voxtype.settings.update(patch));
  }

  return (
    <main className="app-shell">
      <section className="intro">
        <div>
          <p className="eyebrow">VoxType {version}</p>
          <h1>Local dictation for real Windows work.</h1>
          <p className="lede">
            The foundation is running. Next up: microphone capture, local Whisper transcription,
            model downloads, and reliable insertion into third-party apps.
          </p>
        </div>
        <div className="status-panel" aria-label="Application status">
          <span className="status-dot" />
          <div>
            <strong>Electron shell ready</strong>
            <span>Main, preload, renderer, and tray scaffolding are connected.</span>
          </div>
        </div>
      </section>

      <section className="capability-grid" aria-label="Planned capabilities">
        {capabilities.map((capability) => (
          <article className="capability-card" key={capability.title}>
            <span className={`status-pill status-${capability.status}`}>{capability.status}</span>
            <h2>{capability.title}</h2>
            <p>{capability.description}</p>
          </article>
        ))}
      </section>

      {settings ? (
        <section className="settings-panel" aria-label="VoxType settings">
          <div className="section-heading">
            <p className="eyebrow">Foundation</p>
            <h2>Local settings are wired.</h2>
          </div>

          <div className="settings-grid">
            <label className="field">
              <span>Model directory</span>
              <input
                value={settings.modelDirectory}
                onChange={(event) => void updateSettings({ modelDirectory: event.target.value })}
              />
            </label>

            <label className="field">
              <span>Insertion mode</span>
              <select
                value={settings.insertionMode}
                onChange={(event) =>
                  void updateSettings({ insertionMode: event.target.value as InsertionMode })
                }
              >
                <option value="clipboard">Clipboard paste</option>
                <option value="keyboard">Keyboard emulation</option>
                <option value="chunked">Remote-safe chunked typing</option>
              </select>
            </label>

            <label className="field">
              <span>Remote typing delay</span>
              <input
                max={1000}
                min={0}
                type="number"
                value={settings.remoteTypingDelayMs}
                onChange={(event) =>
                  void updateSettings({ remoteTypingDelayMs: Number(event.target.value) })
                }
              />
            </label>

            <label className="toggle">
              <input
                checked={settings.restoreClipboard}
                type="checkbox"
                onChange={(event) =>
                  void updateSettings({ restoreClipboard: event.target.checked })
                }
              />
              <span>Restore clipboard after paste insertion</span>
            </label>

            <label className="toggle">
              <input
                checked={settings.offlineMode}
                type="checkbox"
                onChange={(event) => void updateSettings({ offlineMode: event.target.checked })}
              />
              <span>Offline mode after models are installed</span>
            </label>
          </div>
        </section>
      ) : null}
    </main>
  );
}
