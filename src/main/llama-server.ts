// Keeps one llama.cpp `llama-server` process warm on localhost for transcript cleanup.
// Electron-free so the E2E harness drives exactly the same code as the app.
import { randomBytes } from "node:crypto";
import { type ChatMessage } from "../shared/cleanup-prompt";
import { type LlamaRuntimeBackend } from "../shared/llm-cleanup";
import { LocalServerProcess, type LocalServerState } from "./local-server-process";

export interface LlamaServerConfig {
  executable: string;
  modelPath: string;
  backend: LlamaRuntimeBackend;
  /** Extra llama-server arguments, e.g. speculative decoding experiments from the E2E harness. */
  extraArgs?: string[];
}

export interface ChatCompletion {
  text: string;
  promptTokens: number | null;
  predictedTokens: number | null;
  predictedPerSecond: number | null;
}

const contextSize = 4096;

export class LlamaServer {
  private readonly process: LocalServerProcess;
  // Other local programs could reach the port; a per-run key keeps them from using the model.
  private readonly apiKey = randomBytes(24).toString("hex");
  private baseUrl: string | null = null;

  constructor(idleStopMs: number | null = null) {
    this.process = new LocalServerProcess(idleStopMs);
  }

  get state(): LocalServerState {
    return this.process.state;
  }

  get error(): string | null {
    return this.process.error;
  }

  /** Starts the server for `config` (restarting it if the config changed) and waits until it is ready. */
  async ensure(config: LlamaServerConfig): Promise<void> {
    const key = JSON.stringify([config.executable, config.modelPath, config.backend, config.extraArgs ?? []]);
    this.baseUrl = await this.process.ensure(key, () => ({
      name: "llama-server",
      executable: config.executable,
      args: (port) => [
        "-m", config.modelPath,
        "--host", "127.0.0.1",
        "--port", String(port),
        "--api-key", this.apiKey,
        "-ngl", config.backend === "vulkan" ? "all" : "0",
        "-c", String(contextSize),
        "-np", "1",
        "--reasoning", "off",
        "--no-webui",
        ...(config.extraArgs ?? [])
      ],
      healthPath: "/health",
      headers: { authorization: `Bearer ${this.apiKey}` }
    }));
  }

  async chat(messages: ChatMessage[], options: { maxTokens: number; signal?: AbortSignal }): Promise<ChatCompletion> {
    if (!this.baseUrl || this.process.state !== "ready") {
      throw new Error("llama-server is not running.");
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        messages,
        temperature: 0,
        max_tokens: options.maxTokens,
        cache_prompt: true,
        chat_template_kwargs: { enable_thinking: false }
      }),
      signal: options.signal
    });

    if (!response.ok) {
      throw new Error(`llama-server returned ${String(response.status)}: ${(await response.text()).slice(0, 300)}`);
    }

    return parseChatCompletion(await response.json());
  }

  stop(): void {
    this.process.stop();
  }
}

function parseChatCompletion(body: unknown): ChatCompletion {
  const choices = isRecord(body) ? body.choices : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;

  if (typeof content !== "string") {
    throw new Error("llama-server returned a response without message content.");
  }

  const timings = isRecord(body) && isRecord(body.timings) ? body.timings : {};

  return {
    text: content,
    promptTokens: numberOrNull(timings.prompt_n),
    predictedTokens: numberOrNull(timings.predicted_n),
    predictedPerSecond: numberOrNull(timings.predicted_per_second)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
