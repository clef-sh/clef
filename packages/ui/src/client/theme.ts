/**
 * Design tokens for the local UI.
 *
 * Source of truth: `cloud/static/src/style.css` (@theme block).
 * When cloud tokens change, mirror the edits here. We don't share a
 * package yet because local UI is React inline-styles and cloud is
 * Tailwind v4 @theme — they'd need a CSS-variables bridge. Deferred.
 *
 * Naming convention — flat keys, Pascal-scale-suffix (gold500, ink850).
 * This keeps inline-style sites terse (`theme.gold500` vs `theme.gold[500]`)
 * and preserves the `as const` literal types that existing screens depend on.
 *
 * Back-compat aliases at the bottom (`bg`, `surface`, `accent`, `red`, etc.)
 * point at the canonical tokens so existing screens keep compiling. New code
 * should prefer the canonical names (`theme.ink950`, `theme.gold500`,
 * `theme.stop500`, `theme.bone`, `theme.ashDim`).
 */
export const theme = {
  // ── Surface scale (near-black → elevated) ────────────────────────────
  ink950: "#06070b",
  ink900: "#0a0c12",
  ink850: "#0d1018",
  ink800: "#10131d",
  ink750: "#151925",
  ink700: "#1a1f2e",
  ink600: "#242a3b",
  ink500: "#2f3649",

  // ── Borders ──────────────────────────────────────────────────────────
  edge: "#1c2030",
  edgeStrong: "#2a3146",

  // ── Text ─────────────────────────────────────────────────────────────
  ghost: "#f4f5f8",
  bone: "#e4e6ed",
  ash: "#9ba3b7",
  ashDim: "#6b7388",
  ashDeep: "#464d60",

  // ── Gold accent — full scale ─────────────────────────────────────────
  gold50: "#fff8e6",
  gold100: "#ffe9a8",
  gold200: "#ffd77a",
  gold300: "#ffc24a",
  gold400: "#ffb020",
  gold500: "#f0a500",
  gold600: "#c88400",
  gold700: "#9a6700",
  gold800: "#6b4800",
  gold900: "#3d2900",

  // ── Semantic ─────────────────────────────────────────────────────────
  go500: "#34d399",
  go700: "#065f46",
  go900: "#022c22",
  warn500: "#fbbf24",
  warn700: "#a16207",
  warn900: "#3b2a05",
  stop500: "#f87171",
  stop700: "#991b1b",
  stop900: "#3f0d0d",

  // Local-only (no cloud equivalents yet — used by lint/category UI)
  blue: "#60A5FA",
  blueDim: "#60A5FA18",
  purple: "#A78BFA",
  purpleDim: "#A78BFA18",

  // ── Overlays ─────────────────────────────────────────────────────────
  scrim: "rgba(4, 5, 8, 0.72)",

  // ── Type ─────────────────────────────────────────────────────────────
  mono: "'JetBrains Mono', 'Berkeley Mono', ui-monospace, monospace",
  sans: "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif",
  // Local UI does NOT use Instrument Serif — serif is reserved for the
  // marketing surface where editorial display copy fits.

  // ── Back-compat aliases ──────────────────────────────────────────────
  // Match the pattern from cloud/static/src/style.css lines 66–80. Keep
  // these so existing screens (pre-migration inline styles) don't break.
  bg: "#06070b", // → ink950
  surface: "#0d1018", // → ink850
  surfaceHover: "#10131d", // → ink800
  border: "#1c2030", // → edge
  borderLight: "#2a3146", // → edgeStrong
  accent: "#f0a500", // → gold500
  accentDim: "rgba(240, 165, 0, 0.08)",
  accentHover: "#ffb020", // → gold400
  text: "#e4e6ed", // → bone
  textMuted: "#9ba3b7", // → ash  (previously #6B7280 — bumped for contrast)
  textDim: "#6b7388", // → ashDim (previously #3D4455 — bumped: old failed WCAG AA)
  green: "#34d399", // → go500 (previously #22C55E — aligned with cloud)
  greenDim: "rgba(52, 211, 153, 0.1)",
  red: "#f87171", // → stop500 (previously #EF4444 — aligned with cloud)
  redDim: "rgba(248, 113, 113, 0.1)",
  yellow: "#fbbf24", // → warn500 (already matched)
  yellowDim: "rgba(251, 191, 36, 0.1)",
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];

/**
 * Radius scale (pixels). Matches cloud's `--radius-*` tokens.
 */
export const radius = {
  sm: 4,
  md: 6,
  lg: 10,
  card: 10,
  pill: 999,
} as const;

/**
 * Shadow recipes (strings). Matches cloud's `--shadow-*` tokens.
 * `plate` — elevation for cards; `halo` — gold glow for highlighted surfaces.
 */
export const shadow = {
  plate: "0 1px 0 0 rgba(255, 255, 255, 0.03) inset, 0 24px 48px -24px rgba(0, 0, 0, 0.6)",
  halo: "0 0 0 1px rgba(240, 165, 0, 0.25), 0 10px 40px -10px rgba(240, 165, 0, 0.35)",
  softDrop: "0 8px 32px rgba(0, 0, 0, 0.3)",
} as const;

/**
 * Transition durations (ms). Centralizing so screens agree on pacing.
 */
export const duration = {
  fast: 120,
  base: 160,
  slow: 200,
} as const;

/**
 * Spacing scale (pixels). Not exhaustively adopted yet; use for new UI.
 */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const ENV_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  dev: { color: theme.go500, bg: theme.greenDim, label: "DEV" },
  staging: { color: theme.warn500, bg: theme.yellowDim, label: "STG" },
  production: { color: theme.stop500, bg: theme.redDim, label: "PRD" },
};

export const SEVERITY_META: Record<
  string,
  { color: string; bg: string; icon: string; label: string }
> = {
  error: { color: theme.stop500, bg: theme.redDim, icon: "✕", label: "Error" },
  warning: { color: theme.warn500, bg: theme.yellowDim, icon: "⚠", label: "Warning" },
  info: { color: theme.blue, bg: theme.blueDim, icon: "i", label: "Info" },
};

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  matrix: { label: "Matrix", color: theme.gold500 },
  schema: { label: "Schema", color: theme.blue },
  sops: { label: "SOPS", color: theme.purple },
};
