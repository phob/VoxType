const MAX_PROMPT_TERMS = 80;
const MAX_OCR_PROMPT_TERMS = 60;

export function buildWhisperPromptContext(
  dictionaryTerms: string[],
  ocrTerms: string[]
): string | null {
  const filteredOcrTerms = ocrTerms.filter(isHighSignalOcrPromptTerm).slice(0, MAX_OCR_PROMPT_TERMS);
  const terms = uniquePromptTerms([...dictionaryTerms, ...filteredOcrTerms]).slice(0, MAX_PROMPT_TERMS);

  if (terms.length === 0) {
    return null;
  }

  return `Relevant terms: ${terms.join(", ")}. Use these spellings when they are spoken.`;
}

export function isHighSignalOcrPromptTerm(term: string): boolean {
  const normalized = normalizePromptTerm(term);

  if (normalized.length < 2 || normalized.length > 72) {
    return false;
  }

  if (/^[a-z]$/i.test(normalized) || /^\.+$/.test(normalized)) {
    return false;
  }

  return (
    /^--[\w-]+$/.test(normalized) ||
    /[\\/]/.test(normalized) ||
    /(?:^|[\w-])\.(?:cpp|cs|css|go|html|js|json|jsx|md|rs|toml|ts|tsx|yaml|yml)$/i.test(
      normalized
    ) ||
    /^\.[a-z0-9]{2,8}$/i.test(normalized) ||
    /[_#]/.test(normalized) ||
    /[A-Za-z]+-[A-Za-z0-9-]+/.test(normalized) ||
    /\d/.test(normalized) ||
    /^[A-Z]{2,8}$/.test(normalized) ||
    /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(normalized) ||
    /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/.test(normalized)
  );
}

function uniquePromptTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const term of terms) {
    if (typeof term !== "string") {
      continue;
    }

    const normalized = normalizePromptTerm(term);
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function normalizePromptTerm(term: string): string {
  return term.trim().replace(/[.,;:!?]+$/g, "").trim();
}
