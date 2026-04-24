import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type DictionaryCreateInput,
  type DictionaryEntry,
  type DictionaryPatch,
  normalizeDictionaryCreateInput,
  normalizeDictionaryPatch,
  sanitizeDictionaryEntries
} from "../shared/dictionary";

export class DictionaryStore {
  private readonly dictionaryPath: string;
  private entries: DictionaryEntry[] | null = null;

  constructor() {
    this.dictionaryPath = join(app.getPath("userData"), "dictionary.json");
  }

  async list(): Promise<DictionaryEntry[]> {
    if (this.entries) {
      return this.entries;
    }

    try {
      const file = await readFile(this.dictionaryPath, "utf8");
      this.entries = sanitizeDictionaryEntries(JSON.parse(file));
    } catch {
      this.entries = [];
      await this.save();
    }

    return this.entries;
  }

  async add(input: DictionaryCreateInput): Promise<DictionaryEntry[]> {
    const normalized = normalizeDictionaryCreateInput(input);

    if (!normalized.preferred) {
      throw new Error("Dictionary entry requires preferred text.");
    }

    const entries = await this.list();
    const now = new Date().toISOString();
    const entry: DictionaryEntry = {
      id: randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now
    };

    this.entries = [entry, ...entries];
    await this.save();

    return this.entries;
  }

  async update(id: string, patch: DictionaryPatch): Promise<DictionaryEntry[]> {
    const entries = await this.list();
    const normalized = normalizeDictionaryPatch(patch);
    let found = false;

    this.entries = entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }

      found = true;
      return {
        ...entry,
        ...normalized,
        updatedAt: new Date().toISOString()
      };
    });

    if (!found) {
      throw new Error(`Dictionary entry not found: ${id}`);
    }

    await this.save();

    return this.entries;
  }

  async remove(id: string): Promise<DictionaryEntry[]> {
    const entries = await this.list();
    this.entries = entries.filter((entry) => entry.id !== id);
    await this.save();

    return this.entries;
  }

  async buildPromptContext(processName?: string | null): Promise<string | null> {
    const entries = await this.relevantEntries(processName);
    const terms = entries.map((entry) => entry.preferred).filter(Boolean).slice(0, 40);

    if (terms.length === 0) {
      return null;
    }

    return `Relevant terms: ${terms.join(", ")}. Use these spellings when they are spoken.`;
  }

  async applyCorrections(text: string, processName?: string | null): Promise<{
    text: string;
    applied: string[];
  }> {
    const entries = await this.relevantEntries(processName);
    let corrected = text;
    const applied: string[] = [];

    for (const entry of entries) {
      for (const match of entry.matches) {
        if (!match.trim() || match === entry.preferred) {
          continue;
        }

        const next = replacePhrase(corrected, match, entry.preferred);

        if (next !== corrected) {
          corrected = next;
          applied.push(`${match} -> ${entry.preferred}`);
        }
      }
    }

    return { text: corrected, applied };
  }

  private async relevantEntries(processName?: string | null): Promise<DictionaryEntry[]> {
    const normalizedProcess = processName?.trim().toLowerCase() || null;
    const entries = await this.list();

    return entries.filter(
      (entry) =>
        entry.enabled &&
        (!entry.appProcessName || !normalizedProcess || entry.appProcessName === normalizedProcess)
    );
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.dictionaryPath), { recursive: true });
    await writeFile(this.dictionaryPath, `${JSON.stringify(this.entries ?? [], null, 2)}\n`, "utf8");
  }
}

function replacePhrase(text: string, match: string, preferred: string): string {
  const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = /^\w/.test(match) ? "\\b" : "";
  const suffix = /\w$/.test(match) ? "\\b" : "";
  const expression = new RegExp(`${prefix}${escaped}${suffix}`, "gi");

  return text.replace(expression, preferred);
}
