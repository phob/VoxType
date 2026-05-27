import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ArrowRight, BookOpen, Box, Check, ChevronDown, Cloud, Code2, FileText, History, Home, Keyboard, Minus, Settings, ShieldCheck, UserPlus, X, Zap, type LucideIcon } from "lucide-react";
import { buildWhisperPromptContext } from "../../../shared/prompt-context";
import { type DictionaryEntry } from "../../../shared/dictionary";
import { type HardwareAccelerationReport } from "../../../shared/hardware";
import { type OpenAiCredentialStatus } from "../../../shared/openai-credentials";
import { type NativeInputDevice, type ActiveWindowInfo, type RecordingOverlayState } from "../../../shared/windows-helper";
import { type AppProfile, type AppSettings, type InsertionMode, type ProfileWhisperLanguage } from "../../../shared/settings";

export type HotkeyCaptureTarget =
  | "dictationToggleHotkey"
  | "dictationHoldHotkey"
  | "showWindowHotkey"
  | "recordingStartHotkey"
  | "recordingStopHotkey";

export type ReleaseIconName =
  | "home"
  | "keyboard"
  | "box"
  | "book"
  | "file"
  | "user"
  | "history"
  | "cloud"
  | "settings"
  | "code"
  | "bolt"
  | "arrowRight"
  | "shield";

export interface SelectOption<T> {
  label: string;
  meta?: string;
  value: T;
}

export const voxtypeLogoUrl = new URL("../../../../resources/icons/voxtype-logo-transparent.png", import.meta.url).href;

export const releaseIcons: Record<ReleaseIconName, LucideIcon> = { home: Home, keyboard: Keyboard, box: Box, book: BookOpen, file: FileText, user: UserPlus, history: History, cloud: Cloud, settings: Settings, code: Code2, bolt: Zap, arrowRight: ArrowRight, shield: ShieldCheck };

