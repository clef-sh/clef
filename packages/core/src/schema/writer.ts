import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { NamespaceSchema, SchemaKey } from "../types";

/**
 * Options for {@link serializeSchema}.
 */
export interface SerializeSchemaOptions {
  /**
   * Leading comment block emitted above the `keys:` map. Each line is prefixed
   * with `# `. Blank lines in the header are preserved.
   */
  header?: string;
}

/**
 * Emit a stable, comment-prefixed YAML representation of a namespace schema.
 *
 * The field order per key is fixed (`type`, `required`, `pattern`, `description`)
 * so that `writeSchema` → git → `loadSchema` produces predictable diffs.
 * Fields not present on the key are omitted.
 *
 * `SchemaValidator.loadSchema` is the inverse: loading the output of this
 * function yields a structurally equivalent `NamespaceSchema`.
 */
export function serializeSchema(
  schema: NamespaceSchema,
  opts: SerializeSchemaOptions = {},
): string {
  const doc = new YAML.Document();
  doc.contents = doc.createNode({ keys: orderedKeys(schema.keys) }) as YAML.ParsedNode;
  const body = String(doc);

  if (!opts.header) return body;
  const commented = opts.header
    .split("\n")
    .map((line) => (line.length === 0 ? "#" : `# ${line}`))
    .join("\n");
  return `${commented}\n\n${body}`;
}

/**
 * Atomically write a schema YAML file to disk, creating parent directories as
 * needed. `relPath` is interpreted relative to `rootDir`; absolute paths and
 * `..` traversal that escapes the root are refused. The repo root is the
 * natural boundary for every clef caller, so making it required keeps the
 * file-write sink sanitized at its only entry point.
 */
export function writeSchema(
  rootDir: string,
  relPath: string,
  schema: NamespaceSchema,
  opts: SerializeSchemaOptions = {},
): void {
  writeSchemaRaw(rootDir, relPath, serializeSchema(schema, opts));
}

/**
 * Atomically write pre-serialized schema content (e.g. a scaffolding template
 * with commented-out example keys) to disk, creating parent directories as
 * needed. Callers using a structured {@link NamespaceSchema} should prefer
 * {@link writeSchema}. Same `rootDir` containment rule as {@link writeSchema}.
 *
 * The sanitizer is inlined at the sink rather than extracted into a helper so
 * that CodeQL's `js/path-injection` data flow analysis can see the barrier
 * adjacent to the `fs.mkdirSync` / `writeFileAtomic.sync` calls. Pattern
 * follows CodeQL's documented recommendation: reject absolute input,
 * `fs.realpathSync` the trusted root to canonicalize past symlinks, then
 * `startsWith` containment.
 */
export function writeSchemaRaw(rootDir: string, relPath: string, contents: string): void {
  // 1. Normalize user-controlled relative input, then reject absolute/empty.
  const normalizedRelPath = path.normalize(relPath);
  if (!normalizedRelPath || normalizedRelPath === "." || path.isAbsolute(normalizedRelPath)) {
    throw new Error(`Refusing to write schema using an absolute path: ${relPath}`);
  }
  // 2. Canonicalize the root (resolves symlinks). The root is always under
  //    the operator's own filesystem and exists when this is called.
  const realRoot = fs.realpathSync(path.resolve(rootDir));
  // 3. Resolve normalized relative candidate against canonical root and ensure
  //    containment via relative-path semantics.
  const safePath = path.resolve(realRoot, normalizedRelPath);
  const relCandidate = path.relative(realRoot, safePath);
  if (
    relCandidate === ".." ||
    relCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relCandidate)
  ) {
    throw new Error(`Refusing to write schema outside the repository root: ${relPath}`);
  }
  // 4. Create parent directory, then canonicalize the parent and re-check
  //    containment using path.relative. This catches a symlink planted
  //    between the initial canonicalization and the actual write — the
  //    TOCTOU defense CodeQL's `js/path-injection` query expects.
  const safeParent = path.dirname(safePath);
  fs.mkdirSync(safeParent, { recursive: true });
  const canonicalParent = fs.realpathSync(safeParent);
  const canonicalTarget = path.join(canonicalParent, path.basename(safePath));
  const relToRoot = path.relative(realRoot, canonicalTarget);
  if (relToRoot === ".." || relToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relToRoot)) {
    throw new Error(`Refusing to write schema outside the repository root: ${relPath}`);
  }
  writeFileAtomic.sync(canonicalTarget, contents);
}

/**
 * Starter content for `clef schema new <ns>` with no `--template` specified.
 *
 * Produces a valid, empty schema (`keys: {}`) with a header explaining how to
 * add keys. The result parses cleanly via `SchemaValidator.loadSchema` and
 * `clef lint` passes against it (zero required keys).
 */
export function emptyTemplate(namespace: string): string {
  const header = [
    `Schema for namespace '${namespace}'.`,
    "",
    "Declare keys your encrypted files must contain. Each key accepts:",
    "  type:        string | integer | boolean",
    "  required:    true | false",
    "  pattern:     (strings only) regex the value must match",
    "  description: human-readable description",
    "",
    "Add keys below, then run `clef lint` to validate.",
  ].join("\n");
  return serializeSchema({ keys: {} }, { header });
}

/**
 * Starter content for `clef schema new <ns> --template example`.
 *
 * Shows one fully-documented example key using every supported field, emitted
 * under `# keys:` (entirely commented out) so that `clef lint` passes
 * immediately. The user uncomments and edits in place.
 */
export function exampleTemplate(namespace: string): string {
  const header = [
    `Schema for namespace '${namespace}'.`,
    "",
    "The example below is commented out so `clef lint` passes as-is.",
    "Uncomment and edit to add your first key, or replace wholesale.",
  ].join("\n");
  const body = [
    "keys: {}",
    "",
    "# keys:",
    "#   API_KEY:",
    "#     type: string",
    "#     required: true",
    "#     pattern: ^sk_(test|live)_[A-Za-z0-9]+$",
    "#     description: Stripe secret key for server-side calls.",
  ].join("\n");
  const commentedHeader = header
    .split("\n")
    .map((line) => (line.length === 0 ? "#" : `# ${line}`))
    .join("\n");
  return `${commentedHeader}\n\n${body}\n`;
}

function orderedKeys(keys: Record<string, SchemaKey>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(keys)) {
    const ordered: Record<string, unknown> = {
      type: def.type,
      required: def.required,
    };
    if (def.pattern !== undefined) ordered.pattern = def.pattern;
    if (def.description !== undefined) ordered.description = def.description;
    out[name] = ordered;
  }
  return out;
}
