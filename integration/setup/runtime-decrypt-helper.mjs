/**
 * Standalone ESM helper that loads `@clef-sh/runtime` and decrypts a packed
 * artifact end-to-end. Spawned as a subprocess by runtime-roundtrip.test.ts
 * so the CJS Jest environment never has to load the ESM-only age-encryption
 * package directly (same pattern as age-keygen-helper.mjs).
 *
 * The helper exercises the same code path a Vercel/Lambda consumer would:
 * `import { init, InlineArtifactSource } from "@clef-sh/runtime"`.
 *
 * Stdin: JSON `{ mode, sourcePath?, sourceJson?, ageKey }`
 *   - mode: "file" | "inline-object" | "inline-string"
 *   - sourcePath: required for mode "file"
 *   - sourceJson: required for inline modes (raw artifact JSON string)
 *   - ageKey: AGE-SECRET-KEY-… private key string
 *
 * Stdout: JSON `{ ok: true, ready, revision, secrets }` or
 *         `{ ok: false, error }`
 */
import { init, InlineArtifactSource } from "@clef-sh/runtime";

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const input = JSON.parse(stdin);

try {
  let source;
  if (input.mode === "file") {
    source = input.sourcePath;
  } else if (input.mode === "inline-object") {
    source = JSON.parse(input.sourceJson);
  } else if (input.mode === "inline-string") {
    source = new InlineArtifactSource(input.sourceJson);
  } else {
    throw new Error(`unknown mode: ${input.mode}`);
  }

  const runtime = await init({ source, ageKey: input.ageKey });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      ready: runtime.ready,
      revision: runtime.revision,
      secrets: runtime.getAll(),
    }),
  );
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
