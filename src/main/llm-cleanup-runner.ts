// One cleanup pass: deterministic steps (hesitation sounds, term spellings, chat style), then the LLM
// through llama-server, then the guard decides whether the LLM's text may be used.
// Never throws: when the LLM fails or is rejected, the deterministic result is used.
import { guardCleanupOutput } from "../shared/cleanup-guard";
import { buildCleanupMessages, cleanupMaxTokens, type CleanupPromptInput } from "../shared/cleanup-prompt";
import { finishText, stripHesitations } from "../shared/cleanup-text";
import { type TranscriptCleanup } from "../shared/llm-cleanup";
import { type ChatCompletion, type LlamaServer, type LlamaServerConfig } from "./llama-server";

export interface CleanupRun {
  text: string;
  record: TranscriptCleanup;
  completion: ChatCompletion | null;
}

export async function runCleanup(
  server: LlamaServer,
  config: LlamaServerConfig,
  input: CleanupPromptInput & { modelId: string; timeoutMs: number }
): Promise<CleanupRun> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(input.timeoutMs);
  const elapsed = () => Math.round(performance.now() - startedAt);
  const prepared = stripHesitations(input.text);
  const fallback = finishText(prepared, input.style, input.terms);
  const changedFromInput = (text: string) => (text !== input.text ? { inputText: input.text } : {});
  let completion: ChatCompletion | null = null;

  if (!prepared) {
    return { text: "", completion, record: { status: "applied", modelId: input.modelId, durationMs: elapsed(), inputText: input.text } };
  }

  try {
    await abortable(server.ensure(config), signal);
    completion = await server.chat(buildCleanupMessages({ ...input, text: prepared }), { maxTokens: cleanupMaxTokens(prepared), signal });
  } catch (error) {
    const reason = signal.aborted ? `timed out after ${String(input.timeoutMs)} ms` : error instanceof Error ? error.message : String(error);
    return {
      text: fallback,
      completion,
      record: { status: "failed", reason, modelId: input.modelId, durationMs: elapsed(), ...changedFromInput(fallback) }
    };
  }

  const verdict = guardCleanupOutput({ source: input.text, output: completion.text, terms: input.terms });

  if (!verdict.accepted) {
    return {
      text: fallback,
      completion,
      record: {
        status: "rejected",
        reason: verdict.reason,
        modelId: input.modelId,
        durationMs: elapsed(),
        rejectedText: verdict.text,
        ...changedFromInput(fallback)
      }
    };
  }

  const text = finishText(verdict.text, input.style, input.terms);

  return {
    text,
    completion,
    record: { status: text === input.text ? "unchanged" : "applied", modelId: input.modelId, durationMs: elapsed(), ...changedFromInput(text) }
  };
}

/** First requests are slow (GPU shader compilation, empty prompt cache); pay that before a real dictation. */
export async function warmUpCleanup(server: LlamaServer, config: LlamaServerConfig): Promise<void> {
  await server.ensure(config);
  await server.chat(buildCleanupMessages({ text: "um so this is a test", style: "default", terms: [] }), { maxTokens: 16 });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
