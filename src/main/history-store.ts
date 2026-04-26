import { app } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type TranscriptEntry } from "../shared/transcripts";

export class HistoryStore {
  private readonly historyPath: string;
  private readonly audioDirectory: string;
  private entries: TranscriptEntry[] | null = null;

  constructor() {
    const userDataPath = app.getPath("userData");

    this.historyPath = join(userDataPath, "transcripts.json");
    this.audioDirectory = join(userDataPath, "transcript-audio");
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
    const nextEntries = [entry, ...entries];
    const keptEntries = nextEntries.slice(0, 50);
    const droppedEntries = nextEntries.slice(50);

    this.entries = keptEntries;
    await this.save();
    await Promise.all(droppedEntries.map((droppedEntry) => this.removeAudio(droppedEntry)));

    return this.entries;
  }

  async saveAudio(entryId: string, audioBytes: Uint8Array): Promise<string> {
    const audioFileName = audioFileNameForEntry(entryId);
    const audioPath = this.getAudioPath(audioFileName);

    await mkdir(this.audioDirectory, { recursive: true });
    await writeFile(audioPath, audioBytes);

    return audioFileName;
  }

  async readAudio(entryId: string): Promise<Uint8Array> {
    const entries = await this.list();
    const entry = entries.find((candidate) => candidate.id === entryId);

    if (!entry?.audioFileName || entry.audioFileName !== audioFileNameForEntry(entry.id)) {
      throw new Error("No saved audio is available for this transcript.");
    }

    return readFile(this.getAudioPath(entry.audioFileName));
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.historyPath), { recursive: true });
    await writeFile(this.historyPath, `${JSON.stringify(this.entries ?? [], null, 2)}\n`, "utf8");
  }

  private async removeAudio(entry: TranscriptEntry): Promise<void> {
    if (!entry.audioFileName || entry.audioFileName !== audioFileNameForEntry(entry.id)) {
      return;
    }

    await rm(this.getAudioPath(entry.audioFileName), { force: true });
  }

  private getAudioPath(audioFileName: string): string {
    return join(this.audioDirectory, audioFileName);
  }
}

function audioFileNameForEntry(entryId: string): string {
  return `${entryId}.wav`;
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.id === "string" &&
    typeof entry.text === "string" &&
    (typeof entry.rawText === "string" || entry.rawText === undefined) &&
    (Array.isArray(entry.correctionsApplied) || entry.correctionsApplied === undefined) &&
    (Array.isArray(entry.ocrCorrectionsApplied) || entry.ocrCorrectionsApplied === undefined) &&
    (typeof entry.promptContext === "string" || entry.promptContext === undefined) &&
    (typeof entry.audioFileName === "string" || entry.audioFileName === undefined) &&
    typeof entry.modelId === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.durationMs === "number"
  );
}
