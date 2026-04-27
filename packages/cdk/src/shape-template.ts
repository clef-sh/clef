/**
 * Shape-template parser and validator for {@link ClefSecret} and
 * {@link ClefParameter}.
 *
 * The construct accepts a `shape` prop (string or object) plus a `refs`
 * map binding placeholder names to `(namespace, key)` pairs in the Clef
 * envelope. The `__` namespace-key join never appears on the user surface.
 *
 *   shape: 'postgres://{{user}}:{{pass}}@{{host}}:5432/db',
 *   refs: {
 *     user: { namespace: 'database', key: 'DB_USER' },
 *     pass: { namespace: 'database', key: 'DB_PASSWORD' },
 *     host: { namespace: 'database', key: 'DB_HOST' },
 *   },
 *
 * The placeholder syntax is `{{name}}` (Mustache/Handlebars-style) — chosen
 * because `${name}` collides with native JS template-literal interpolation
 * and confuses readers wrapping shapes in backticks. To embed a literal
 * `{{` / `}}` in a shape, escape with `\{\{` / `\}\}`.
 *
 * Validation runs at synth time:
 *   - Every `{{name}}` placeholder must appear in `refs`.
 *   - Every `refs[name]` must point at a `(namespace, key)` that exists in
 *     the envelope (sourced from pack-helper's sidecar).
 *   - Unused `refs` entries are surfaced as warnings (not errors) so iterative
 *     refactoring isn't punished.
 *
 * Application runs at deploy time inside the unwrap Lambda using the same
 * regex and refs map, against the nested decrypted values.
 */

/** Public type mirror for the construct's `shape` prop. */
export type ShapeTemplate = string | Record<string, string>;

/** Binding from a `{{placeholder}}` in a shape to a `(namespace, key)` pair. */
export interface ClefRef {
  /** Clef namespace, must be one of the identity's namespaces. */
  namespace: string;
  /** Key name within the namespace. */
  key: string;
}

/** Map of placeholder name → reference target. */
export type RefsMap = Record<string, ClefRef>;

/**
 * Single regex matches three alternatives in left-to-right order:
 *   - `\{\{` — escaped opening, becomes a literal `{{`
 *   - `\}\}` — escaped closing, becomes a literal `}}`
 *   - `{{NAME}}` — placeholder with capture group on identifier
 *
 * The escapes are matched first so they consume their characters before
 * the placeholder regex has a chance to misread them.
 */
const PATTERN = /\\\{\\\{|\\\}\\\}|\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export interface ValidateShapeArgs {
  /** The shape value the user passed to the construct. */
  shape: ShapeTemplate;
  /** Refs map declared on the construct. May be omitted only when the shape contains no placeholders. */
  refs?: RefsMap;
  /**
   * Available envelope keys keyed by namespace. Sourced from pack-helper's
   * sidecar at synth time.
   */
  availableKeys: Record<string, string[]>;
  /** For error messages — helps users locate the offending clef.yaml entry. */
  identity: string;
  /** For error messages. */
  environment: string;
}

/** Result returned by {@link validateShape}. */
export interface ValidateResult {
  /**
   * Non-fatal warnings. Constructs should surface these via
   * `Annotations.of(scope).addWarning(...)`.
   */
  warnings: string[];
}

/**
 * Validate a shape + refs map against the available envelope keys. Throws
 * on the first hard error with a precise, reviewer-friendly message.
 * Returns warnings (e.g. unused refs) so the caller can attach them to the
 * construct via CDK Annotations.
 */
