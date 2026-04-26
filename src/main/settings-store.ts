import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AppProfile,
  type AppSettings,
  type SettingsPatch,
  createAppProfile,
  findAppProfile,
  sanitizeSettings
} from "../shared/settings";
import { type ActiveWindowInfo } from "../shared/windows-helper";

export class SettingsStore {
  private readonly settingsPath: string;
  private readonly defaults: AppSettings;
  private current: AppSettings | null = null;

  constructor() {
    const userDataPath = app.getPath("userData");

    this.settingsPath = join(userDataPath, "settings.json");
    this.defaults = {
      modelDirectory: join(userDataPath, "models"),
      activeModelId: "tiny.en",
      whisperExecutablePath: "",
      whisperPromptOverride: "",
      showWindowHotkey: "CommandOrControl+Shift+Space",
      dictationToggleHotkey: "CommandOrControl+Alt+Space",
      insertionMode: "clipboard",
      recorderCaptureMode: "sharedCapture",
      ocrTermMode: "balanced",
      recordingCoordinationMode: "none",
      recordingStartHotkey: "",
      recordingStopHotkey: "",
      offlineMode: false,
      autoMuteSystemAudio: false,
      restoreClipboard: true,
      vadEnabled: true,
      vadPositiveSpeechThreshold: 0.3,
      vadNegativeSpeechThreshold: 0.15,
      vadMinSpeechMs: 250,
      vadPreSpeechPadMs: 450,
      vadRedemptionMs: 450,
      vadPreservedPauseMs: 500,
      remoteTypingDelayMs: 25,
      remoteTypingChunkSize: 24,
      appProfiles: []
    };
  }

  async get(): Promise<AppSettings> {
    if (this.current) {
      return this.current;
    }

    try {
      const file = await readFile(this.settingsPath, "utf8");
      this.current = sanitizeSettings(JSON.parse(file), this.defaults);
    } catch {
      this.current = this.defaults;
      await this.save(this.current);
    }

    return this.current;
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const current = await this.get();
    const next = sanitizeSettings({ ...current, ...patch }, this.defaults);

    this.current = next;
    await this.save(next);

    return next;
  }

  async ensureAppProfile(windowInfo: ActiveWindowInfo | null): Promise<AppProfile | null> {
    if (!windowInfo?.processName) {
      return null;
    }

    const settings = await this.get();
    const existing = findAppProfile(settings.appProfiles, windowInfo.processName);

    if (existing) {
      return existing;
    }

    const profile = createAppProfile({
      processName: windowInfo.processName,
      processPath: windowInfo.processPath,
      title: windowInfo.title
    });

    await this.update({
      appProfiles: [...settings.appProfiles, profile]
    });

    return profile;
  }

  async updateAppProfile(
    processName: string,
    patch: Pick<
      AppProfile,
      | "insertionMode"
      | "writingStyle"
      | "recordingCoordinationMode"
      | "recordingStartHotkey"
      | "recordingStopHotkey"
    >
  ): Promise<AppSettings> {
    const settings = await this.get();
    const existing = findAppProfile(settings.appProfiles, processName);

    if (!existing) {
      return settings;
    }

    return this.update({
      appProfiles: settings.appProfiles.map((profile) =>
        profile.processName === existing.processName
          ? {
              ...profile,
              insertionMode: patch.insertionMode,
              writingStyle: patch.writingStyle,
              recordingCoordinationMode: patch.recordingCoordinationMode,
              recordingStartHotkey: patch.recordingStartHotkey,
              recordingStopHotkey: patch.recordingStopHotkey,
              updatedAt: new Date().toISOString()
            }
          : profile
      )
    });
  }

  async reset(): Promise<AppSettings> {
    this.current = this.defaults;
    await this.save(this.current);

    return this.current;
  }

  private async save(settings: AppSettings): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
