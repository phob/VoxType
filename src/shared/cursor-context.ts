// Text around the cursor in the target app, read through UI Automation when dictation starts.
// Local only: it is context for the local cleanup model and is never sent to a cloud provider.

export interface CursorContext {
  /** Text before the cursor, at most `cursorContextMaxBefore` characters. */
  before: string;
  /** Text the dictation will replace. */
  selection: string;
  source: "caret" | "selection" | "value";
}

export const cursorContextMaxBefore = 600;

export function parseCursorContext(value: unknown): CursorContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  // Checked to be a non-null object above; fields are validated one by one below.
  const record = value as Record<string, unknown>;
  const source = record.source;

  if (record.isPassword === true || (source !== "caret" && source !== "selection" && source !== "value")) {
    return null;
  }

  const before = normalizeNewlines(typeof record.before === "string" ? record.before : "").slice(-cursorContextMaxBefore);
  const selection = normalizeNewlines(typeof record.selection === "string" ? record.selection : "");

  return before.trim() || selection.trim() ? { before, selection, source } : null;
}

// Rich edit controls report paragraph breaks as "\r" (Notepad: "\r\r" for one empty line).
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