export function getOpenAiCredentialStatusText(status: OpenAiCredentialStatus | null): string {
  if (!status?.hasApiKey) {
    return status?.encryptionAvailable === false
      ? "Required before Cloud Dictation can record. OS credential encryption is unavailable."
      : "Required before Cloud Dictation can record.";
  }

  if (status.source === "environment") {
    return "Using OPENAI_API_KEY from the environment; not stored by VoxType.";
  }

  return status.encryptionAvailable
    ? "Stored in OS-encrypted app storage."
    : "Stored credential present, but OS encryption status could not be confirmed.";
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function appHotkeyEntries(settings: AppSettings | null): {
  id: HotkeyCaptureTarget;
  label: string;
  value: string;
}[] {
  if (!settings) {
    return [];
  }

  const entries: {
    id: HotkeyCaptureTarget;
    label: string;
    value: string;
  }[] = [
    {
      id: "dictationToggleHotkey",
      label: "Dictation",
      value: settings.dictationToggleHotkey
    },
    {
      id: "dictationHoldHotkey",
      label: "Hold to dictate",
      value: settings.dictationHoldHotkey
    },
    {
      id: "showWindowHotkey",
      label: "Show VoxType",
      value: settings.showWindowHotkey
    },
    {
      id: "recordingStartHotkey",
      label: "Recording start hotkey",
      value: settings.recordingStartHotkey
    },
    {
      id: "recordingStopHotkey",
      label: "Recording stop hotkey",
      value: settings.recordingStopHotkey
    }
  ];

  return entries.filter((entry) => entry.value.trim());
}

export function normalizeHotkey(value: string): string {
  const parts = value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.at(-1) ?? "";
  const modifiers = parts
    .slice(0, -1)
    .map((part) => (part === "ctrl" || part === "control" ? "commandorcontrol" : part))
    .sort();

  return [...modifiers, key].join("+");
}

export function WindowTitleBar({ title }: { title: string }): ReactElement {
  return (
    <div className="window-titlebar">
      <div className="window-titlebar-brand">
        <img alt="" className="window-titlebar-mark" src={voxtypeLogoUrl} />
        <span>{title}</span>
      </div>
      <div className="window-controls">
        <button
          aria-label="Hide window"
          onClick={() => void window.voxtype.window.minimize()}
          title="Hide window"
          type="button"
        >
          <Minus aria-hidden="true" className="release-icon-svg" />
        </button>
        <button
          aria-label="Close"
          className="window-close-button"
          onClick={() => void window.voxtype.window.close()}
          title="Close"
          type="button"
        >
          <X aria-hidden="true" className="release-icon-svg" />
        </button>
      </div>
    </div>
  );
}

export function ReleaseIcon({
  name,
  decorative = false
}: {
  name: ReleaseIconName;
  decorative?: boolean;
}): ReactElement {
  const Icon = releaseIcons[name];

  return (
    <Icon
      aria-hidden={decorative ? "true" : undefined}
      className="release-icon-svg"
      focusable="false"
      role={decorative ? undefined : "img"}
      strokeWidth={1.8}
    />
  );
}

export function ReleaseSelect<T>({
  ariaLabel,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  value: T;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="release-select" onBlur={() => { setOpen(false); }}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={open ? "release-select-trigger open" : "release-select-trigger"}
        onClick={() => { setOpen((current) => !current); }}
        type="button"
      >
        <span>{selectedOption.label}</span>
        <ChevronDown aria-hidden="true" className="release-icon-svg" />
      </button>
      {open ? (
        <div className="release-select-menu" role="listbox">
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                aria-selected={selected}
                className={selected ? "selected" : ""}
                key={String(option.value)}
                onMouseDown={(event) => { event.preventDefault(); }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {option.meta ? <small>{option.meta}</small> : null}
                {selected ? <Check aria-hidden="true" className="release-icon-svg" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ReleaseChip({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "accent" | "neutral" | "success" | "warning";
}): ReactElement {
  return <span className={`release-chip release-chip-${tone}`}>{children}</span>;
}

export function ReleaseStatusBadge({
  children,
  tone
}: {
  children: ReactNode;
  tone: "disabled" | "error" | "processing" | "ready";
}): ReactElement {
  return (
    <span className={`release-status-badge release-status-badge-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "none";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatRelativeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "none";
  }

  if (value < 1024) {
    return `${String(value)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatElapsedCloudSession(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `Cloud Dictation ${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

export function RecordingOverlay({ state }: { state: RecordingOverlayState }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorGainRef = useRef<GainNode | null>(null);
  const meterHistoryRef = useRef<number[]>([]);
  const meterSampleAtRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const levelRef = useRef(0);
  const clampedLevel = Math.min(Math.max(state.level, 0), 1);

  useEffect(() => {
    if (state.mode !== "recording") {
      meterHistoryRef.current = [];
      meterSampleAtRef.current = 0;
      return;
    }

    const previous = levelRef.current;
    levelRef.current = previous + (clampedLevel - previous) * 0.34;

    if (oscillatorGainRef.current) {
      oscillatorGainRef.current.gain.setTargetAtTime(
        levelRef.current,
        audioContextRef.current?.currentTime ?? 0,
        0.035
      );
    }
  }, [clampedLevel, state.mode]);

  useEffect(() => {
    if (state.mode !== "recording") {
      return undefined;
    }

    const audioContext = new window.AudioContext();
    const analyser = audioContext.createAnalyser();
    const oscillator = audioContext.createOscillator();
    const oscillatorGain = audioContext.createGain();
    const muteGain = audioContext.createGain();

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    oscillator.frequency.value = 110;
    oscillatorGain.gain.value = 0;
    muteGain.gain.value = 0;

    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(analyser);
    analyser.connect(muteGain);
    muteGain.connect(audioContext.destination);
    oscillator.start();

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    oscillatorGainRef.current = oscillatorGain;

    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      oscillator.stop();
      oscillator.disconnect();
      oscillatorGain.disconnect();
      analyser.disconnect();
      muteGain.disconnect();
      void audioContext.close();
      analyserRef.current = null;
      oscillatorGainRef.current = null;
      audioContextRef.current = null;
    };
  }, [state.mode]);

  useEffect(() => {
    if (state.mode !== "recording") {
      return undefined;
    }

    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return undefined;
    }

    const data = new Uint8Array(512);

    function draw(timestamp = window.performance.now()): void {
      if (!canvas || !context) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * scale));
      const height = Math.max(1, Math.floor(rect.height * scale));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const analyser = analyserRef.current;
      let energy = levelRef.current;

      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;

        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }

        energy = Math.max(energy, Math.sqrt(sum / data.length) * 1.7);
      }

      const normalized = Math.min(Math.max(energy * 1.75, 0), 1);
      const history = meterHistoryRef.current;
      const barWidth = Math.max(2, Math.round(3 * scale));
      const gap = Math.max(2, Math.round(3 * scale));
      const maxBars = Math.max(1, Math.floor(width / (barWidth + gap)));

      if (timestamp - meterSampleAtRef.current >= 110) {
        history.push(normalized);
        meterHistoryRef.current = history.slice(-maxBars);
        meterSampleAtRef.current = timestamp;
      }

      paintMeter(context, meterHistoryRef.current, width, height, barWidth, gap, scale);
      animationFrameRef.current = window.requestAnimationFrame(draw);
    }

    draw();

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [state.mode]);

  const statusLabel =
    state.mode === "recording"
      ? state.cloudProviderLabel ?? "Listening"
      : state.mode === "finalizing"
        ? "Finalizing"
        : state.cloudProviderLabel ?? "Transcribing locally";
  const previewTurns = state.livePreviewTurns?.slice(-5) ?? [];
  const hasPreviewText = previewTurns.some((turn) =>
    Boolean((turn.finalText ?? turn.provisionalText ?? "").trim())
  );
  const elapsedLabel =
    typeof state.elapsedMs === "number" ? formatElapsedCloudSession(state.elapsedMs) : null;

  return (
    <main className={`recording-overlay${hasPreviewText ? " recording-overlay-live" : ""}`} aria-label={statusLabel}>
      {state.mode === "recording" ? (
        <>
          <div className="overlay-status-row">
            <span className="overlay-status-dot" aria-hidden="true" />
            <span className="overlay-status-label">{elapsedLabel ?? statusLabel}</span>
            <canvas
              ref={canvasRef}
              aria-label="Input gain timeline"
              className="overlay-meter-canvas"
            />
          </div>
          {previewTurns.length > 0 ? <LivePreview turns={previewTurns} /> : null}
        </>
      ) : (
        <div className="overlay-transcribing">
          <span className="overlay-activity" aria-hidden="true" />
          <span>{statusLabel}</span>
          {previewTurns.length > 0 ? <LivePreview turns={previewTurns} /> : null}
        </div>
      )}
    </main>
  );
}

export function LivePreview({ turns }: { turns: NonNullable<RecordingOverlayState["livePreviewTurns"]> }): ReactElement {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const visibleTurns = turns
    .map((turn) => ({
      ...turn,
      text: (turn.finalText ?? turn.provisionalText ?? "").trim()
    }))
    .filter((turn) => turn.text.length > 0);
  const previewText = visibleTurns.map((turn) => turn.text).join("\n");

  useEffect(() => {
    const preview = previewRef.current;

    if (!preview) {
      return;
    }

    preview.scrollTop = preview.scrollHeight;
  }, [previewText]);

  return (
    <div className="overlay-live-preview" aria-label="Live Preview" ref={previewRef}>
      {visibleTurns.map((turn) => (
        <p
          className={turn.status === "provisional" ? "overlay-preview-provisional" : "overlay-preview-final"}
          key={turn.providerItemId}
        >
          {turn.text}
        </p>
      ))}
    </div>
  );
}

export function paintMeter(
  context: CanvasRenderingContext2D,
  levels: number[],
  width: number,
  height: number,
  barWidth: number,
  gap: number,
  scale: number
): void {
  const baselineHeight = Math.max(2, Math.round(2 * scale));
  const paddingX = Math.round(2 * scale);
  const paddingTop = Math.round(1 * scale);
  const paddingBottom = Math.round(2 * scale);
  const meterHeight = height - paddingTop - paddingBottom;
  const baselineY = height - paddingBottom;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(13, 22, 29, 0.96)";
  context.fillRect(0, 0, width, height);

  const gridColor = "rgba(75, 91, 107, 0.32)";
  context.strokeStyle = gridColor;
  context.lineWidth = Math.max(1, scale);

  for (const threshold of [0.36, 0.7]) {
    const y = baselineY - meterHeight * threshold;
    context.beginPath();
    context.moveTo(paddingX, y);
    context.lineTo(width - paddingX, y);
    context.stroke();
  }

  const totalStep = barWidth + gap;
  const startX = width - paddingX - levels.length * totalStep;

  levels.forEach((level, index) => {
    const x = startX + index * totalStep;
    const quiet = level < 0.018;
    const shaped = Math.pow(level, 0.58);
    const dynamicHeight = quiet ? baselineHeight : Math.max(baselineHeight, meterHeight * shaped);
    const y = baselineY - dynamicHeight;

    context.fillStyle = meterColor(level);
    roundRect(context, x, y, barWidth, dynamicHeight, Math.max(2, barWidth / 2));
    context.fill();
  });
}

export function meterColor(level: number): string {
  if (level > 0.78) {
    return "#ff6262";
  }

  if (level > 0.46) {
    return "#ffcf99";
  }

  return "#37d7a0";
}

export function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  void radius;

  context.beginPath();
  context.rect(x, y, width, height);
  context.closePath();
}

export function joinErrors(primary: string, secondary: string | null): string {
  return secondary ? `${primary} ${secondary}` : primary;
}

export function pngBytesToDataUrl(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:image/png;base64,${window.btoa(binary)}`;
}

export function insertionModeLabel(mode: InsertionMode): string {
  if (mode === "clipboard") {
    return "clipboard paste";
  }

  if (mode === "remoteClipboard") {
    return "remote clipboard paste";
  }

  if (mode === "keyboard") {
    return "Unicode typing";
  }

  if (mode === "windowsMessaging") {
    return "Windows Messaging";
  }

  return "chunked typing";
}

export function writingStyleLabel(style: AppProfile["writingStyle"]): string {
  if (style === "chat") {
    return "chat style";
  }

  if (style === "professional") {
    return "professional style";
  }

  return "default style";
}

export function profileWhisperLanguageLabel(language: ProfileWhisperLanguage): string {
  if (language === "inherit") {
    return "inherit language";
  }

  if (language === "auto") {
    return "auto language";
  }

  return language.toUpperCase();
}

export function recordingInputDeviceLabel(
  settings: AppSettings,
  devices: NativeInputDevice[]
): string {
  if (settings.recordingInputDeviceId === "default") {
    const defaultDevice = devices.find((device) => device.isDefault);
    return defaultDevice
      ? `Use the current Windows default: ${defaultDevice.name}.`
      : "Use the current Windows default input device.";
  }

  const selectedDevice = devices.find((device) => device.id === settings.recordingInputDeviceId);

  return selectedDevice
    ? `Use ${selectedDevice.name} for VoxType recordings.`
    : "The selected input device is not currently available.";
}

export function profileForWindow(
  profiles: AppProfile[],
  windowInfo: ActiveWindowInfo | null
): AppProfile | null {
  if (!windowInfo?.processName) {
    return null;
  }

  const processName = normalizeProfileProcessName(windowInfo.processName);

  if (!processName) {
    return null;
  }

  return profiles.find((profile) => profile.processName === processName) ?? null;
}

export function normalizeProfileProcessName(processName: string | null | undefined): string | null {
  if (!processName) {
    return null;
  }

  const normalized = processName.trim();

  if (!normalized) {
    return null;
  }

  const fileName = normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized;

  return fileName.toLowerCase();
}


export function splitMatches(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((match) => match.trim())
    .filter(Boolean);
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export async function playRecordingCue(kind: "start" | "stop"): Promise<void> {
  const context = new window.AudioContext();
  const frequencies = kind === "start" ? [660, 880] : [880, 660];
  const durationSeconds = 0.075;
  const gapSeconds = 0.025;
  const startedAt = context.currentTime + 0.01;

  for (const [index, frequency] of frequencies.entries()) {
    const start = startedAt + index * (durationSeconds + gapSeconds);
    const end = start + durationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  }

  await wait(Math.ceil((frequencies.length * durationSeconds + gapSeconds) * 1000) + 40);
  await context.close();
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${String(milliseconds)} ms`;
  }

  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function formatVram(vramMb: number | null | undefined): string {
  if (typeof vramMb !== "number") {
    return "unknown";
  }

  if (vramMb >= 1024) {
    return `${(vramMb / 1024).toFixed(1)} GB`;
  }

  return `${String(vramMb)} MB`;
}

export function gpuFitLabel(report: HardwareAccelerationReport | null, modelId: string): string {
  const fit = report?.modelFits.find((item) => item.modelId === modelId);

  if (!fit) {
    return "detect";
  }

  if (fit.status === "fits") {
    return `fits (${formatVram(fit.requiredVramMb)})`;
  }

  if (fit.status === "low-vram") {
    return `low (${formatVram(fit.requiredVramMb)})`;
  }

  return fit.status;
}

export function buildWhisperPromptPreview(
  dictionary: DictionaryEntry[],
  processName: string | null,
  ocrTerms: string[]
): string {
  const trimmedProcess = processName?.trim().toLowerCase();
  const normalizedProcess = trimmedProcess ?? null;
  const dictionaryTerms = dictionary
    .filter(
      (entry) =>
        entry.enabled &&
        (!entry.appProcessName || !normalizedProcess || entry.appProcessName === normalizedProcess)
    )
    .map((entry) => entry.preferred);
  const prompt = buildWhisperPromptContext(dictionaryTerms, ocrTerms);

  return prompt ?? "";
}

export function combineWhisperPromptPreview(generatedPrompt: string, promptOverride: string): string {
  const generated = generatedPrompt.trim();
  const custom = promptOverride.trim();

  if (!generated) {
    return custom;
  }

  if (!custom) {
    return generated;
  }

  if (custom.includes(generated)) {
    return custom;
  }

  return `${generated} ${custom}`;
}

