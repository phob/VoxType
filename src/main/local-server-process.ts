// Lifecycle of one local inference server process (llama-server, whisper-server): spawn on a free
// 127.0.0.1 port, wait for a health URL, restart when the launch config changes, stop after idle time.
// Electron-free so the E2E harnesses drive exactly the same code as the app.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export type LocalServerState = "stopped" | "starting" | "ready" | "error";

export interface LocalServerLaunch {
  /** Name used in error messages. */
  name: string;
  executable: string;
  args: (port: number) => string[];
  healthPath: string;
  headers?: Record<string, string>;
}

interface Running {
  key: string;
  process: ChildProcess;
  baseUrl: string;
  ready: Promise<void>;
}

/** The app frees a model after this long without a dictation; the next recording loads it again while the user speaks. */
export const localModelIdleStopMs = 15 * 60_000;

const startupTimeoutMs = 120_000;
const stderrTailLines = 40;

export class LocalServerProcess {
  private running: Running | null = null;
  private serverState: LocalServerState = "stopped";
  private lastError: string | null = null;
  private readonly stderrTail: string[] = [];
  private ensuring: Promise<string> = Promise.resolve("");
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stop the process after this long without `ensure()`; null keeps it running. */
  constructor(private readonly idleStopMs: number | null = null) {}

  get state(): LocalServerState {
    return this.serverState;
  }

  get error(): string | null {
    return this.lastError;
  }

  /**
   * Starts the server for `key` (restarting it when the key changed), waits until it is healthy and
   * returns its base URL. Serialized so a warm-up and a request cannot both spawn a process.
   */
  ensure(key: string, launch: () => LocalServerLaunch): Promise<string> {
    const next = this.ensuring.then(() => this.ensureNow(key, launch));
    this.ensuring = next.catch(() => "");
    this.scheduleIdleStop();
    return next;
  }

  stop(): void {
    const running = this.running;
    this.running = null;
    this.serverState = "stopped";

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (running && running.process.exitCode === null) {
      running.process.kill();
    }
  }

  private async ensureNow(key: string, launch: () => LocalServerLaunch): Promise<string> {
    if (this.running?.key !== key) {
      this.stop();
      this.running = await this.start(key, launch());
    }

    await this.running.ready;
    return this.running.baseUrl;
  }

  private scheduleIdleStop(): void {
    if (this.idleStopMs === null) {
      return;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.stop(), this.idleStopMs);
    // An idle timer must not keep a script (E2E harness) alive.
    this.idleTimer.unref();
  }

  private async start(key: string, launch: LocalServerLaunch): Promise<Running> {
    const port = await findFreePort();
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    this.serverState = "starting";
    this.lastError = null;
    this.stderrTail.length = 0;

    const child = spawn(launch.executable, launch.args(port), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail.push(...chunk.split(/\r?\n/).filter(Boolean));
      this.stderrTail.splice(0, Math.max(0, this.stderrTail.length - stderrTailLines));
    });

    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error) => reject(error));
      child.once("exit", (code) => reject(new Error(`${launch.name} exited with code ${String(code)}: ${this.stderrTail.slice(-6).join(" | ")}`)));
    });
    child.once("exit", () => {
      if (this.running?.process === child) {
        this.running = null;
        this.serverState = "stopped";
      }
    });

    const ready = Promise.race([waitForHealth(`${baseUrl}${launch.healthPath}`, launch), exited]).then(
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

    return { key, process: child, baseUrl, ready };
  }
}

async function waitForHealth(url: string, launch: LocalServerLaunch): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: launch.headers, signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`${launch.name} did not become ready within ${String(startupTimeoutMs / 1000)} s.`);
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
          reject(new Error("Could not allocate a local port."));
        }
      });
    });
  });
}
