// Removes text Whisper produces for non-speech: annotations, stock phrases decoded over silence,
// prompt echoes and repetition loops. Every rule needs a specific trigger so real dictation passes.

export interface WhisperSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Lowest probability among the segment's text tokens, when Whisper reported tokens. */
  minTokenProbability: number | null;
}

export interface FilteredSegment {
  text: string;
  reason:
    | "annotation"
    | "subtitle-credit"
    | "low-confidence-short"
    | "outside-speech"
    | "prompt-echo"
    | "repeated-segment"
    | "repetition-loop";
}

// A chunk with less detected speech than this is an isolated sound (breath, cough, click) or a
// very short utterance; Whisper output for it is only trusted when every word is confident.
const SHORT_CHUNK_SPEECH_MS = 1_000;
const CONFIDENT_TOKEN_PROBABILITY = 0.5;

// Phrases Whisper learned from subtitle credits; nobody dictates these.
const SUBTITLE_CREDITS = [
  /\bsubtitles? (?:by|created by)\b/,
  /\bamara ?\.? ?org\b/,
  /\buntertitel(?:ung)? (?:im auftrag|der|von|des)\b/,
  /\bsous[- ]titr(?:es|age)\b.*\b(?:amara|réalisés)\b/,
  /\bthanks? (?:you )?for watching\b/,
  /\bdanke (?:fürs|für's) zuschauen\b/,
  /\bplease subscribe\b/,
  /\babonniert? (?:den|meinen) kanal\b/
];

// Short phrases Whisper invents over silence or noise but which people also really say. They are
// only removed when Whisper was unsure of a word (invented text typically starts with a
// low-probability token) or placed them where the VAD found almost no speech.
const SILENCE_PHRASES = new Set([
  "thank you", "thanks", "thank you very much", "thank you so much", "bye", "bye bye", "you",
  "i'm sorry", "sorry", "i don't know", "vielen dank", "danke", "danke schön", "tschüss",
  "bis zum nächsten mal", "merci", "gracias", "okay", "ok"
]);

const NON_SPEECH_WORDS =
  /\b(?:music|musik|musique|música|applause|applaus|laugh\w*|lach\w*|silence|stille|noise|geräusch\w*|inaudible|unverständlich|blank_audio|blank audio|sigh\w*|seufz\w*|cough\w*|hust\w*|breath\w*|atm\w*|typing|tipp\w*|background|hintergrund\w*|no speech|keine sprache)\b/i;

export function filterWhisperSegments(
  segments: WhisperSegment[],
  context: { speechSpansMs: Array<{ startMs: number; endMs: number }>; prompt: string | null }
): { text: string; removed: FilteredSegment[] } {
  const removed: FilteredSegment[] = [];
  // Whisper may split a segment inside a word ("Mü" + "ller"); a segment that starts a new word begins
  // with a space, so that space decides how segments are joined.
  const kept: Array<{ text: string; newWord: boolean }> = [];
  const normalizedPrompt = context.prompt ? ` ${normalize(context.prompt)} ` : "";

  for (const segment of segments) {
    const withoutAnnotations = stripAnnotations(segment.text);
    if (withoutAnnotations !== segment.text.trim()) {
      removed.push({ text: segment.text.trim(), reason: "annotation" });
    }

    const text = withoutAnnotations;
    const normalized = normalize(text);
    if (!normalized) {
      continue;
    }

    if (SUBTITLE_CREDITS.some((pattern) => pattern.test(normalized))) {
      removed.push({ text, reason: "subtitle-credit" });
      continue;
    }

    const unsure = segment.minTokenProbability !== null && segment.minTokenProbability < CONFIDENT_TOKEN_PROBABILITY;

    if (unsure && totalSpeechMs(context.speechSpansMs) < SHORT_CHUNK_SPEECH_MS) {
      removed.push({ text, reason: "low-confidence-short" });
      continue;
    }

    if (SILENCE_PHRASES.has(normalized) && (unsure || speechOverlapMs(segment, context.speechSpansMs) < 150)) {
      removed.push({ text, reason: "outside-speech" });
      continue;
    }

    if (normalizedPrompt && normalized.split(" ").length >= 3 && normalizedPrompt.includes(` ${normalized} `)) {
      removed.push({ text, reason: "prompt-echo" });
      continue;
    }

    if (kept.length > 0 && normalize(kept[kept.length - 1].text) === normalized && normalized.split(" ").length >= 2) {
      removed.push({ text, reason: "repeated-segment" });
      continue;
    }

    kept.push({ text, newWord: /^\s/.test(segment.text) });
  }

  const joined = kept
    .map((item, index) => (index > 0 && item.newWord ? ` ${item.text}` : item.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const collapsed = collapseRepetitionLoops(joined);
  if (collapsed !== joined) {
    removed.push({ text: joined, reason: "repetition-loop" });
  }

  return { text: collapsed, removed };
}

function stripAnnotations(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[(*]([^)*]*)[)*]/g, (match: string, inner: string) => (NON_SPEECH_WORDS.test(inner) ? " " : match))
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function totalSpeechMs(spans: Array<{ startMs: number; endMs: number }>): number {
  return spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
}

// Whisper segments start where the previous one ended, so they include the pause before the words;
// compare absolute overlap with detected speech rather than a ratio.
function speechOverlapMs(segment: WhisperSegment, spans: Array<{ startMs: number; endMs: number }>): number {
  return spans.reduce(
    (sum, span) => sum + Math.max(0, Math.min(segment.endMs, span.endMs) - Math.max(segment.startMs, span.startMs)),
    0
  );
}

// Whisper loops repeat a phrase back to back. Collapse a sequence of 2-8 words that repeats three or
// more times in a row, or a single word repeated five or more times.
function collapseRepetitionLoops(text: string): string {
  const words = text.split(" ");
  const output: string[] = [];
  let index = 0;

  while (index < words.length) {
    let collapsed = false;

    for (let size = 8; size >= 1; size -= 1) {
      const minRepeats = size === 1 ? 5 : 3;
      const unit = words.slice(index, index + size).map(normalize).join(" ");
      if (!unit || index + size * minRepeats > words.length) {
        continue;
      }

      let repeats = 1;
      while (words.slice(index + repeats * size, index + (repeats + 1) * size).map(normalize).join(" ") === unit) {
        repeats += 1;
      }

      if (repeats >= minRepeats) {
        output.push(...words.slice(index, index + size));
        index += repeats * size;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      output.push(words[index]);
      index += 1;
    }
  }

  return output.join(" ");
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s._-]/gu, " ")
    .replace(/[._-]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
