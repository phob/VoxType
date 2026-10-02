// Decides whether an LLM-cleaned transcript may replace the original. Cleanup is allowed to delete
// fillers, repeats, spoken punctuation and the corrected part of a self-correction, and to reformat, but
// not to add or drop content: an answered question, a followed instruction, a translation, a preamble or a
// more formal rewording all show up as words the speaker never said; a lost sentence shows up as deleted
// words without a correction phrase. When in doubt the original text is inserted, so a rejection is safe.
// The rewrite level allows new wording and has its own, looser checks (guardRewriteOutput).
import { type CleanupLevel } from "./llm-cleanup";

export type CleanupVerdict =
  | { accepted: true; text: string }
  | { accepted: false; reason: string; text: string };

const hesitations = new Set(["um", "umm", "uh", "uhm", "uhh", "er", "erm", "ah", "hm", "hmm", "mhm", "äh", "ähm", "öh", "ähem", "ehm"]);

const numberWords = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "first", "second", "third",
  "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "half", "quarter", "dozen",
  "null", "eins", "ein", "eine", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf",
  "zwölf", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig", "hundert",
  "tausend", "million", "millionen", "erste", "erstens", "zweite", "zweitens", "dritte", "drittens", "vierte",
  "viertens", "fünfte", "halb", "viertel"
]);

// Words a cleanup may legitimately introduce: list/punctuation glue and spelled-out forms of symbols.
const allowedAdditions = new Set(["and", "or", "und", "oder", "pm", "am", "uhr", "percent", "prozent", "st", "nd", "rd", "th"]);

// Words cleanup may drop without a self-correction: spoken punctuation and list wording.
const removableWords = new Set([
  "comma", "period", "full", "stop", "question", "mark", "exclamation", "colon", "new", "line", "paragraph",
  "komma", "punkt", "fragezeichen", "ausrufezeichen", "doppelpunkt", "neue", "neuer", "zeile", "absatz",
  "first", "second", "third", "fourth", "fifth", "firstly", "secondly", "thirdly", "number", "and", "then",
  "erstens", "zweitens", "drittens", "viertens", "fünftens", "nummer", "und", "dann"
]);

// Phrases that announce a self-correction; with one present, dropping the corrected words is expected.
const correctionPhrases = [
  "no wait", "wait no", "i mean", "i meant", "scratch that", "sorry", "actually", "make that", "or rather", "correction",
  "nein warte", "warte nein", "ich meine", "ich meinte", "quatsch", "nein doch", "korrektur", "besser gesagt", "also nein"
];

const maxLengthRatio = 1.2;

export interface GuardInput {
  source: string;
  output: string;
  terms: string[];
  context?: string;
}

export function guardCleanupOutput(input: GuardInput & { level?: CleanupLevel }): CleanupVerdict {
  return input.level === "rewrite" ? guardRewriteOutput(input) : guardLightOutput(input);
}

// Rewrite level: the wording may change freely, so word-level checks do not apply. What a rewrite must
// not do, and how each shows up:
//  R1 translate                    -> the output's language differs from the transcript's
//  R2 answer or follow the text    -> far more words than the transcript
//  R3 summarize, drop points       -> far fewer words than the transcript (fillers and a self-correction
//                                     explain some of the loss)
//  R4 change numbers               -> digits that neither appear in the transcript nor were said as words
//  R5 lose names or terms          -> a dictionary term from the transcript is missing
//  R6 make German more formal      -> "Sie" as address where the transcript had none
//  R7 wrap the text                -> labels, quotes, think blocks (stripped by stripWrappers)
//  R8 invent text from fillers     -> any output from a hesitation-only transcript
//  R9 repeat the text before the   -> the last words before the cursor appear in the output in a row,
//     cursor                          but were not spoken
const maxRewriteGrowth = 1.6;
const minRewriteShare = 0.35;
const minRewriteShareWithCorrection = 0.2;

