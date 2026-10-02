export interface HotkeyStatus {
  showWindowHotkey: string | null;
  dictationToggleHotkey: string | null;
  dictationHoldHotkey: string | null;
  dictationSuspendedForFullscreen: boolean;
  fullscreenProcessName: string | null;
}

const modifierNames = new Set(["commandorcontrol", "control", "ctrl", "alt", "option", "shift", "super", "meta", "win", "windows", "command"]);
const modifierGroups: Record<string, string> = { control: "commandorcontrol", ctrl: "commandorcontrol", option: "alt", meta: "super", win: "super", windows: "super", command: "super" };

/**
 * True for a hotkey made only of modifiers, such as "CommandOrControl+Super" (Ctrl+Win). Electron's
 * globalShortcut cannot register these; the Windows helper's keyboard hook watches them instead.
 * Needs at least two different modifiers so a plain Ctrl or Shift press never starts a dictation.
 */
export function isModifierOnlyAccelerator(accelerator: string): boolean {
  const parts = accelerator
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  return (
    parts.length > 0 &&
    parts.every((part) => modifierNames.has(part)) &&
    new Set(parts.map((part) => modifierGroups[part] ?? part)).size >= 2
  );
}

export type ModifierHotkeyEvent =
  | { event: "ready" }
  /** The held modifiers became exactly this hotkey's set. */
  | { event: "pressed"; accelerator: string }
  /** Another key went down while the hotkey was held (e.g. Ctrl+Win+Right switches desktops). */
  | { event: "interrupted"; accelerator: string };
