// Global hotkeys made only of modifiers, such as Ctrl+Win. Electron's globalShortcut needs a
// non-modifier key, so the Windows helper's keyboard hook watches these instead. One helper process
// serves all registered hotkeys; it restarts when the set changes and stops when none are left.
import { type ModifierHotkeyEvent } from "../shared/hotkeys";

/** One press of a modifier-only hotkey. Another key during the press marks it interrupted. */
export interface ModifierHotkeyPress {
  interrupted: boolean;
  /** Set by the handler; called once if the press is interrupted after the handler ran. */
  onInterrupt: (() => void) | null;
}

type WatchModifierHotkeys = (
  accelerators: string[],
  onEvent: (event: ModifierHotkeyEvent) => void,
  onExit: (error: Error) => void
) => Promise<{ stop: () => void }>;

const restartDelayMs = 2_000;

export class ModifierHotkeys {
  private readonly handlers = new Map<string, (press: ModifierHotkeyPress) => void>();
  private watcher: { stop: () => void } | null = null;
  private watchedKey = "";
  private press: ModifierHotkeyPress | null = null;
  private syncing: Promise<void> = Promise.resolve();

  constructor(private readonly watch: WatchModifierHotkeys) {}

  register(accelerator: string, handler: (press: ModifierHotkeyPress) => void): void {
    this.handlers.set(accelerator, handler);
    this.sync();
  }

  unregister(accelerator: string): void {
    if (this.handlers.delete(accelerator)) {
      this.sync();
    }
  }

  private sync(): void {
    // Registrations change in bursts (settings save, fullscreen suspension); apply them in order.
    this.syncing = this.syncing
      .then(() => this.syncNow())
      .catch((error: unknown) => {
        console.warn("[voxtype] modifier hotkeys unavailable", error instanceof Error ? error.message : String(error));
      });
  }

  private async syncNow(): Promise<void> {
    const accelerators = [...this.handlers.keys()].sort();
    const key = accelerators.join("\n");

    if (this.watcher && key === this.watchedKey) {
      return;
    }

    this.watcher?.stop();
    this.watcher = null;
    this.watchedKey = "";

    if (accelerators.length === 0) {
      return;
    }

    this.watcher = await this.watch(
      accelerators,
      (event) => this.handle(event),
      (error) => {
        console.warn("[voxtype] modifier hotkey watcher stopped", error.message);
        this.watcher = null;
        this.watchedKey = "";
        setTimeout(() => this.sync(), restartDelayMs);
      }
    );
    this.watchedKey = key;
  }

  private handle(event: ModifierHotkeyEvent): void {
    if (event.event === "pressed") {
      const handler = this.handlers.get(event.accelerator);
      if (handler) {
        this.press = { interrupted: false, onInterrupt: null };
        handler(this.press);
      }
      return;
    }

    if (event.event === "interrupted" && this.press && !this.press.interrupted) {
      this.press.interrupted = true;
      this.press.onInterrupt?.();
    }
  }
}
