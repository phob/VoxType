// One cleanup pass: deterministic steps (hesitation sounds, term spellings, chat style), then the LLM
// (local llama-server or a cloud model), then the guard decides whether the LLM's text may be used.
// Never throws: when the LLM fails or is rejected, the deterministic result is used.
import { guardCleanupOutput } from "../shared/cleanup-guard";
import { buildCleanupMessages, buildCleanupRetryMessages, cleanupMaxTokens, type CleanupPromptInput } from "../shared/cleanup-prompt";
import { finishText, stripHesitations } from "../shared/cleanup-text";
import { type CleanupLevel, type LlmCleanupProvider, type TranscriptCleanup } from "../shared/llm-cleanup";
import { type ChatCompletion, type CleanupChat } from "./cleanup-chat";

export interface CleanupRun {
  text: string;
  record: TranscriptCleanup;
  completion: ChatCompletion | null;
}

export async function runCleanup(
  chat: CleanupChat,
  input: CleanupPromptInput & { provider: LlmCleanupProvider; timeoutMs: number }
): Promise<CleanupRun> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(input.timeoutMs);
  const elapsed = () => Math.round(performance.now() - startedAt);
  const level = input.level ?? "light";
  const base = { modelId: chat.modelId, provider: input.provider, level };
  const prepared = stripHesitations(input.text);
  const fallback = finishText(prepared, input.style, input.terms);
  const changedFromInput = (text: string) => (text !== input.text ? { inputText: input.text } : {});
  let completion: ChatCompletion | null = null;

  if (!prepared) {
    return { text: "", completion, record: { status: "applied", ...base, durationMs: elapsed(), inputText: input.text } };
  }

  const messages = buildCleanupMessages({ ...input, level, text: prepared });
  const chatOptions = { maxTokens: cleanupMaxTokens(prepared, level), signal };

  const ask = async () => {
    await chat.prepare(signal);
    return chat.chat(messages, chatOptions);
  };

  try {
    try {
      completion = await ask();
    } catch (error) {
      if (signal.aborted || !chat.recover()) {
        throw error;
      }
      completion = await ask();
    }
  } catch (error) {
    const reason = signal.aborted ? `timed out after ${String(input.timeoutMs)} ms` : error instanceof Error ? error.message : String(error);
    return {
      text: fallback,
      completion,
      record: { status: "failed", reason, ...base, durationMs: elapsed(), ...changedFromInput(fallback) }
    };
  }

  const guard = (output: string) => guardCleanupOutput({ source: input.text, output, terms: input.terms, context: input.textBefore, level });
  let verdict = guard(completion.text);
  let retried = false;

  // One retry with the rejection reason, when there is time: models often fix a single slip
  // (e.g. "du" turned into "Sie") once it is pointed out. Costs one more short request.
  if (!verdict.accepted && elapsed() < input.timeoutMs / 2) {
    retried = true;
    try {
      const second = await chat.chat(buildCleanupRetryMessages(messages, completion.text, verdict.reason, level), chatOptions);
      const secondVerdict = guard(second.text);
      if (secondVerdict.accepted) {
        completion = second;
        verdict = secondVerdict;
      }
    } catch {
      // Keep the first rejection; the deterministic result is used below.
    }
  }

  if (!verdict.accepted) {
    return {
      text: fallback,
      completion,
      record: {
        status: "rejected",
        reason: verdict.reason,
        ...base,
        durationMs: elapsed(),
        rejectedText: verdict.text,
        retried,
        ...changedFromInput(fallback)
      }
    };
  }

  const text = finishText(verdict.text, input.style, input.terms);

  return {
    text,
    completion,
    record: {
      status: text === input.text ? "unchanged" : "applied",
      ...base,
      durationMs: elapsed(),
      ...(retried ? { retried } : {}),
      ...changedFromInput(text)
    }
  };
}

/** No model call (not installed, no key, cloud blocked): only the deterministic steps, recorded as failed. */
export function skipCleanup(
  input: CleanupPromptInput & { provider: LlmCleanupProvider; modelId: string },
  reason: string
): CleanupRun {
  const text = finishText(stripHesitations(input.text), input.style, input.terms);

  return {
    text,
    completion: null,
    record: {
      status: "failed",
      reason,
      modelId: input.modelId,
      provider: input.provider,
      level: input.level ?? "light",
      durationMs: 0,
      ...(text !== input.text ? { inputText: input.text } : {})
    }
  };
}

/**
 * First local requests are slow (GPU shader compilation, empty prompt cache); pay that before a real
 * dictation. A cold model load has no time limit here.
 */
export async function warmUpCleanup(chat: CleanupChat, level: CleanupLevel = "light"): Promise<void> {
  await chat.prepare(new AbortController().signal);
  await chat.chat(buildCleanupMessages({ text: "um so this is a test", style: "default", level, terms: [] }), { maxTokens: 16 });
}