export function validateShape(args: ValidateShapeArgs): ValidateResult {
  const refs = args.refs ?? {};

  // ── Shape shape (no pun) ────────────────────────────────────────────
  if (typeof args.shape !== "string") {
    if (args.shape === null || typeof args.shape !== "object") {
      throw new Error(
        `ClefSecret shape must be a string or an object of strings, got ${typeof args.shape}.`,
      );
    }
    for (const [field, template] of Object.entries(args.shape)) {
      if (typeof template !== "string") {
        throw new Error(
          `ClefSecret shape['${field}'] must be a string, got ${typeof template}. ` +
            `Shape values are literal strings with optional {{name}} references to Clef values.`,
        );
      }
    }
  }

  // ── Walk the shape, gather all placeholder names ────────────────────
  const placeholders = new Set<string>();
  const placeholderLocations = new Map<string, string>();
  if (typeof args.shape === "string") {
    for (const ref of extractRefs(args.shape)) {
      placeholders.add(ref);
      if (!placeholderLocations.has(ref)) placeholderLocations.set(ref, "<value>");
    }
  } else {
    for (const [field, template] of Object.entries(args.shape)) {
      for (const ref of extractRefs(template)) {
        placeholders.add(ref);
        if (!placeholderLocations.has(ref)) {
          placeholderLocations.set(ref, `shape['${field}']`);
        }
      }
    }
  }

  // ── Every placeholder must have a matching refs entry ───────────────
  for (const name of placeholders) {
    if (!(name in refs)) {
      const location = placeholderLocations.get(name) ?? "<value>";
      throw new Error(
        buildUnknownPlaceholderMessage(location, name, Object.keys(refs).sort(), args),
      );
    }
  }

  // ── Every ref entry must point at a real envelope key ───────────────
  for (const [name, ref] of Object.entries(refs)) {
    if (!ref || typeof ref !== "object") {
      throw new Error(
        `ClefSecret refs['${name}'] must be { namespace: string, key: string }, got ${typeof ref}.`,
      );
    }
    if (typeof ref.namespace !== "string" || ref.namespace.length === 0) {
      throw new Error(`ClefSecret refs['${name}'].namespace must be a non-empty string.`);
    }
    if (typeof ref.key !== "string" || ref.key.length === 0) {
      throw new Error(`ClefSecret refs['${name}'].key must be a non-empty string.`);
    }
    if (!(ref.namespace in args.availableKeys)) {
      throw new Error(
        buildUnknownNamespaceMessage(name, ref, Object.keys(args.availableKeys).sort(), args),
      );
    }
    if (!args.availableKeys[ref.namespace].includes(ref.key)) {
      throw new Error(buildUnknownKeyMessage(name, ref, args.availableKeys[ref.namespace], args));
    }
  }

  // ── Unused refs → warnings ──────────────────────────────────────────
  const warnings: string[] = [];
  for (const name of Object.keys(refs)) {
    if (!placeholders.has(name)) {
      warnings.push(
        `ClefSecret refs['${name}'] is declared but not used by the shape ` +
          `for ${args.identity}/${args.environment}. Remove it or reference it as {{${name}}}.`,
      );
    }
  }

  return { warnings };
}

