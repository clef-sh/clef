export const theme = {
  bg: "#0A0B0D",
  surface: "#111318",
  surfaceHover: "#161A22",
  border: "#1E2330",
  borderLight: "#252D3D",
  accent: "#F0A500",
  accentDim: "#F0A50022",
  accentHover: "#FFB733",
  green: "#22C55E",
  greenDim: "#22C55E18",
  red: "#EF4444",
  redDim: "#EF444418",
  yellow: "#FBBF24",
  yellowDim: "#FBBF2418",
  blue: "#60A5FA",
  blueDim: "#60A5FA18",
  purple: "#A78BFA",
  purpleDim: "#A78BFA18",
  text: "#E8EAF0",
  textMuted: "#6B7280",
  textDim: "#3D4455",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];

export const ENV_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  dev: { color: theme.green, bg: theme.greenDim, label: "DEV" },
  staging: { color: theme.yellow, bg: theme.yellowDim, label: "STG" },
  production: { color: theme.red, bg: theme.redDim, label: "PRD" },
};

export const SEVERITY_META: Record<
  string,
  { color: string; bg: string; icon: string; label: string }
> = {
  error: { color: theme.red, bg: theme.redDim, icon: "\u2715", label: "Error" },
  warning: { color: theme.yellow, bg: theme.yellowDim, icon: "\u26A0", label: "Warning" },
  info: { color: theme.blue, bg: theme.blueDim, icon: "i", label: "Info" },
};

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  matrix: { label: "Matrix", color: theme.accent },
  schema: { label: "Schema", color: theme.blue },
  sops: { label: "SOPS", color: theme.purple },
};
