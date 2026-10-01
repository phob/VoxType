// Keeps one llama.cpp `llama-server` process warm on localhost for transcript cleanup.
// Electron-free so the E2E harness drives exactly the same code as the app.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { type ChatMessage } from "../shared/cleanup-prompt";
import { type LlamaRuntimeBackend, type LlmCleanupServerState } from "../shared/llm-cleanup";

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

interface RunningServer {
  configKey: string;
  process: ChildProcess;
  baseUrl: string;
  apiKey: string;
  ready: Promise<void>;
}

const startupTimeoutMs = 120_000;
const contextSize = 4096;
const stderrTailLines = 40;

export class LlamaServer {
  private running: RunningServer | null = null;
  private serverState: LlmCleanupServerState = "stopped";
  private lastError: string | null = null;
  private readonly stderrTail: string[] = [];
  private ensuring: Promise<void> = Promise.resolve();

  get state(): LlmCleanupServerState {
    return this.serverState;
  }

  get error(): string | null {
    return this.lastError;
  }

  /** Starts the server for `config` (restarting it if the config changed) and waits until it is ready. */
  ensure(config: LlamaServerConfig): Promise<void> {
    // Serialized so a warm-up and the first dictation cannot both spawn a server.
    const next = this.ensuring.then(() => this.ensureNow(config));
    this.ensuring = next.catch(() => undefined);
    return next;
  }

  private async ensureNow(config: LlamaServerConfig): Promise<void> {
    const configKey = JSON.stringify([config.executable, config.modelPath, config.backend, config.extraArgs ?? []]);

    if (this.running?.configKey !== configKey) {
      this.stop();
      this.running = await this.start(config, configKey);
    }

    await this.running.ready;
  }

  async chat(messages: ChatMessage[], options: { maxTokens: number; signal?: AbortSignal }): Promise<ChatCompletion> {
    const running = this.running;

    if (!running || this.serverState !== "ready") {
      throw new Error("llama-server is not running.");
    }

    const response = await fetch(`${running.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${running.apiKey}` },
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
    const running = this.running;
    this.running = null;
    this.serverState = "stopped";

    if (running && running.process.exitCode === null) {
      running.process.kill();
    }
  }

  private async start(config: LlamaServerConfig, configKey: string): Promise<RunningServer> {
    const port = await findFreePort();
    const apiKey = randomBytes(24).toString("hex");
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const args = [
      "-m", config.modelPath,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--api-key", apiKey,
      "-ngl", config.backend === "vulkan" ? "all" : "0",
      "-c", String(contextSize),
      "-np", "1",
      "--reasoning", "off",
      "--no-webui",
      ...(config.extraArgs ?? [])
    ];

    this.serverState = "starting";
    this.lastError = null;
    this.stderrTail.length = 0;

    const child = spawn(config.executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail.push(...chunk.split(/\r?\n/).filter(Boolean));
      this.stderrTail.splice(0, Math.max(0, this.stderrTail.length - stderrTailLines));
    });

    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error) => reject(error));
      child.once("exit", (code) => reject(new Error(`llama-server exited with code ${String(code)}: ${this.stderrTail.slice(-6).join(" | ")}`)));
    });
    child.once("exit", () => {
      if (this.running?.process === child) {
        this.running = null;
        this.serverState = "stopped";
      }
    });

    const ready = Promise.race([waitForHealth(baseUrl, apiKey), exited]).then(
      () => {
        if (this.running?.process === child) {
          this.serverState = "ready";
        }
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (this.running?.process === child) {
          this.serverState = "error";
          this.lastError = message;
          this.running = null;
        }
        if (child.exitCode === null) {
          child.kill();
        }
        throw new Error(message, { cause: error });
      }
    );
    // A failed start is reported through ensure(); keep the rejection from surfacing as unhandled.
    ready.catch(() => undefined);
    exited.catch(() => undefined);

    return { configKey, process: child, baseUrl, apiKey, ready };
  }
}

async function waitForHealth(baseUrl: string, apiKey: string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`llama-server did not become ready within ${String(startupTimeoutMs / 1000)} s.`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a local port for llama-server."));
        }
      });
    });
  });
}

function parseChatCompletion(body: unknown): ChatCompletion {
  const choices = isRecord(body) ? body.choices : undefined;
  const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
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