function guardRewriteOutput(input: GuardInput): CleanupVerdict {
  const text = stripWrappers(input.output, input.source);
  const sourceWords = words(input.source);
  const outputWords = words(text);
  const meaningfulSource = sourceWords.filter((word) => !hesitations.has(word));

  if (outputWords.length === 0) {
    return meaningfulSource.length === 0 ? { accepted: true, text: "" } : { accepted: false, reason: "empty output", text };
  }

  if (meaningfulSource.length === 0) {
    return { accepted: false, reason: "text from hesitation sounds only", text };
  }

  if (outputWords.length > meaningfulSource.length * maxRewriteGrowth + 4) {
    return { accepted: false, reason: `output much longer than input (${String(outputWords.length)} vs ${String(meaningfulSource.length)} words)`, text };
  }

  const sourcePhrase = ` ${sourceWords.join(" ")} `;
  const hasCorrection = correctionPhrases.some((phrase) => sourcePhrase.includes(` ${phrase} `));
  const minShare = hasCorrection ? minRewriteShareWithCorrection : minRewriteShare;
  if (meaningfulSource.length >= 8 && outputWords.length < meaningfulSource.length * minShare) {
    return { accepted: false, reason: `output much shorter than input (${String(outputWords.length)} vs ${String(meaningfulSource.length)} words)`, text };
  }

  const sourceLanguage = guessLanguage(sourceWords);
  const outputLanguage = guessLanguage(outputWords);
  if (sourceLanguage && outputLanguage && sourceLanguage !== outputLanguage) {
    return { accepted: false, reason: `changed language from ${sourceLanguage} to ${outputLanguage}`, text };
  }

  if (repeatsContext(words(input.context ?? ""), sourceWords, outputWords)) {
    return { accepted: false, reason: "repeated the text before the cursor", text };
  }

  const known = new Set([...sourceWords, ...input.terms.flatMap(words), ...words(input.context ?? "")]);
  const sourceHasNumberWords = sourceWords.some((word) => numberWords.has(word) || isCompoundNumberWord(word));
  const newNumbers = outputWords.filter((word) => /\d/.test(word) && !known.has(word) && !sourceHasNumberWords);
  if (newNumbers.length > 0) {
    return { accepted: false, reason: `changed numbers: ${newNumbers.join(", ")}`, text };
  }

  if (/(?<!^|[.!?:]\s)\bSie\b/u.test(text) && !/\bsie\b/iu.test(input.source)) {
    return { accepted: false, reason: "changed du to Sie", text };
  }

  const lostTerm = findLostTerm(input, text);
  if (lostTerm) {
    return { accepted: false, reason: `dropped term "${lostTerm}"`, text };
  }

  return { accepted: true, text };
}

/** The last few words before the cursor, in order, in the output but not in what was said. */
function repeatsContext(contextWords: string[], sourceWords: string[], outputWords: string[]): boolean {
  const tail = contextWords.slice(-4);
  if (tail.length < 3) {
    return false;
  }
  const phrase = ` ${tail.join(" ")} `;
  return ` ${outputWords.join(" ")} `.includes(phrase) && !` ${sourceWords.join(" ")} `.includes(phrase);
}

// Frequent function words that exist in only one of the two languages ("in", "so", "also", "was", "will",
// "an" are in both); a short dictation has a few of them even when it is full of English terms.
const englishMarkers = new Set([
  "the", "and", "is", "are", "to", "of", "a", "you", "i", "we", "it", "that", "this", "for", "with", "have", "has",
  "be", "not", "can", "please", "on", "my", "your", "what", "do", "does", "yes", "no", "but", "or", "if", "because",
  "were", "from", "at", "by", "they", "our", "there", "would", "should", "could"
]);
const germanMarkers = new Set([
  "der", "die", "das", "und", "ist", "sind", "zu", "ich", "du", "wir", "es", "nicht", "ein", "eine", "mit", "für",
  "auf", "dass", "den", "dem", "bitte", "kannst", "wie", "noch", "auch", "mir", "uns", "sie", "haben", "habe", "wird",
  "im", "kann", "werden", "ja", "nein", "bei", "von", "zum", "zur", "aber", "oder", "wenn", "weil", "sich", "ihr",
  "mein", "dein", "wollte", "können", "müssen", "diese", "dieser", "bleiben"
]);

/** "en", "de" or null when the text is too short or too mixed to tell. */
function guessLanguage(textWords: string[]): "en" | "de" | null {
  const english = textWords.filter((word) => englishMarkers.has(word)).length;
  const german = textWords.filter((word) => germanMarkers.has(word)).length;

  if (english >= 2 && english > german * 2) {
    return "en";
  }
  if (german >= 2 && german > english * 2) {
    return "de";
  }
  return null;
}

function findLostTerm(input: GuardInput, text: string): string | undefined {
  const lowerSource = input.source.toLowerCase();
  const lowerOutput = text.toLowerCase();
  return input.terms.find((term) => lowerSource.includes(term.toLowerCase()) && !lowerOutput.includes(term.toLowerCase()));
}

