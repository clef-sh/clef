# @clef-sh/design

Single source of truth for the Clef design system. Both Clef Cloud and the
Clef local UI (`packages/ui`) import from this package so token edits land
in one place.

## What's here

- `src/theme.css` — Tailwind v4 `@theme` block. `@import` from any
  Tailwind v4 stylesheet to inherit the full color / type / radius scale.
- `src/theme.ts` — TypeScript mirror of the same values. Exists for
  inline-style call sites that need a hex literal at runtime (legacy
  surfaces during migration; computed colors for SVG fills, etc.).

## Usage

### Tailwind v4 (preferred)

```css
@import "tailwindcss";
@import "@clef-sh/design/theme.css";
```

Then use the generated utility names: `bg-ink-850`, `text-ash-dim`,
`border-edge`, `shadow-plate`, etc.

### TS (during migration / for dynamic colors)

```ts
import { theme, radius, shadow } from "@clef-sh/design";

const fill = theme.gold500;
```

## What's NOT here

- Component primitives (`.clef-plate`, `.clef-stat`, etc.) — those live
  in the consuming surface's own stylesheet. This package ships tokens
  only.
- Icons — see `lucide-react` in the consuming package.

## Editing tokens

Update both `theme.css` and `theme.ts` in lockstep. They mirror each other
1:1 by design; CI does not enforce parity yet (a check is on the
post-migration cleanup list).
