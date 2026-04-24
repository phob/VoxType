export type DictionaryEntrySource = "user" | "correction" | "ocr";

export type DictionaryEntry = {
  id: string;
  preferred: string;
  matches: string[];
  category: string;
  appProcessName: string | null;
  source: DictionaryEntrySource;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DictionaryPatch = Partial<
  Pick<
    DictionaryEntry,
    "preferred" | "matches" | "category" | "appProcessName" | "source" | "enabled"
  >
>;

export type DictionaryCreateInput = Pick<DictionaryEntry, "preferred"> &
  Partial<
    Pick<DictionaryEntry, "matches" | "category" | "appProcessName" | "source" | "enabled">
  >;

export function sanitizeDictionaryEntries(value: unknown): DictionaryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isDictionaryEntry).map((entry) => ({
    ...entry,
    preferred: entry.preferred.trim(),
    matches: uniqueStrings(entry.matches.map((match) => match.trim()).filter(Boolean)),
    category: entry.category.trim(),
    appProcessName: normalizeNullableString(entry.appProcessName),
    updatedAt: entry.updatedAt || entry.createdAt
  }));
}

export function normalizeDictionaryCreateInput(
  input: DictionaryCreateInput
): Omit<DictionaryEntry, "id" | "createdAt" | "updatedAt"> {
  return {
    preferred: input.preferred.trim(),
    matches: uniqueStrings((input.matches ?? []).map((match) => match.trim()).filter(Boolean)),
    category: input.category?.trim() || "general",
    appProcessName: normalizeNullableString(input.appProcessName ?? null),
    source: input.source ?? "user",
    enabled: input.enabled ?? true
  };
}

export function normalizeDictionaryPatch(patch: DictionaryPatch): DictionaryPatch {
  return {
    ...patch,
    preferred: patch.preferred?.trim(),
    matches: patch.matches
      ? uniqueStrings(patch.matches.map((match) => match.trim()).filter(Boolean))
      : undefined,
    category: patch.category?.trim(),
    appProcessName:
      patch.appProcessName === undefined
        ? undefined
        : normalizeNullableString(patch.appProcessName)
  };
}

function isDictionaryEntry(value: unknown): value is DictionaryEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.id === "string" &&
    typeof entry.preferred === "string" &&
    Array.isArray(entry.matches) &&
    entry.matches.every((match) => typeof match === "string") &&
    typeof entry.category === "string" &&
    (typeof entry.appProcessName === "string" || entry.appProcessName === null) &&
    isDictionaryEntrySource(entry.source) &&
    typeof entry.enabled === "boolean" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function isDictionaryEntrySource(value: unknown): value is DictionaryEntrySource {
  return value === "user" || value === "correction" || value === "ocr";
}

function normalizeNullableString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
