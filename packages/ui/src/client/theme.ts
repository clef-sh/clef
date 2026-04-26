/**
 * Theme re-export — single source of truth lives in `@clef-sh/design`.
 *
 * Pre-Phase-1 this file held the canonical token table. Now that cloud and
 * the local UI both consume `@clef-sh/design/theme.css` (Tailwind v4 `@theme`)
 * and `@clef-sh/design` (TS), this file exists only as a stable import path
 * for screens written before the migration.
 *
 * New code should prefer Tailwind class names (`bg-ink-850`,
 * `text-ash-dim`, etc.). Reach for the TS values only when a runtime hex
 * literal is genuinely required (computed SVG fills, dynamic style props
 * the migration hasn't reached yet).
 *
 * This module will be deleted in Phase 6 once `grep -r "from \"\\.\\./theme\""`
 * inside `packages/ui/src/client/` returns empty.
 */
export {
  theme,
  radius,
  shadow,
  duration,
  space,
  ENV_COLORS,
  SEVERITY_META,
  CATEGORY_META,
} from "@clef-sh/design";
export type { ThemeColor } from "@clef-sh/design";
