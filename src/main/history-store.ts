import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type TranscriptEntry } from "../shared/transcripts";

export class HistoryStore {
  private readonly historyPath: string;
  private entries: TranscriptEntry[] | null = null;

  constructor() {
    this.historyPath = join(app.getPath("userData"), "transcripts.json");
  }

  async list(): Promise<TranscriptEntry[]> {
    if (this.entries) {
      return this.entries;
    }

    try {
      const file = await readFile(this.historyPath, "utf8");
      const parsed = JSON.parse(file);
      this.entries = Array.isArray(parsed) ? parsed.filter(isTranscriptEntry) : [];
    } catch {
      this.entries = [];
      await this.save();
    }

    return this.entries;
  }

  async add(entry: TranscriptEntry): Promise<TranscriptEntry[]> {
    const entries = await this.list();
    this.entries = [entry, ...entries].slice(0, 50);
    await this.save();

    return this.entries;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.historyPath), { recursive: true });
    await writeFile(this.historyPath, `${JSON.stringify(this.entries ?? [], null, 2)}\n`, "utf8");
  }
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.id === "string" &&
    typeof entry.text === "string" &&
    typeof entry.modelId === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.durationMs === "number"
  );
}

