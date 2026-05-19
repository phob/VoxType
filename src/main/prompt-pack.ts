import { type OcrPromptContext } from "../shared/ocr-context";
import { type PromptPack } from "../shared/asr";
import { DictionaryStore } from "./dictionary-store";

export const PROMPT_PACK_MAX_TERMS = 50;
export const PROMPT_PACK_MAX_CHARS = 1000;

export type CloudPromptPackOptions = {
  processName?: string | null;
  ocrContext?: OcrPromptContext | null;
  includeOcrContext: boolean;
};

export async function buildCloudPromptPack(
  dictionaryStore: DictionaryStore,
  options: CloudPromptPackOptions
): Promise<PromptPack | null> {
  const ocrTerms = options.includeOcrContext ? options.ocrContext?.terms ?? [] : [];
  const promptContext = await dictionaryStore.buildPromptContext(options.processName, ocrTerms);
  const terms = extractPromptTerms(promptContext)
    .filter((term) => !looksLikeWhisperPromptOverride(term))
    .slice(0, PROMPT_PACK_MAX_TERMS);
  const text = terms.join(", ").slice(0, PROMPT_PACK_MAX_CHARS).trim();

  if (!text) {
    return null;
  }

  return {
    terms,
    text,
    source: ocrTerms.length > 0 ? "dictionary+ocr" : "dictionary",
    truncated: terms.length >= PROMPT_PACK_MAX_TERMS || terms.join(", ").length > PROMPT_PACK_MAX_CHARS
  };
}

function looksLikeWhisperPromptOverride(term: string): boolean {
  const lower = term.toLowerCase();

  return (
    lower.includes("whisperpromptoverride") ||
    lower.includes("whisper prompt override") ||
    lower.startsWith("style:") ||
    lower.startsWith("rewrite") ||
    lower.startsWith("format as")
  );
}

function extractPromptTerms(promptContext: string | null): string[] {
  if (!promptContext) {
    return [];
  }

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const rawTerm of promptContext.split(/[\n,;]+/)) {
    const term = rawTerm.trim().replace(/^[-*]\s*/, "").replace(/\s+/g, " ");

    if (!term || seen.has(term.toLowerCase())) {
      continue;
    }

    seen.add(term.toLowerCase());
    terms.push(term);
  }

  return terms;
}
