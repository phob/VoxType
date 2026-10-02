// The model behind one cleanup: the local llama-server or a cloud model through the user's API key.
// Electron-free so the E2E harness drives exactly the same code as the app.
import Anthropic from "@anthropic-ai/sdk";
import { type ChatMessage } from "../shared/cleanup-prompt";
import { type CloudCleanupModel } from "../shared/llm-cleanup";
import { type LlamaServer, type LlamaServerConfig } from "./llama-server";

export interface ChatCompletion {
  text: string;
  promptTokens: number | null;
  predictedTokens: number | null;
  predictedPerSecond: number | null;
  /** Prompt tokens served from the provider's prompt cache, when it reports them. */
  cachedPromptTokens?: number | null;
}

export interface ChatOptions {
  maxTokens: number;
  signal?: AbortSignal;
}

export interface CleanupChat {
  readonly modelId: string;
  /** Gets the model ready (starts llama-server); a no-op for cloud models. */
  prepare(signal: AbortSignal): Promise<void>;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletion>;
  /** After a failed request: whether one more attempt in the same time budget makes sense. */
  recover(): boolean;
}

export class LocalCleanupChat implements CleanupChat {
  constructor(
    private readonly server: LlamaServer,
    private readonly config: LlamaServerConfig,
    readonly modelId: string
  ) {}

  prepare(signal: AbortSignal): Promise<void> {
    return abortable(this.server.ensure(this.config), signal);
  }

  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletion> {
    return this.server.chat(messages, options);
  }

  recover(): boolean {
    // The server process can die between requests (crash, killed) before its exit is noticed; the next
    // prepare() restarts it.
    this.server.stop();
    return true;
  }
}

const openAiChatUrl = "https://api.openai.com/v1/chat/completions";

export class OpenAiCleanupChat implements CleanupChat {
  readonly modelId: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: CloudCleanupModel
  ) {
    this.modelId = model.id;
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletion> {
    const startedAt = performance.now();
    const response = await fetch(openAiChatUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model.id,
        messages,
        // Reasoning models count reasoning tokens against this limit; with effort "none" there are none.
        max_completion_tokens: options.maxTokens,
        ...(this.model.reasoningEffort ? { reasoning_effort: this.model.reasoningEffort } : {}),
        // Without this, OpenAI may keep the dictation for 30 days for its own evaluations.
        store: false
      }),
      signal: options.signal
    });

    if (!response.ok) {
      throw new Error(await openAiErrorMessage(response));
    }

    return parseOpenAiCompletion(await response.json(), performance.now() - startedAt);
  }

  recover(): boolean {
    return false;
  }
}

async function openAiErrorMessage(response: Response): Promise<string> {
  // Only the error type and code: the message can echo request text, which is the user's dictation.
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const code = typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : null;
  return `OpenAI returned ${String(response.status)}${code ? ` (${code})` : ""}.`;
}

function parseOpenAiCompletion(body: unknown, elapsedMs: number): ChatCompletion {
  const choices = isRecord(body) ? body.choices : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;

  if (typeof content !== "string") {
    throw new Error("OpenAI returned a response without message content.");
  }

  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const predictedTokens = numberOrNull(usage.completion_tokens);

  return {
    text: content,
    promptTokens: numberOrNull(usage.prompt_tokens),
    predictedTokens,
    predictedPerSecond: predictedTokens !== null && elapsedMs > 0 ? predictedTokens / (elapsedMs / 1000) : null,
    cachedPromptTokens: numberOrNull(details.cached_tokens)
  };
}

export class AnthropicCleanupChat implements CleanupChat {
  readonly modelId: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: CloudCleanupModel
  ) {
    this.modelId = model.id;
    // The cleanup has its own time budget and falls back on failure; SDK retries would only overrun it.
    // Endpoint and credentials are explicit: by default the SDK also reads ANTHROPIC_BASE_URL and
    // ANTHROPIC_AUTH_TOKEN, which other tools (Claude Code, proxies) set for their own use, and which
    // would send dictations elsewhere.
    this.client = new Anthropic({ apiKey, authToken: null, baseURL: "https://api.anthropic.com", maxRetries: 0 });
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletion> {
    const startedAt = performance.now();
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const conversation: Anthropic.Beta.BetaMessageParam[] = messages.flatMap((message) =>
      message.role === "system" ? [] : [{ role: message.role, content: message.content }]
    );
    const thinking = this.model.anthropicThinking ?? "off";

    const response = await this.client.beta.messages.create(
      {
        model: this.model.id,
        // A model that always thinks spends part of the budget on thinking before it writes the text.
        max_tokens: options.maxTokens + (thinking === "low-effort" ? 2_000 : 0),
        // The system prompt is the same for every dictation; caching it saves time and cost on models whose
        // minimum cacheable length it reaches (Sonnet and Opus 5.5; Haiku 4.5 needs 4,096 tokens).
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: conversation,
        ...(thinking === "between-tools" ? { thinking: { type: "between_tools" as const }, output_config: { effort: "low" as const } } : {}),
        ...(thinking === "low-effort" ? { output_config: { effort: "low" as const } } : {}),
        // A safety classifier can decline harmless text; "default" lets the API rerun the request on a
        // suitable fallback model instead of returning nothing. Haiku 4.5 does not support it.
        ...(thinking === "off" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const })
      },
      { signal: options.signal }
    );

    if (response.stop_reason === "refusal") {
      throw new Error(`Anthropic declined the request${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`);
    }

    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const elapsedMs = performance.now() - startedAt;

    return {
      text,
      promptTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      predictedTokens: response.usage.output_tokens,
      predictedPerSecond: elapsedMs > 0 ? response.usage.output_tokens / (elapsedMs / 1000) : null,
      cachedPromptTokens: response.usage.cache_read_input_tokens ?? null
    };
  }

  recover(): boolean {
    return false;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
