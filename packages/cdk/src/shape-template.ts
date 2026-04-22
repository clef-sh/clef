/**
 * Shape-template parser and validator for {@link ClefSecret}.
 *
 * The construct accepts a `shape` prop that can take one of three forms:
 *
 *   - **`undefined`** — passthrough, envelope stored verbatim as JSON.
 *
 *   - **`string`** — single-value secret. The template is interpolated and
 *     the result becomes the raw `SecretString` (no JSON wrapping).
 *
 *         shape: "postgres://${USER}:${PASS}@${HOST}:5432/db"
 *
 *   - **`Record<string, string>`** — JSON secret. Each value is a template.
 *
 *         shape: {
 *           dbHost: "${DATABASE_HOST}",       // pure ref
 *           region: "us-east-1",              // literal
 *           conn:   "postgres://${USER}:${PASS}@${HOST}:5432/db",
 *         }
 *
 * At synth time we verify every `${VAR}` reference matches a key present
 * in the envelope (sourced from pack-helper's sidecar). Missing references
 * fail loud with a message listing the bad ref, the field it appeared in,
 * the identity/env, and the set of valid keys.
 *
 * At deploy time the unwrap Lambda applies the same template using the
 * decrypted envelope values.
 */

/** Public type mirror for the construct's `shape` prop. */
export type ShapeTemplate = string | Record<string, string>;

/** Matches `${IDENTIFIER}` where identifier is word-chars only. */
const REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface ValidateShapeArgs {
  /** The shape value the user passed to the construct. */
  shape: ShapeTemplate;
  /** Plaintext key names from the envelope. */
  availableKeys: string[];
  /** For the error message — helps users locate the offending clef.yaml entry. */
  identity: string;
  /** For the error message. */
  environment: string;
}

/**
 * Validate a shape against the available envelope keys. Throws with a
 * precise, reviewer-friendly message on the first unknown reference. Does
 * not throw on literals or well-formed references.
 */
export function validateShape(args: ValidateShapeArgs): void {
  const available = new Set(args.availableKeys);
  if (typeof args.shape === "string") {
    validateOneField("<value>", args.shape, available, args);
    return;
  }
  if (args.shape === null || typeof args.shape !== "object") {
    throw new Error(
      `ClefSecret shape must be a string or an object of strings, got ${typeof args.shape}.`,
    );
  }
  for (const [field, template] of Object.entries(args.shape)) {
    if (typeof template !== "string") {
      throw new Error(
        `ClefSecret shape['${field}'] must be a string, got ${typeof template}. ` +
          `Shape values are literal strings with optional \${KEY} references to Clef values.`,
      );
    }
    validateOneField(`shape['${field}']`, template, available, args);
  }
}

function validateOneField(
  location: string,
  template: string,
  available: Set<string>,
  args: ValidateShapeArgs,
): void {
  for (const ref of extractRefs(template)) {
    if (!available.has(ref)) {
      throw new Error(buildUnknownRefMessage(location, ref, args));
    }
  }
}

/** Return the set of unique `${VAR}` references in a template string. */
export function extractRefs(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(REF_PATTERN)) {
    seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Substitute `${VAR}` references in a template using a lookup map. Literals
 * pass through untouched. Unknown refs throw — the unwrap Lambda should
 * never see them because synth-time validation catches them first, but
 * better a loud deploy failure than a silent empty-string substitution if
 * something slips through.
 */
export function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(REF_PATTERN, (_, name: string) => {
    if (!(name in values)) {
      throw new Error(
        `Template reference \${${name}} has no matching value in the envelope ` +
          `(synth-time validation should have caught this — please file a bug).`,
      );
    }
    return values[name];
  });
}

/**
 * Apply a whole shape against decrypted values. Returns either a scalar
 * string (when `shape` was a string template) or a mapped object (when
 * `shape` was a Record).
 */
export function applyShape(
  shape: ShapeTemplate,
  values: Record<string, string>,
): string | Record<string, string> {
  if (typeof shape === "string") {
    return applyTemplate(shape, values);
  }
  const out: Record<string, string> = {};
  for (const [field, template] of Object.entries(shape)) {
    out[field] = applyTemplate(template, values);
  }
  return out;
}

function buildUnknownRefMessage(location: string, ref: string, args: ValidateShapeArgs): string {
  const sortedKeys = [...args.availableKeys].sort();
  // When the typo is close to a real key, surface the likely intent first.
  const suggestion = findClosestKey(ref, sortedKeys);

  const lines: string[] = [
    ``,
    `ClefSecret shape error:`,
    ``,
    `  ${location} references unknown Clef key: \${${ref}}`,
    `  identity:    ${args.identity}`,
    `  environment: ${args.environment}`,
    ``,
  ];
  if (suggestion) {
    lines.push(`  Did you mean \${${suggestion}}?`);
    lines.push(``);
  }
  lines.push(`  Valid keys (${sortedKeys.length}) for this identity/environment:`);
  if (sortedKeys.length === 0) {
    lines.push(`    (none — did you forget to set any values?)`);
  } else {
    for (const key of sortedKeys) {
      lines.push(`    - ${key}`);
    }
  }
  lines.push(``);
  lines.push(
    `  Fix: correct the reference in your CDK stack, or add the key to ` +
      `clef.yaml and run \`clef set\` to populate it.`,
  );
  lines.push(``);
  return lines.join("\n");
}

/**
 * Simple edit-distance heuristic for "did you mean?" suggestions. Only
 * proposes a match when it's close enough that a typo is plausible.
 */
function findClosestKey(input: string, candidates: string[]): string | null {
  let best: { key: string; dist: number } | null = null;
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (best === null || dist < best.dist) {
      best = { key: candidate, dist };
    }
  }
  if (!best) return null;
  // Only suggest when the edit distance is under ~⅓ of the input length —
  // avoids noise suggestions for totally unrelated strings.
  const threshold = Math.max(1, Math.floor(input.length / 3));
  return best.dist <= threshold ? best.key : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1;
      prev = temp;
    }
  }
  return dp[b.length];
}
