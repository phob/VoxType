// Decides whether an LLM-cleaned transcript may replace the original. Cleanup is allowed to delete
// fillers, repeats, spoken punctuation and the corrected part of a self-correction, and to reformat, but
// not to add or drop content: an answered question, a followed instruction, a translation, a preamble or a
// more formal rewording all show up as words the speaker never said; a lost sentence shows up as deleted
// words without a correction phrase. When in doubt the original text is inserted, so a rejection is safe.

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

export function guardCleanupOutput(input: { source: string; output: string; terms: string[] }): CleanupVerdict {
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

  const known = new Set([...sourceWords, ...input.terms.flatMap(words)]);
  const joinedSource = sourceWords.join("");
  const sourceHasNumberWords = sourceWords.some((word) => numberWords.has(word) || isCompoundNumberWord(word));
  const added = outputWords.filter((word) => !isExplained(word, known, joinedSource, sourceHasNumberWords));
  // One new word covers a real ASR fix ("the first think" -> "I think"); more is a rewrite.
  const allowedNovel = Math.max(1, Math.floor(outputWords.length * 0.05));

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

  const lowerOutput = text.toLowerCase();
  const lostTerm = input.terms.find(
    (term) => input.source.toLowerCase().includes(term.toLowerCase()) && !lowerOutput.includes(term.toLowerCase())
  );
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
