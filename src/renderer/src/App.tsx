import { useEffect, useState } from "react";

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

  useEffect(() => {
    void window.voxtype.getVersion().then(setVersion);
  }, []);

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
    </main>
  );
}

