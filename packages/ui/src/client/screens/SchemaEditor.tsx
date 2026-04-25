import React, { useCallback, useEffect, useMemo, useState } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar
        title={`Schema · ${ns || "(no namespace selected)"}`}
        subtitle={
          attached && pathOnDisk
            ? pathOnDisk
            : ns
              ? "no schema attached yet — saving will create one at schemas/" + ns + ".yaml"
              : ""
        }
        actions={
          <>
            <Button onClick={handleAddRow} disabled={!ns}>
              + Add key
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!ns || saving || !validation.ok}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "16px 24px",
          fontFamily: theme.sans,
          color: theme.text,
        }}
      >
        {error && (
          <div
            style={{
              background: theme.redDim,
              color: theme.red,
              border: `1px solid ${theme.red}44`,
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {savedAt && savedPath && !error && (
          <div
            style={{
              background: theme.surface,
              color: theme.textMuted,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 12,
            }}
          >
            Saved at {savedAt} · {savedPath}
          </div>
        )}

        {loading && <div style={{ color: theme.textMuted, fontSize: 12 }}>Loading…</div>}

        {!loading && rows.length === 0 && (
          <div
            style={{
              border: `1px dashed ${theme.border}`,
              borderRadius: 6,
              padding: 24,
              textAlign: "center",
              color: theme.textMuted,
              fontSize: 12,
            }}
          >
            No keys declared yet. Click <strong>+ Add key</strong> to start building the schema.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4,
        fontSize: 11,
        color: theme.textMuted,
      }}
    >
      <span>Pattern preview against:</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          background: theme.surface,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          borderRadius: 4,
          padding: "2px 6px",
          fontFamily: theme.mono,
          fontSize: 11,
        }}
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

  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${error ? theme.red : theme.border}`,
        borderRadius: 6,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "minmax(140px, 1fr) 110px auto 1fr auto",
        columnGap: 8,
        rowGap: 8,
        alignItems: "center",
      }}
    >
      <input
        placeholder="KEY_NAME"
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        style={inputStyle({ mono: true })}
      />
      <select
        value={row.type}
        onChange={(e) => onChange({ type: e.target.value as KeyRow["type"] })}
        style={inputStyle()}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <input
          type="checkbox"
          checked={row.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        required
      </label>
      <input
        placeholder={row.type === "string" ? "pattern: ^regex$ (optional)" : "— (strings only)"}
        value={row.pattern}
        disabled={row.type !== "string"}
        onChange={(e) => onChange({ pattern: e.target.value })}
        style={inputStyle({ mono: true, disabled: row.type !== "string" })}
      />
      <Button variant="danger" onClick={onRemove}>
        Remove
      </Button>

      <input
        placeholder="description (optional)"
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        style={{ ...inputStyle(), gridColumn: "1 / span 5" }}
      />

      {error && (
        <div style={{ gridColumn: "1 / span 5", color: theme.red, fontSize: 11 }}>{error}</div>
      )}

      {row.type === "string" && row.pattern && (
        <div
          style={{
            gridColumn: "1 / span 5",
            fontFamily: theme.mono,
            fontSize: 11,
            color:
              patternMatchState === "match"
                ? theme.greenDim
                : patternMatchState === "miss"
                  ? theme.red
                  : theme.textMuted,
          }}
        >
          {sampleValue === undefined
            ? "No sample value in the selected env."
            : patternMatchState === "invalid"
              ? "Invalid regex."
              : patternMatchState === "match"
                ? `✔  matches sample value`
                : `✖  does not match sample: ${truncate(sampleValue, 60)}`}
        </div>
      )}
    </div>
  );
}

function inputStyle(opts?: { mono?: boolean; disabled?: boolean }): React.CSSProperties {
  return {
    background: opts?.disabled ? theme.bg : theme.bg,
    color: opts?.disabled ? theme.textMuted : theme.text,
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    padding: "5px 8px",
    fontFamily: opts?.mono ? theme.mono : theme.sans,
    fontSize: 12,
    outline: "none",
    minWidth: 0,
  };
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
