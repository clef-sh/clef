import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar, EmptyState } from "../primitives";
import type { ClefManifest, NamespaceSchema, SchemaKey } from "@clef-sh/core";

interface SchemaEditorProps {
  ns: string;
  manifest: ClefManifest | null;
}

interface KeyRow {
  /** Original name when the row came from disk; null for newly added rows. */
  originalName: string | null;
  /** Editable name field. */
  name: string;
  type: "string" | "integer" | "boolean";
  required: boolean;
  pattern: string;
  description: string;
}

interface SchemaResponse {
  namespace: string;
  attached: boolean;
  path: string | null;
  schema: NamespaceSchema;
}

const TYPES: KeyRow["type"][] = ["string", "integer", "boolean"];

const INPUT_BASE =
  "rounded border border-edge bg-ink-950 px-2 py-1 font-sans text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim disabled:text-ash";
const INPUT_MONO =
  "rounded border border-edge bg-ink-950 px-2 py-1 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim disabled:text-ash";

export function SchemaEditor({ ns, manifest }: SchemaEditorProps) {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [attached, setAttached] = useState(false);
  const [pathOnDisk, setPathOnDisk] = useState<string | null>(null);
  const [previewEnv, setPreviewEnv] = useState<string>("");
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const environments = manifest?.environments ?? [];

  useEffect(() => {
    if (!previewEnv && environments.length > 0) {
      const firstUnprotected = environments.find((e) => !e.protected) ?? environments[0];
      setPreviewEnv(firstUnprotected.name);
    }
  }, [environments, previewEnv]);

  const loadSchema = useCallback(async () => {
    if (!ns) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/namespaces/${ns}/schema`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to load schema");
        setRows([]);
        return;
      }
      const data = body as SchemaResponse;
      setAttached(data.attached);
      setPathOnDisk(data.path);
      setRows(schemaToRows(data.schema));
    } catch {
      setError("Failed to load schema");
    } finally {
      setLoading(false);
    }
  }, [ns]);

  const loadSampleValues = useCallback(async () => {
    if (!ns || !previewEnv) return;
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${previewEnv}`);
      if (!res.ok) {
        setSampleValues({});
        return;
      }
      const data = (await res.json()) as { values: Record<string, string> };
      setSampleValues(data.values ?? {});
    } catch {
      setSampleValues({});
    }
  }, [ns, previewEnv]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  useEffect(() => {
    loadSampleValues();
  }, [loadSampleValues]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const schema = rowsToSchema(rows);
      const res = await apiFetch(`/api/namespaces/${ns}/schema`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to save schema");
        return;
      }
      const data = body as SchemaResponse;
      setAttached(data.attached);
      setPathOnDisk(data.path);
      setSavedPath(data.path);
      setSavedAt(new Date().toLocaleTimeString());
      // Refresh from server so any normalisation (e.g. trimmed empty fields)
      // shows up in the editor and "edited" markers reset.
      setRows(schemaToRows(data.schema));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schema");
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        originalName: null,
        name: "",
        type: "string",
        required: true,
        pattern: "",
        description: "",
      },
    ]);
  };

  const handleRemoveRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<KeyRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const validation = useMemo(() => validateRows(rows), [rows]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <div>
          <Toolbar.Title>{`Schema · ${ns || "(no namespace selected)"}`}</Toolbar.Title>
          <Toolbar.Subtitle>
            {attached && pathOnDisk
              ? pathOnDisk
              : ns
                ? `no schema attached yet — saving will create one at schemas/${ns}.yaml`
                : ""}
          </Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <Button onClick={handleAddRow} disabled={!ns || loading}>
            + Add key
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!ns || saving || !validation.ok}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </Toolbar.Actions>
      </Toolbar>

      <div className="flex-1 overflow-auto px-6 py-4 font-sans text-bone">
        {error && (
          <div className="mb-3 rounded-md border border-stop-500/30 bg-stop-500/10 px-3 py-2 text-[12px] text-stop-500">
            {error}
          </div>
        )}

        {savedAt && savedPath && !error && (
          <div className="mb-3 rounded-md border border-edge bg-ink-850 px-3 py-2 text-[12px] text-ash">
            Saved at {savedAt} · {savedPath}
          </div>
        )}

        {loading && <div className="text-[12px] text-ash">Loading…</div>}

        {!loading && rows.length === 0 && (
          <EmptyState
            title="No keys declared yet"
            body="Click + Add key to start building the schema."
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="flex flex-col gap-2">
            <PreviewEnvPicker
              environments={environments.map((e) => e.name)}
              value={previewEnv}
              onChange={setPreviewEnv}
            />
            {rows.map((row, idx) => (
              <SchemaRow
                key={`${row.originalName ?? "new"}-${idx}`}
                row={row}
                error={validation.rowErrors[idx]}
                sampleValue={row.name ? sampleValues[row.name] : undefined}
                onChange={(patch) => updateRow(idx, patch)}
                onRemove={() => handleRemoveRow(idx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewEnvPicker(props: {
  environments: string[];
  value: string;
  onChange: (env: string) => void;
}) {
  if (props.environments.length === 0) return null;
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-ash">
      <span>Pattern preview against:</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded border border-edge bg-ink-850 px-1.5 py-0.5 font-mono text-[11px] text-bone"
      >
        {props.environments.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
    </div>
  );
}

function SchemaRow(props: {
  row: KeyRow;
  error?: string;
  sampleValue: string | undefined;
  onChange: (patch: Partial<KeyRow>) => void;
  onRemove: () => void;
}) {
  const { row, error, sampleValue, onChange, onRemove } = props;
  const patternMatchState = patternMatch(row.pattern, sampleValue);

  // Brief "checking" state on every pattern/sample change so the user sees
  // the test get re-run rather than the result just silently changing.
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!row.pattern || row.type !== "string") return;
    setChecking(true);
    const t = setTimeout(() => setChecking(false), 180);
    return () => clearTimeout(t);
  }, [row.pattern, sampleValue, row.type]);

  const previewToneClass = checking
    ? "text-ash"
    : patternMatchState === "match"
      ? "text-go-500"
      : patternMatchState === "miss"
        ? "text-stop-500"
        : "text-ash";

  return (
    <div
      className={`grid grid-cols-[minmax(140px,1fr)_110px_auto_1fr_auto] items-center gap-x-2 gap-y-2 rounded-md border bg-ink-850 p-3 ${
        error ? "border-stop-500" : "border-edge"
      }`}
    >
      <input
        placeholder="KEY_NAME"
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        className={INPUT_MONO}
      />
      <select
        value={row.type}
        onChange={(e) => onChange({ type: e.target.value as KeyRow["type"] })}
        className={INPUT_BASE}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-[11px] text-bone">
        <input
          type="checkbox"
          checked={row.required}
          onChange={(e) => onChange({ required: e.target.checked })}
          className="accent-gold-500"
        />
        required
      </label>
      <input
        placeholder={row.type === "string" ? "pattern: ^regex$ (optional)" : "— (strings only)"}
        value={row.pattern}
        disabled={row.type !== "string"}
        onChange={(e) => onChange({ pattern: e.target.value })}
        className={`${INPUT_MONO} ${row.type !== "string" ? "opacity-60" : ""}`}
      />
      <Button variant="danger" onClick={onRemove}>
        Remove
      </Button>

      <input
        placeholder="description (optional)"
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        className={`${INPUT_BASE} col-span-5`}
      />

      {error && <div className="col-span-5 text-[11px] text-stop-500">{error}</div>}

      {row.type === "string" && row.pattern && (
        <div
          className={`col-span-5 flex items-center gap-2 font-mono text-[11px] ${previewToneClass}`}
        >
          {checking ? (
            <>
              <Spinner />
              <span>testing…</span>
            </>
          ) : sampleValue === undefined ? (
            <span>No sample value in the selected env.</span>
          ) : patternMatchState === "invalid" ? (
            <span>Invalid regex.</span>
          ) : patternMatchState === "match" ? (
            <span data-testid="pattern-result">✔ matches sample value</span>
          ) : (
            <span data-testid="pattern-result">✖ did not match</span>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  // Keyframe `clef-schema-spin` is provided globally from styles.css so
  // we don't inject a <style> tag at module load anymore.
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-edge border-t-bone animate-[clef-schema-spin_0.6s_linear_infinite]"
    />
  );
}

function patternMatch(
  pattern: string,
  sample: string | undefined,
): "match" | "miss" | "invalid" | "no-sample" {
  if (!pattern) return "no-sample";
  if (sample === undefined) return "no-sample";
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return "invalid";
  }
  return re.test(sample) ? "match" : "miss";
}

function schemaToRows(schema: NamespaceSchema): KeyRow[] {
  return Object.entries(schema.keys).map(([name, def]) => ({
    originalName: name,
    name,
    type: def.type,
    required: def.required,
    pattern: def.pattern ?? "",
    description: def.description ?? "",
  }));
}

function rowsToSchema(rows: KeyRow[]): NamespaceSchema {
  const keys: Record<string, SchemaKey> = {};
  for (const row of rows) {
    if (!row.name) continue; // empty-name rows are filtered (validation flags them separately)
    keys[row.name] = {
      type: row.type,
      required: row.required,
      ...(row.pattern && row.type === "string" ? { pattern: row.pattern } : {}),
      ...(row.description ? { description: row.description } : {}),
    };
  }
  return { keys };
}

function validateRows(rows: KeyRow[]): { ok: boolean; rowErrors: Record<number, string> } {
  const rowErrors: Record<number, string> = {};
  const seenNames = new Map<string, number>();
  rows.forEach((row, idx) => {
    if (!row.name.trim()) {
      rowErrors[idx] = "Key name is required.";
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) {
      rowErrors[idx] =
        "Key name must start with a letter or underscore and contain only letters, digits, and underscores.";
      return;
    }
    const seen = seenNames.get(row.name);
    if (seen !== undefined) {
      rowErrors[idx] = `Duplicate key name (also row ${seen + 1}).`;
      return;
    }
    seenNames.set(row.name, idx);
    if (row.type === "string" && row.pattern) {
      try {
        new RegExp(row.pattern);
      } catch (err) {
        rowErrors[idx] = `Pattern is not a valid regex: ${(err as Error).message}.`;
      }
    }
  });
  return { ok: Object.keys(rowErrors).length === 0, rowErrors };
}
