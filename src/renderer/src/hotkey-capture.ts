const modifierOrder = ["Control", "Alt", "Shift", "Meta"] as const;

const keyAliases: Record<string, string> = {
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Control: "",
  Meta: "",
  Alt: "",
  Shift: "",
  Escape: "",
  Esc: ""
};

export function eventToAccelerator(event: KeyboardEvent): string | null {
  const modifiers = modifierOrder.filter((modifier) => event.getModifierState(modifier));
  const key = normalizeKey(event.key);

  if (!key) {
    return null;
  }

  return [...modifiers.map(normalizeModifier), key].join("+");
}

function normalizeModifier(modifier: (typeof modifierOrder)[number]): string {
  if (modifier === "Control") {
    return "CommandOrControl";
  }

  if (modifier === "Meta") {
    return "Super";
  }

  return modifier;
}

function normalizeKey(key: string): string | null {
  if (key in keyAliases) {
    return keyAliases[key] || null;
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  if (/^F\d{1,2}$/i.test(key)) {
    return key.toUpperCase();
  }

  if (/^(Digit|Numpad)(\d)$/.test(key)) {
    return key.slice(-1);
  }

  return key;
}

