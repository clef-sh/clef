import React, { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar } from "../primitives";
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

const SELECT_CLASSES =
  "w-full rounded-md border border-edge bg-ink-850 px-2.5 py-1.5 font-sans text-[13px] text-bone outline-none cursor-pointer focus-visible:border-gold-500";

const TEXTAREA_CLASSES =
  "w-full box-border rounded-lg border border-edge bg-ink-850 p-3.5 font-mono text-[12px] text-bone outline-none resize-y focus-visible:border-gold-500";

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
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Import</Toolbar.Title>
          <Toolbar.Subtitle>clef import — bulk migrate secrets</Toolbar.Subtitle>
        </div>
      </Toolbar>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[620px]">
          {/* Step indicator */}
          <div className="mb-8 flex items-center">
            {([1, 2, 3] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                      step >= s
                        ? "bg-gold-500 border border-gold-500 text-ink-950"
                        : "bg-ink-850 border border-edge text-ash-dim"
                    }`}
                  >
                    {s}
                  </div>
                  <span
                    className={`font-sans text-[12px] ${
                      step >= s ? "text-bone" : "text-ash-dim"
                    } ${step === s ? "font-semibold" : "font-normal"}`}
                  >
                    {s === 1 ? "Source" : s === 2 ? "Preview" : "Done"}
                  </span>
                </div>
                {i < 2 && (
                  <div
                    className={`mx-3 h-px min-w-[40px] flex-1 ${
                      step > s ? "bg-gold-500" : "bg-edge"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3 font-sans text-[13px] text-stop-500">
              {error}
            </div>
          )}

          {/* ── Step 1: Source ─────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <div className="mb-5">
                <Label>Target</Label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <SubLabel>Namespace</SubLabel>
                    <select
                      value={namespace}
                      onChange={(e) => setNamespace(e.target.value)}
                      className={SELECT_CLASSES}
                    >
                      {namespaces.map((ns) => (
                        <option key={ns.name} value={ns.name}>
                          {ns.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <SubLabel>Environment</SubLabel>
                    <select
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      className={SELECT_CLASSES}
                    >
                      {environments.map((env) => (
                        <option key={env.name} value={env.name}>
                          {env.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mb-5">
                <Label>Format</Label>
                <div className="flex gap-4">
                  {(["auto", "dotenv", "json", "yaml"] as const).map((f) => (
                    <label
                      key={f}
                      className={`flex cursor-pointer items-center gap-1.5 font-sans text-[13px] ${
                        format === f ? "text-bone" : "text-ash"
                      }`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={f}
                        checked={format === f}
                        onChange={() => setFormat(f)}
                        className="accent-gold-500"
                      />
                      {f === "auto" ? "Auto" : f}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-2">
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
                  className={TEXTAREA_CLASSES}
                />
              </div>

              <div className="mb-6 rounded-md border border-edge bg-ink-850 px-3.5 py-2.5 font-sans text-[11px] leading-relaxed text-ash">
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
              <div className="mb-5 font-sans text-[13px] text-ash">
                Importing to{" "}
                <span className="font-semibold text-gold-500">
                  {namespace}/{environment}
                </span>
                . {preview.totalKeys} key{preview.totalKeys !== 1 ? "s" : ""} parsed.
              </div>

              {preview.warnings.length > 0 && (
                <div className="mb-4">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="mb-1 font-mono text-[11px] text-warn-500">
                      &#9888; {w}
                    </div>
                  ))}
                </div>
              )}

              {preview.wouldImport.length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-go-500">
                    New keys ({preview.wouldImport.length})
                  </SectionLabel>
                  {preview.wouldImport.map((key) => (
                    <KeyRow key={key} icon="→" iconClass="text-go-500" label={key} />
                  ))}
                </div>
              )}

              {preview.wouldSkip.length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-warn-500">
                    Already exists ({preview.wouldSkip.length}) — toggle to overwrite
                  </SectionLabel>
                  {preview.wouldSkip.map(({ key, reason }) => {
                    const willOverwrite = overwriteKeys.includes(key);
                    return (
                      <div
                        key={key}
                        className={`mb-1 flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${
                          willOverwrite
                            ? "border-warn-500/30 bg-warn-500/10"
                            : "border-edge bg-transparent"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={willOverwrite}
                          onChange={() => toggleOverwrite(key)}
                          className="accent-warn-500"
                          id={`overwrite-${key}`}
                        />
                        <label
                          htmlFor={`overwrite-${key}`}
                          className={`flex-1 cursor-pointer font-mono text-[12px] ${
                            willOverwrite ? "text-warn-500" : "text-ash"
                          }`}
                        >
                          {key}
                        </label>
                        <span className="font-sans text-[11px] text-ash-dim">{reason}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {preview.wouldImport.length === 0 && preview.wouldSkip.length === 0 && (
                <div className="py-6 text-center font-sans text-[13px] text-ash">
                  No importable keys found.
                </div>
              )}

              <div className="mt-6 flex gap-2.5">
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
              <div className="flex flex-col items-center pt-5 pb-8">
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full text-[24px] ${
                    applyResult.failed.length > 0
                      ? "border border-stop-500/30 bg-stop-500/10 text-stop-500"
                      : "border border-go-500/30 bg-go-500/10 text-go-500"
                  }`}
                >
                  {applyResult.failed.length > 0 ? "⚠" : "✓"}
                </div>
                <div
                  className={`mb-2 font-sans text-[16px] font-semibold ${
                    applyResult.failed.length > 0 ? "text-warn-500" : "text-go-500"
                  }`}
                >
                  {applyResult.failed.length > 0
                    ? "Import completed with errors"
                    : "Import complete"}
                </div>
                <div className="font-mono text-[12px] text-ash">
                  {applyResult.imported.length} imported, {applyResult.skipped.length} skipped,{" "}
                  {applyResult.failed.length} failed
                </div>
              </div>

              {applyResult.imported.length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-go-500">
                    Imported ({applyResult.imported.length})
                  </SectionLabel>
                  {applyResult.imported.map((key) => (
                    <KeyRow key={key} icon="✓" iconClass="text-go-500" label={key} />
                  ))}
                </div>
              )}

              {applyResult.failed.length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-stop-500">
                    Failed ({applyResult.failed.length})
                  </SectionLabel>
                  {applyResult.failed.map(({ key, error: keyError }) => (
                    <KeyRow
                      key={key}
                      icon="✗"
                      iconClass="text-stop-500"
                      label={key}
                      note={keyError}
                    />
                  ))}
                </div>
              )}

              <div className="mt-6 flex gap-2.5">
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
    <div className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 font-sans text-[11px] text-ash-dim">{children}</div>;
}

function SectionLabel({ children, toneClass }: { children: React.ReactNode; toneClass: string }) {
  return (
    <div
      className={`mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] ${toneClass}`}
    >
      {children}
    </div>
  );
}

function KeyRow({
  icon,
  iconClass,
  label,
  note,
}: {
  icon: string;
  iconClass: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1">
      <span className={`font-mono text-[13px] ${iconClass}`}>{icon}</span>
      <span className="flex-1 font-mono text-[12px] text-bone">{label}</span>
      {note && <span className="font-sans text-[11px] text-ash-dim">{note}</span>}
    </div>
  );
}
