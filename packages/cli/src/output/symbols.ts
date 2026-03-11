export const symbols = {
  // Status
  success: "\u2713",
  failure: "\u2717",
  warning: "\u26A0",
  info: "\u2139",
  pending: "\u23F3",
  working: "\u27F3",
  skipped: "\u21B7",

  // Actions / next steps
  arrow: "\u2192",

  // Domain concepts
  key: "\uD83D\uDD11",
  locked: "\uD83D\uDD12",
  copied: "\uD83D\uDCCB",
  deleted: "\uD83D\uDDD1",
  recipient: "\uD83D\uDC64",

  // Command identity (used in help banner only)
  clef: "\uD834\uDD1E",
} as const;

export type SymbolKey = keyof typeof symbols;

const plainMap: Record<SymbolKey, string> = {
  success: "[ok]",
  failure: "[fail]",
  warning: "[warn]",
  info: "[info]",
  pending: "[pending]",
  working: "[working]",
  skipped: "[skip]",
  arrow: "-->",
  key: "",
  locked: "",
  copied: "",
  deleted: "",
  recipient: "",
  clef: "clef",
};

let _plain = false;

export function setPlainMode(plain: boolean): void {
  _plain = plain;
}

export function isPlainMode(): boolean {
  if (_plain) return true;
  if (process.env.NO_COLOR === "1") return true;
  if (process.env.TERM === "dumb") return true;
  return false;
}

export function sym(key: SymbolKey): string {
  return isPlainMode() ? plainMap[key] : symbols[key];
}
