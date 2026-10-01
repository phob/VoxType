// Deterministic cleanup steps around the LLM pass. Doing these in code makes them reliable for every
// model size and keeps them working when the model's output is rejected; the model only gets the parts
// that need language understanding.
import { type CleanupStyle } from "./cleanup-prompt";

// Pure hesitation sounds in English and German. Not "er" (German pronoun), "eh" (German "anyway"),
// "ah"/"oh" (interjections) or "mhm" (means yes in a chat). "um" is also a German preposition
// ("um 10 Uhr"), so it only counts when a comma, period or the end follows, as Whisper writes it.
const hesitation = String.raw`(?:u+h+m*|u+m{2,}|e+r+m+|h+m+|ä+h+m*|ö+h+m*|e+h+m+|um(?=[,.]|$))`;
const hesitationPattern = new RegExp(String.raw`(^|[\s,.;:!?(])${hesitation}(?=$|[\s,.;:!?)])[,.]?`, "giu");

export function stripHesitations(text: string): string {
  let result = text;
  let previous: string;

  // Repeat: adjacent hesitations ("uh, um,") share their separating whitespace.
  do {
    previous = result;
    result = result.replace(hesitationPattern, "$1");
  } while (result !== previous);

  return result
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/(^|\n)[ \t]*[,.;:][ \t]*/g, "$1")
    .replace(/,([.!?])/g, "$1")
    .replace(/,{2,}/g, ",")
    .trim();
}

/** Touches that do not need a model: preferred term spellings, and chat messages end without a period. */
export function finishText(text: string, style: CleanupStyle, terms: string[]): string {
  let result = text;

  for (const term of terms) {
    if (term.length >= 3) {
      result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "giu"), term);
    }
  }

  if (style === "chat" && !result.includes("\n")) {
    result = result.replace(/(?<!\.)\.$/, "");
  }

  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