/** Return the set of unique `{{name}}` placeholders in a template string. */
export function extractRefs(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PATTERN)) {
    // match[1] is only set for the placeholder alternative — escapes leave
    // the capture group undefined. Filter those out.
    if (match[1] !== undefined) seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Substitute `{{name}}` references in a template using the refs map and the
 * decrypted values. `\{\{` / `\}\}` escapes pass through as literal `{{`
 * / `}}`. Unknown placeholders or unresolvable refs throw — the unwrap
 * Lambda should never see these because synth-time validation catches them
 * first, but a loud deploy failure beats a silent empty-string substitution.
 */
export function applyTemplate(
  template: string,
  refs: RefsMap | undefined,
  values: Record<string, Record<string, string>>,
): string {
  return template.replace(PATTERN, (match, name: string | undefined) => {
    if (match === "\\{\\{") return "{{";
    if (match === "\\}\\}") return "}}";
    // Placeholder branch: `name` is the captured identifier.
    if (name === undefined) {
      // Unreachable — regex alternatives are exhaustive.
      throw new Error(`Internal: shape regex matched '${match}' without a name capture.`);
    }
    const ref = refs?.[name];
    if (!ref) {
      throw new Error(
        `Template placeholder {{${name}}} has no matching refs entry ` +
          `(synth-time validation should have caught this — please file a bug).`,
      );
    }
    const value = values[ref.namespace]?.[ref.key];
    if (value === undefined) {
      throw new Error(
        `Template placeholder {{${name}}} → ${ref.namespace}/${ref.key} not present in ` +
          `the decrypted envelope (synth-time validation should have caught this — please file a bug).`,
      );
    }
    return value;
  });
}

/**
 * Apply a whole shape against decrypted values. Returns either a scalar
 * string (when `shape` was a string template) or a mapped object (when
 * `shape` was a Record).
 */
export function applyShape(
  shape: ShapeTemplate,
  refs: RefsMap | undefined,
  values: Record<string, Record<string, string>>,
): string | Record<string, string> {
  if (typeof shape === "string") {
    return applyTemplate(shape, refs, values);
  }
  const out: Record<string, string> = {};
  for (const [field, template] of Object.entries(shape)) {
    out[field] = applyTemplate(template, refs, values);
  }
  return out;
}

// ── Error message builders ──────────────────────────────────────────────

function buildUnknownPlaceholderMessage(
  location: string,
  name: string,
  refsAliases: string[],
  args: ValidateShapeArgs,
): string {
  const suggestion = findClosest(name, refsAliases);
  const lines: string[] = [
    ``,
    `ClefSecret shape error:`,
    ``,
    `  ${location} references placeholder {{${name}}} which is not declared in 'refs'.`,
    `  identity:    ${args.identity}`,
    `  environment: ${args.environment}`,
    ``,
  ];
  if (suggestion) {
    lines.push(`  Did you mean {{${suggestion}}}?`);
    lines.push(``);
  }
  lines.push(`  Declared refs (${refsAliases.length}):`);
  if (refsAliases.length === 0) {
    lines.push(`    (none — add a 'refs' map to your construct props)`);
  } else {
    for (const alias of refsAliases) lines.push(`    - ${alias}`);
  }
  lines.push(``);
  lines.push(
    `  Fix: add '${name}: { namespace: ..., key: ... }' to refs, or ` +
      `correct the placeholder to match an existing alias.`,
  );
  lines.push(``);
  return lines.join("\n");
}

function buildUnknownNamespaceMessage(
  refName: string,
  ref: ClefRef,
  availableNamespaces: string[],
  args: ValidateShapeArgs,
): string {
  const suggestion = findClosest(ref.namespace, availableNamespaces);
  const lines: string[] = [
    ``,
    `ClefSecret refs error:`,
    ``,
    `  refs['${refName}'].namespace = '${ref.namespace}' is not a namespace in this envelope.`,
    `  identity:    ${args.identity}`,
    `  environment: ${args.environment}`,
    ``,
  ];
  if (suggestion) {
    lines.push(`  Did you mean '${suggestion}'?`);
    lines.push(``);
  }
  lines.push(`  Available namespaces (${availableNamespaces.length}):`);
  if (availableNamespaces.length === 0) {
    lines.push(`    (none — the identity has no values set yet)`);
  } else {
    for (const ns of availableNamespaces) lines.push(`    - ${ns}`);
  }
  lines.push(``);
  return lines.join("\n");
}

function buildUnknownKeyMessage(
  refName: string,
  ref: ClefRef,
  availableInNamespace: string[],
  args: ValidateShapeArgs,
): string {
  const sortedKeys = [...availableInNamespace].sort();
  const suggestion = findClosest(ref.key, sortedKeys);
  const lines: string[] = [
    ``,
    `ClefSecret refs error:`,
    ``,
    `  refs['${refName}'] = ${ref.namespace}/${ref.key} not found in the envelope.`,
    `  identity:    ${args.identity}`,
    `  environment: ${args.environment}`,
    ``,
  ];
  if (suggestion) {
    lines.push(`  Did you mean ${ref.namespace}/${suggestion}?`);
    lines.push(``);
  }
  lines.push(`  Keys available in '${ref.namespace}' (${sortedKeys.length}):`);
  if (sortedKeys.length === 0) {
    lines.push(`    (none — did you forget to set any values in this namespace?)`);
  } else {
    for (const key of sortedKeys) lines.push(`    - ${key}`);
  }
  lines.push(``);
  lines.push(`  Fix: correct the reference, or add the key to clef.yaml and run \`clef set\`.`);
  lines.push(``);
  return lines.join("\n");
}

/**
 * Simple edit-distance heuristic for "did you mean?" suggestions. Only
 * proposes a match when it's close enough that a typo is plausible.
 */
function findClosest(input: string, candidates: string[]): string | null {
  let best: { value: string; dist: number } | null = null;
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (best === null || dist < best.dist) {
      best = { value: candidate, dist };
    }
  }
  if (!best) return null;
  // Baseline of 2 covers a single-char transposition (which costs 2 under
  // plain Levenshtein), so short identifiers like `host` ↔ `hsot` still
  // surface a suggestion. For longer names the /3 ratio takes over.
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return best.dist <= threshold ? best.value : null;
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
