// Minimal Chrome DevTools Protocol client for the app-level E2E harnesses: finds VoxType's main window
// on the remote-debugging port and evaluates expressions against the real preload API.
import { writeFileSync } from "node:fs";

export interface RendererPage {
  evaluate<T>(expression: string): Promise<T>;
  screenshotSettings(path: string): Promise<void>;
  quitApp(): Promise<void>;
}

export async function connectToRenderer(port: number): Promise<RendererPage> {
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`).catch(() => null);
    const list = response?.ok ? ((await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>) : [];
    return list.find((target) => target.type === "page" && target.url.includes("index.html") && !target.url.includes("overlay")) ?? null;
  }, 30_000);
  if (!targets) {
    throw new Error("VoxType window did not appear on the DevTools port.");
  }

  const socket = await openSocket(targets.webSocketDebuggerUrl);
  await waitFor(async () => ((await send<{ result: { value: boolean } }>(socket, "Runtime.evaluate", { expression: "Boolean(window.voxtype)", returnByValue: true })).result.value ? true : null), 30_000);

  return {
    async evaluate<T>(expression: string): Promise<T> {
      const reply = await send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }>(socket, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception?.description ?? "evaluate failed");
      }
      return reply.result.value;
    },
    async screenshotSettings(path: string): Promise<void> {
      // Settings were changed over IPC behind React's back; reload so the page shows the stored state.
      await send(socket, "Page.reload", {});
      await waitFor(async () => ((await send<{ result: { value: boolean } }>(socket, "Runtime.evaluate", { expression: "Boolean(document.querySelector('.release-settings-link'))", returnByValue: true })).result.value ? true : null), 30_000);
      await send(socket, "Runtime.evaluate", {
        expression: "document.querySelector('.release-settings-link')?.click(); document.querySelector('.release-scroll-panel')?.scrollTo(0, 0)"
      });
      await sleep(1_500);
      const shot = await send<{ data: string }>(socket, "Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
    },
    async quitApp(): Promise<void> {
      const version = (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      const browser = await openSocket(version.webSocketDebuggerUrl);
      void send(browser, "Browser.close", {}).catch(() => undefined);
    }
  };
}

let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", () => reject(new Error(`CDP socket failed: ${url}`)));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const waiter = message.id === undefined ? undefined : pending.get(message.id);
      if (waiter && message.id !== undefined) {
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(message.error.message));
        } else {
          waiter.resolve(message.result);
        }
      }
    });
  });
}

function send<T>(socket: WebSocket, method: string, params: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolveReply, reject) => {
    // CDP replies are untyped JSON; callers state the shape of the one method they call.
    pending.set(id, { resolve: (value) => resolveReply(value as T), reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

export async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value !== null) {
      return value;
    }
    await sleep(250);
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
