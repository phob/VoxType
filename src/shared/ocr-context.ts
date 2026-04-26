import { type OcrResult, type OcrTextLine } from "./ocr";
import { type OcrTermMode } from "./settings";
import { type ActiveWindowInfo } from "./windows-helper";

export type OcrPromptContext = {
  source: "activeWindow";
  provider: OcrResult["provider"];
  engine: string;
  imagePath: string;
  capturedAt: string;
  durationMs: number;
  processName: string | null;
  windowTitle: string;
  lineCount: number;
  rawText: string;
  terms: string[];
  rejectedTerms: string[];
  termMode: OcrTermMode;
};

const MAX_OCR_TERMS = 160;
const MAX_TERM_LENGTH = 72;
const COMMON_WORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "and",
  "are",
  "back",
  "button",
  "can",
  "close",
  "copy",
  "delete",
  "edit",
  "file",
  "from",
  "has",
  "help",
  "home",
  "into",
  "menu",
  "more",
  "new",
  "not",
  "open",
  "save",
  "settings",
  "that",
  "the",
  "this",
  "view",
  "with",
  "you"
]);

export function buildOcrPromptContext(
  ocrResult: OcrResult,
  target: ActiveWindowInfo | null,
  mode: OcrTermMode = "balanced"
): OcrPromptContext | null {
  const { terms, rejectedTerms } = extractOcrTermCandidates(ocrResult, mode);

  if (terms.length === 0 && !ocrResult.text.trim()) {
    return null;
  }

  return {
    source: "activeWindow",
    provider: ocrResult.provider,
    engine: ocrResult.engine,
    imagePath: ocrResult.imagePath,
    capturedAt: ocrResult.capturedAt,
    durationMs: ocrResult.durationMs,
    processName: target?.processName ?? null,
    windowTitle: target?.title ?? "",
    lineCount: ocrResult.lines.length,
    rawText: ocrResult.text,
    terms,
    rejectedTerms,
    termMode: mode
  };
}

export function extractOcrTerms(ocrResult: Pick<OcrResult, "text" | "lines">): string[] {
  return extractOcrTermCandidates(ocrResult, "balanced").terms;
}

export function extractOcrTermCandidates(
  ocrResult: Pick<OcrResult, "text" | "lines">,
  mode: OcrTermMode
): { terms: string[]; rejectedTerms: string[] } {
  const ranked = new Map<string, { term: string; score: number }>();
  const candidates = new Map<string, string>();

  for (const line of ocrResult.lines) {
    addLineTerms(ranked, candidates, line, mode);
  }

  for (const token of tokenize(ocrResult.text)) {
    addCandidate(candidates, token);
    addTerm(ranked, token, scoreToken(token, mode), mode);
  }

  const terms = [...ranked.values()]
    .sort((first, second) => second.score - first.score || first.term.localeCompare(second.term))
    .map((entry) => entry.term)
    .slice(0, MAX_OCR_TERMS);
  const accepted = new Set(terms.map((term) => term.toLowerCase()));
  const rejectedTerms = [...candidates.values()]
    .filter((term) => !accepted.has(term.toLowerCase()))
    .sort((first, second) => first.localeCompare(second))
    .slice(0, MAX_OCR_TERMS);

  return { terms, rejectedTerms };
}

function addLineTerms(
  ranked: Map<string, { term: string; score: number }>,
  candidates: Map<string, string>,
  line: OcrTextLine,
  mode: OcrTermMode
): void {
  const text = normalizeWhitespace(line.text);

  if (!text) {
    return;
  }

  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]+-[A-Z0-9-]*\d[A-Z0-9-]*\b/g)) {
    addCandidate(candidates, match[0]);
    addTerm(ranked, match[0], 95, mode);
  }

  for (const match of text.matchAll(/\b(?:0x[0-9a-f]+|HRESULT\(?0x[0-9a-f]+\)?|[A-Z]{2,}_[A-Z0-9_]+)\b/gi)) {
    addCandidate(candidates, match[0]);
    addTerm(ranked, match[0], 90, mode);
  }

  for (const match of text.matchAll(/\b[\w.-]+\.(?:cpp|cs|css|go|html|js|json|jsx|md|rs|ts|tsx|yaml|yml)\b/gi)) {
    addCandidate(candidates, match[0]);
    addTerm(ranked, match[0], 88, mode);
  }

  for (const token of tokenize(text)) {
    addCandidate(candidates, token);
    addTerm(ranked, token, scoreToken(token, mode), mode);
  }
}

function tokenize(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/[\s,;:()[\]{}"'<>|]+/)
    .map((token) => token.trim().replace(/^[^\w#.-]+|[^\w#.-]+$/g, ""))
    .filter(Boolean);
}

function scoreToken(token: string, mode: OcrTermMode): number {
  if (!isUsefulTerm(token, mode)) {
    return 0;
  }

  if (/^(?:0x[0-9a-f]+|HRESULT)/i.test(token)) {
    return 90;
  }

  if (/^[A-Z][A-Z0-9]+-[A-Z0-9-]*\d[A-Z0-9-]*$/.test(token)) {
    return 88;
  }

  if (/[._/-]/.test(token)) {
    return 82;
  }

  if (/^[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+$/.test(token) || /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(token)) {
    return 78;
  }

  if (/^[A-Z]{2,}$/.test(token)) {
    return 74;
  }

  if (/^\d+[A-Za-z]+\d*$/.test(token) || /^[A-Za-z]+\d+$/.test(token)) {
    return 66;
  }

  if (/^[A-Z][a-z]{3,}$/.test(token)) {
    return mode === "strict" ? 42 : 58;
  }

  if (mode !== "strict" && /^[A-Za-z]{3,}$/.test(token)) {
    return mode === "broad" ? 38 : 22;
  }

  return 0;
}

function addTerm(
  ranked: Map<string, { term: string; score: number }>,
  rawTerm: string,
  score: number,
  mode: OcrTermMode
): void {
  const term = normalizeTerm(rawTerm);

  if (score <= 0 || !isUsefulTerm(term, mode)) {
    return;
  }

  const key = term.toLowerCase();
  const existing = ranked.get(key);

  if (!existing || score > existing.score) {
    ranked.set(key, { term, score });
  }
}

function addCandidate(candidates: Map<string, string>, rawTerm: string): void {
  const term = normalizeTerm(rawTerm);

  if (term.length < 2 || term.length > MAX_TERM_LENGTH || /^\d+$/.test(term)) {
    return;
  }

  const key = term.toLowerCase();

  if (!candidates.has(key)) {
    candidates.set(key, term);
  }
}

function isUsefulTerm(term: string, mode: OcrTermMode): boolean {
  if (term.length < 3 || term.length > MAX_TERM_LENGTH) {
    return false;
  }

  if (/^\d+$/.test(term)) {
    return false;
  }

  if (COMMON_WORDS.has(term.toLowerCase())) {
    return false;
  }

  if (mode === "broad") {
    return true;
  }

  return (
    /[A-Z]/.test(term) ||
    /\d/.test(term) ||
    /[._#/-]/.test(term) ||
    term.includes("\\") ||
    (mode === "balanced" && /^[A-Z][a-z]{2,}$/.test(term))
  );
}

function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, " ").slice(0, MAX_TERM_LENGTH);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
