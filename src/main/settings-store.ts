import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AppSettings,
  type SettingsPatch,
  sanitizeSettings
} from "../shared/settings";

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
      showWindowHotkey: "CommandOrControl+Shift+Space",
      dictationToggleHotkey: "CommandOrControl+Alt+Space",
      insertionMode: "clipboard",
      offlineMode: false,
      autoMuteSystemAudio: false,
      restoreClipboard: true,
      remoteTypingDelayMs: 25
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
