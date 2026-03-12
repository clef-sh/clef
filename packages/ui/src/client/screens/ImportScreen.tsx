import React, { useState, useEffect } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import type { ClefManifest } from "@clef-sh/core";
import type { ViewName } from "../components/Sidebar";

interface ImportScreenProps {
  manifest: ClefManifest | null;
  setView: (view: ViewName) => void;
}

interface PreviewResult {
  wouldImport: string[];
  wouldSkip: Array<{ key: string; reason: string }>;
  wouldOverwrite: string[];
  warnings: string[];
  totalKeys: number;
}

interface ApplyResult {
  imported: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
}

type ImportFormatOption = "auto" | "dotenv" | "json" | "yaml";

export function ImportScreen({ manifest, setView }: ImportScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [namespace, setNamespace] = useState("");
  const [environment, setEnvironment] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<ImportFormatOption>("auto");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [overwriteKeys, setOverwriteKeys] = useState<string[]>([]);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set defaults from manifest
  useEffect(() => {
    if (manifest) {
      if (!namespace && manifest.namespaces.length > 0) {
        setNamespace(manifest.namespaces[0].name);
      }
      if (!environment && manifest.environments.length > 0) {
        setEnvironment(manifest.environments[0].name);
      }
    }
  }, [manifest, namespace, environment]);

  const namespaces = manifest?.namespaces ?? [];
  const environments = manifest?.environments ?? [];

  const handlePreview = async () => {
    if (!namespace || !environment || !content.trim()) {
      setError("Please select a namespace, environment, and paste content.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: `${namespace}/${environment}`,
          content,
          format: format === "auto" ? undefined : format,
          overwriteKeys,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Preview failed");
        return;
      }

      const data: PreviewResult = await res.json();
      setPreview(data);
      setOverwriteKeys([]);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);

    // Keys to import: wouldImport + any overwrite-toggled ones
    const keysToImport = [
      ...preview.wouldImport,
      ...preview.wouldSkip.filter((s) => overwriteKeys.includes(s.key)).map((s) => s.key),
    ];

    try {
      const res = await apiFetch("/api/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: `${namespace}/${environment}`,
          content,
          format: format === "auto" ? undefined : format,
          keys: keysToImport,
          overwriteKeys,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Import failed");
        return;
      }

      const data: ApplyResult = await res.json();
      setApplyResult(data);
      // Clear content after successful apply
      setContent("");
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const handleImportMore = () => {
    setStep(1);
    setContent("");
    setPreview(null);
    setApplyResult(null);
    setOverwriteKeys([]);
    setError(null);
  };

  const toggleOverwrite = (key: string) => {
    setOverwriteKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const importableCount =
    (preview?.wouldImport.length ?? 0) +
    overwriteKeys.filter((k) => preview?.wouldSkip.some((s) => s.key === k)).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Import" subtitle="clef import — bulk migrate secrets" />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          {/* Step indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              marginBottom: 32,
            }}
          >
            {([1, 2, 3] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: step >= s ? theme.accent : theme.surface,
                      border: `1px solid ${step >= s ? theme.accent : theme.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: theme.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      color: step >= s ? "#000" : theme.textDim,
                    }}
                  >
                    {s}
                  </div>
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 12,
                      color: step >= s ? theme.text : theme.textDim,
                      fontWeight: step === s ? 600 : 400,
                    }}
                  >
                    {s === 1 ? "Source" : s === 2 ? "Preview" : "Done"}
                  </span>
                </div>
                {i < 2 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: step > s ? theme.accent : theme.border,
                      margin: "0 12px",
                      minWidth: 40,
                    }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {error && (
            <div
              style={{
                background: theme.redDim,
                border: `1px solid ${theme.red}44`,
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.red,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Step 1: Source ─────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              {/* Target selectors */}
              <div style={{ marginBottom: 20 }}>
                <Label>Target</Label>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <SubLabel>Namespace</SubLabel>
                    <Select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                      {namespaces.map((ns) => (
                        <option key={ns.name} value={ns.name}>
                          {ns.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <SubLabel>Environment</SubLabel>
                    <Select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                      {environments.map((env) => (
                        <option key={env.name} value={env.name}>
                          {env.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              {/* Format selector */}
              <div style={{ marginBottom: 20 }}>
                <Label>Format</Label>
                <div style={{ display: "flex", gap: 16 }}>
                  {(["auto", "dotenv", "json", "yaml"] as const).map((f) => (
                    <label
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        fontFamily: theme.sans,
                        fontSize: 13,
                        color: format === f ? theme.text : theme.textMuted,
                      }}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={f}
                        checked={format === f}
                        onChange={() => setFormat(f)}
                        style={{ accentColor: theme.accent }}
                      />
                      {f === "auto" ? "Auto" : f}
                    </label>
                  ))}
                </div>
              </div>

              {/* Content textarea */}
              <div style={{ marginBottom: 8 }}>
                <Label>Paste secrets</Label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={
                    format === "json"
                      ? '{\n  "DB_HOST": "localhost",\n  "DB_PORT": "5432"\n}'
                      : format === "yaml"
                        ? "DB_HOST: localhost\nDB_PORT: '5432'"
                        : "DB_HOST=localhost\nDB_PORT=5432\n# Comments are ignored"
                  }
                  rows={12}
                  style={{
                    width: "100%",
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    padding: 14,
                    fontFamily: theme.mono,
                    fontSize: 12,
                    color: theme.text,
                    resize: "vertical",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Privacy notice */}
              <div
                style={{
                  marginBottom: 24,
                  padding: "10px 14px",
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 6,
                  fontFamily: theme.sans,
                  fontSize: 11,
                  color: theme.textMuted,
                  lineHeight: 1.5,
                }}
              >
                Values are sent directly to the local Clef server (127.0.0.1) and encrypted
                immediately. They are never stored in browser memory beyond this session.
              </div>

              <Button
                variant="primary"
                onClick={handlePreview}
                disabled={loading || !content.trim()}
              >
                {loading ? "Previewing..." : "Next: Preview"}
              </Button>
            </div>
          )}

          {/* ── Step 2: Preview ────────────────────────────────────────── */}
          {step === 2 && preview && (
            <div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.textMuted,
                  marginBottom: 20,
                }}
              >
                Importing to{" "}
                <span style={{ color: theme.accent, fontWeight: 600 }}>
                  {namespace}/{environment}
                </span>
                . {preview.totalKeys} key{preview.totalKeys !== 1 ? "s" : ""} parsed.
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {preview.warnings.map((w, i) => (
                    <div
                      key={i}
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 11,
                        color: theme.yellow,
                        marginBottom: 4,
                      }}
                    >
                      &#9888; {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Would import */}
              {preview.wouldImport.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.green}>
                    New keys ({preview.wouldImport.length})
                  </SectionLabel>
                  {preview.wouldImport.map((key) => (
                    <KeyRow key={key} icon="\u2192" iconColor={theme.green} label={key} />
                  ))}
                </div>
              )}

              {/* Would skip / overwrite toggles */}
              {preview.wouldSkip.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.yellow}>
                    Already exists ({preview.wouldSkip.length}) — toggle to overwrite
                  </SectionLabel>
                  {preview.wouldSkip.map(({ key, reason }) => {
                    const willOverwrite = overwriteKeys.includes(key);
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "6px 10px",
                          borderRadius: 6,
                          marginBottom: 4,
                          background: willOverwrite ? theme.yellowDim : "transparent",
                          border: `1px solid ${willOverwrite ? theme.yellow + "44" : theme.border}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={willOverwrite}
                          onChange={() => toggleOverwrite(key)}
                          style={{ accentColor: theme.yellow }}
                          id={`overwrite-${key}`}
                        />
                        <label
                          htmlFor={`overwrite-${key}`}
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 12,
                            color: willOverwrite ? theme.yellow : theme.textMuted,
                            flex: 1,
                            cursor: "pointer",
                          }}
                        >
                          {key}
                        </label>
                        <span
                          style={{
                            fontFamily: theme.sans,
                            fontSize: 11,
                            color: theme.textDim,
                          }}
                        >
                          {reason}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {preview.wouldImport.length === 0 && preview.wouldSkip.length === 0 && (
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 13,
                    color: theme.textMuted,
                    padding: "24px 0",
                    textAlign: "center",
                  }}
                >
                  No importable keys found.
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={handleApply}
                  disabled={loading || importableCount === 0}
                >
                  {loading
                    ? "Importing..."
                    : `Import ${importableCount} key${importableCount !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ───────────────────────────────────────────── */}
          {step === 3 && applyResult && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 20,
                  paddingBottom: 32,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: applyResult.failed.length > 0 ? theme.redDim : theme.greenDim,
                    border: `1px solid ${applyResult.failed.length > 0 ? theme.red + "44" : theme.green + "44"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: applyResult.failed.length > 0 ? theme.red : theme.green,
                    marginBottom: 16,
                  }}
                >
                  {applyResult.failed.length > 0 ? "\u26a0" : "\u2713"}
                </div>

                <div
                  style={{
                    fontFamily: theme.sans,
                    fontWeight: 600,
                    fontSize: 16,
                    color: applyResult.failed.length > 0 ? theme.yellow : theme.green,
                    marginBottom: 8,
                  }}
                >
                  {applyResult.failed.length > 0
                    ? "Import completed with errors"
                    : "Import complete"}
                </div>

                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 12,
                    color: theme.textMuted,
                  }}
                >
                  {applyResult.imported.length} imported, {applyResult.skipped.length} skipped,{" "}
                  {applyResult.failed.length} failed
                </div>
              </div>

              {applyResult.imported.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.green}>
                    Imported ({applyResult.imported.length})
                  </SectionLabel>
                  {applyResult.imported.map((key) => (
                    <KeyRow key={key} icon="\u2713" iconColor={theme.green} label={key} />
                  ))}
                </div>
              )}

              {applyResult.failed.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.red}>
                    Failed ({applyResult.failed.length})
                  </SectionLabel>
                  {applyResult.failed.map(({ key, error: keyError }) => (
                    <KeyRow
                      key={key}
                      icon="\u2717"
                      iconColor={theme.red}
                      label={key}
                      note={keyError}
                    />
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <Button variant="primary" onClick={() => setView("matrix")}>
                  View in Matrix
                </Button>
                <Button variant="ghost" onClick={handleImportMore}>
                  Import more
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: 8,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 11,
        color: theme.textDim,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        width: "100%",
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: "7px 10px",
        fontFamily: theme.sans,
        fontSize: 13,
        color: theme.text,
        outline: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </select>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 11,
        fontWeight: 600,
        color,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function KeyRow({
  icon,
  iconColor,
  label,
  note,
}: {
  icon: string;
  iconColor: string;
  label: string;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 10px",
        borderRadius: 6,
        marginBottom: 3,
      }}
    >
      <span style={{ color: iconColor, fontFamily: theme.mono, fontSize: 13 }}>{icon}</span>
      <span style={{ fontFamily: theme.mono, fontSize: 12, color: theme.text, flex: 1 }}>
        {label}
      </span>
      {note && (
        <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.textDim }}>{note}</span>
      )}
    </div>
  );
}