function guardLightOutput(input: GuardInput): CleanupVerdict {
  const text = stripWrappers(input.output, input.source);
  const sourceWords = words(input.source);
  const outputWords = words(text);

  if (outputWords.length === 0) {
    return sourceWords.every((word) => hesitations.has(word))
      ? { accepted: true, text: "" }
      : { accepted: false, reason: "empty output", text };
  }

  if (outputWords.length > sourceWords.length * maxLengthRatio + 2) {
    return { accepted: false, reason: `output longer than input (${String(outputWords.length)} vs ${String(sourceWords.length)} words)`, text };
  }

  // Words from the text before the cursor may appear (a name spelled as already typed), but they do not
  // count as source words for the length and dropped-word checks.
  const known = new Set([...sourceWords, ...input.terms.flatMap(words), ...words(input.context ?? "")]);
  const joinedSource = sourceWords.join("");
  const sourceHasNumberWords = sourceWords.some((word) => numberWords.has(word) || isCompoundNumberWord(word));
  const added = outputWords.filter((word) => !isExplained(word, known, joinedSource, sourceHasNumberWords));
  // Small rewordings ("it is" -> "This is", a real ASR fix) are fine; an answer, a followed instruction or
  // a translation adds far more than this, and the length and du/Sie checks below catch those too.
  const allowedNovel = Math.max(1, Math.floor(outputWords.length * 0.1));

  if (added.length > allowedNovel) {
    return { accepted: false, reason: `added words: ${[...new Set(added)].slice(0, 8).join(", ")}`, text };
  }

  const addedNumbers = added.filter((word) => /\d/.test(word));
  if (addedNumbers.length > 0) {
    return { accepted: false, reason: `changed numbers: ${addedNumbers.join(", ")}`, text };
  }

  // Small models like to make German more formal ("Ruf an" -> "Rufen Sie an").
  if (/(?<!^|[.!?:]\s)\bSie\b/u.test(text) && !/\bsie\b/iu.test(input.source)) {
    return { accepted: false, reason: "changed du to Sie", text };
  }

  const dropped = droppedWords(sourceWords, outputWords).filter((word) => !removableWords.has(word) && !hesitations.has(word));
  const sourcePhrase = ` ${sourceWords.join(" ")} `;
  const hasCorrection = correctionPhrases.some((phrase) => sourcePhrase.includes(` ${phrase} `));
  const allowedDropped = Math.max(1, Math.floor(sourceWords.length * (hasCorrection ? 0.6 : 0.15)));

  if (dropped.length > allowedDropped) {
    return { accepted: false, reason: `dropped words: ${dropped.slice(0, 8).join(", ")}`, text };
  }

  const lostTerm = findLostTerm(input, text);
  if (lostTerm) {
    return { accepted: false, reason: `dropped term "${lostTerm}"`, text };
  }

  return { accepted: true, text };
}

function isExplained(word: string, known: Set<string>, joinedSource: string, sourceHasNumberWords: boolean): boolean {
  if (known.has(word) || allowedAdditions.has(word)) {
    return true;
  }

  if (/\d/.test(word)) {
    // Digits are fine when the speaker said numbers in words ("twenty five" -> "25", "3rd").
    return sourceHasNumberWords;
  }

  // Joined or split compounds ("e mail" -> "email", "Kunden auftrag" -> "Kundenauftrag").
  if (word.length >= 4 && joinedSource.includes(word)) {
    return true;
  }

  // Spelling and casing fixes of a word that was said ("recieve" -> "receive").
  const maxDistance = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  return maxDistance > 0 && [...known].some((candidate) => Math.abs(candidate.length - word.length) <= maxDistance && editDistance(candidate, word) <= maxDistance);
}

/** Source words that no longer appear in the output at all (repeats of a kept word are not counted). */
function droppedWords(sourceWords: string[], outputWords: string[]): string[] {
  const kept = new Set(outputWords);
  const joinedOutput = outputWords.join("");
  return sourceWords.filter((word) => !kept.has(word) && !(word.length >= 4 && joinedOutput.includes(word)) && !/\d/.test(word));
}

function isCompoundNumberWord(word: string): boolean {
  return /(zig|ßig|hundert|tausend|teen|ty)$/.test(word) || /^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und/.test(word);
}

/** Removes things a small model wraps around its answer: think blocks, transcript tags, a label line, quotes. */
export function stripWrappers(output: string, source: string): string {
  let text = output
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/<\/?transcript>/gi, "")
    .trim();

  text = text.replace(/^(here is|here's|hier ist|cleaned|bereinigt|cleaned text|bereinigter text)[^\n]*:\s*\n/i, "").trim();

  const quoted = /^(["„“”'])([\s\S]*)(["“”'])$/.exec(text);
  if (quoted && !/^["„“”']/.test(source.trim())) {
    text = quoted[2].trim();
  }

  return text;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    // "customer's", "customers'" and "customers" are the same word; splitting at the apostrophe would
    // count a stray "s" as added when the transcript had no apostrophe.
    .replace(/['’ʼ]/g, "")
    .replace(/[-–—/]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }

  return previous[right.length];
}
