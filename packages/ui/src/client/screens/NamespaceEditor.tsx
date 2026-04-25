import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { Toolbar } from "../primitives";
import type { ClefManifest, DecryptedFile, LintIssue } from "@clef-sh/core";

interface EditorRow {
  key: string;
  value: string;
  type: string;
  required: boolean;
  visible: boolean;
  edited: boolean;
  isNew: boolean;
  pending: boolean;
}

interface NamespaceEditorProps {
  ns: string;
  initialEnv?: string;
  manifest: ClefManifest | null;
}

// Per-env underline colors for the tab bar. Mirrors ENV_COLORS but as Tailwind classes.
const ENV_TAB_BORDER: Record<string, string> = {
  dev: "border-go-500",
  staging: "border-warn-500",
  production: "border-stop-500",
};

const VALUE_INPUT =
  "flex-1 rounded border border-edge-strong bg-ink-800 px-2.5 py-1 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500";

const NEW_KEY_INPUT =
  "shrink-0 basis-[240px] rounded border border-gold-500/40 bg-ink-800 px-2.5 py-1.5 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500";

const NEW_VALUE_INPUT =
  "flex-1 rounded border border-edge bg-ink-800 px-2.5 py-1.5 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500";

export function NamespaceEditor({ ns, initialEnv, manifest }: NamespaceEditorProps) {
  const [env, setEnv] = useState(initialEnv ?? "");
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"value" | "random">("value");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [overflowKey, setOverflowKey] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sopsInfo, setSopsInfo] = useState("");
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [protectedConfirm, setProtectedConfirm] = useState<"save" | "add" | null>(null);

  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const REVEAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  useEffect(() => () => clearTimeout(revealTimeoutRef.current), []);

  const environments = manifest?.environments ?? [];
  const isProduction = environments.find((e) => e.name === env)?.protected === true;

  useEffect(() => {
    if (environments.length > 0 && !env) {
      setEnv(environments[0].name);
    }
  }, [environments, env]);

  const loadData = useCallback(async () => {
    if (!env || !ns) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${env}`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || "Failed to load");
        setRows([]);
        return;
      }
      const data = (await res.json()) as DecryptedFile & { pending?: string[] };
      const pendingKeys = new Set(data.pending ?? []);
      const newRows: EditorRow[] = Object.entries(data.values).map(([key, value]) => ({
        key,
        value: String(value),
        type: "string",
        required: false,
        visible: false,
        edited: false,
        isNew: false,
        pending: pendingKeys.has(key),
      }));
      setRows(newRows);
      const backend = data.metadata?.backend ?? "age";
      const recipientCount = data.metadata?.recipients?.length ?? 0;
      setSopsInfo(
        `encrypted with ${backend} · ${recipientCount} recipient${recipientCount !== 1 ? "s" : ""}`,
      );
    } catch {
      setError("Failed to load namespace data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [ns, env]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!ns) return;
    apiFetch(`/api/lint/${ns}`)
      .then((res) => (res.ok ? res.json() : { issues: [] }))
      .then((data) => setLintIssues(data.issues ?? []))
      .catch(() => setLintIssues([]));
  }, [ns]);

  const toggleVisible = (key: string) => {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, visible: !row.visible } : row)));

    clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = setTimeout(() => {
      setRows((r) =>
        r.map((row) => ({
          ...row,
          value: "",
          visible: false,
        })),
      );
    }, REVEAL_TIMEOUT_MS);
  };

  const handleEdit = (key: string, val: string) => {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, value: val, edited: true } : row)));
  };

  const handleSave = async (confirmed?: boolean) => {
    const dirtyRows = rows.filter((r) => r.edited);
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      let failure: string | null = null;
      for (const row of dirtyRows) {
        const payload: Record<string, unknown> = { value: row.value };
        if (confirmed) payload.confirmed = true;
        const res = await apiFetch(`/api/namespace/${ns}/${env}/${row.key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failure = data.error || `Failed to save ${row.key}`;
          break;
        }
      }
      await loadData();
      if (failure) setError(failure);
    } catch {
      await loadData();
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (confirmed?: boolean) => {
    if (!newKey.trim()) return;
    const trimmedKey = newKey.trim();
    const body: Record<string, unknown> =
      addMode === "random" ? { random: true } : { value: newValue };
    if (confirmed) body.confirmed = true;
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${env}/${trimmedKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to add key");
        return;
      }
      const data = await res.json();
      if (data.warning) setError(data.warning);
      setRows((prev) => [
        ...prev,
        {
          key: trimmedKey,
          value: addMode === "random" ? "" : newValue,
          type: "string",
          required: false,
          visible: false,
          edited: false,
          isNew: true,
          pending: addMode === "random",
        },
      ]);
    } catch {
      setError("Failed to add key");
    } finally {
      setAdding(false);
      setAddMode("value");
      setNewKey("");
      setNewValue("");
    }
  };

  const handleResetToRandom = async (key: string) => {
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${env}/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ random: true, ...(isProduction && { confirmed: true }) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to reset key");
        return;
      }
      setRows((prev) =>
        prev.map((row) =>
          row.key === key ? { ...row, pending: true, value: "", edited: false } : row,
        ),
      );
    } catch {
      setError("Failed to reset key");
    } finally {
      setConfirmReset(null);
      setOverflowKey(null);
    }
  };

  const handleAccept = async (key: string) => {
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${env}/${key}/accept`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to accept value");
        return;
      }
      const data = await res.json();
      setRows((prev) =>
        prev.map((row) =>
          row.key === key ? { ...row, pending: false, value: data.value ?? row.value } : row,
        ),
      );
    } catch {
      setError("Failed to accept value");
    }
  };

  const handleDelete = async (key: string) => {
    try {
      const res = await apiFetch(`/api/namespace/${ns}/${env}/${key}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isProduction ? { confirmed: true } : {}),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete key");
        return;
      }
      setRows((prev) => prev.filter((row) => row.key !== key));
    } catch {
      setError("Failed to delete key");
    } finally {
      setConfirmDelete(null);
    }
  };

  const hasChanges = rows.some((r) => r.edited);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>{`/${ns}`}</Toolbar.Title>
          <Toolbar.Subtitle>Namespace · {rows.length} keys</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          {hasChanges && (
            <Button
              variant="primary"
              disabled={saving}
              onClick={() => {
                if (isProduction) setProtectedConfirm("save");
                else handleSave();
              }}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
          <Button variant="primary" data-testid="add-key-btn" onClick={() => setAdding(true)}>
            + Add key
          </Button>
        </Toolbar.Actions>
      </Toolbar>

      {/* Env tabs */}
      <div className="flex border-b border-edge bg-ink-800 px-6">
        {environments.map((e) => {
          const isActive = env === e.name;
          const activeBorder = ENV_TAB_BORDER[e.name] ?? "border-ash";
          const borderClass = isActive ? activeBorder : "border-transparent";
          return (
            <div
              key={e.name}
              role="tab"
              tabIndex={0}
              onClick={() => setEnv(e.name)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") setEnv(e.name);
              }}
              className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-4 py-2.5 ${borderClass}`}
            >
              <EnvBadge env={e.name} small />
              <span
                className={`font-sans text-[13px] ${isActive ? "font-semibold text-bone" : "font-normal text-ash"}`}
              >
                {e.name}
              </span>
            </div>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center py-2.5">
          <span className="font-mono text-[10px] text-ash">{sopsInfo}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Production warning */}
        {isProduction && (
          <div
            data-testid="production-warning"
            className="mb-5 flex items-center gap-2.5 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-2.5"
          >
            <span className="text-[14px]">{"🔒"}</span>
            <span className="font-sans text-[12px] text-stop-500">
              <strong>Production environment.</strong> Changes will require confirmation before
              committing.
            </span>
          </div>
        )}

        {loading && <p className="font-sans text-ash">Loading...</p>}

        {error && (
          <div className="mb-5 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3 font-sans text-[12px] text-stop-500">
            {error}
          </div>
        )}

        {!loading && (
          <>
            {/* Keys table */}
            <div className="rounded-card border border-edge bg-ink-850">
              {/* Header */}
              <div className="grid grid-cols-[260px_1fr_90px_36px] items-center rounded-t-card border-b border-edge bg-ink-800 px-5 py-2.5">
                {["Key", "Value", "Type", ""].map((h) => (
                  <span
                    key={h || "actions"}
                    className="font-sans text-[11px] font-semibold uppercase tracking-[0.07em] text-ash"
                  >
                    {h}
                  </span>
                ))}
              </div>

              {rows.map((row, i) => {
                const rowBg = row.pending
                  ? "bg-gold-500/[0.07]"
                  : row.edited
                    ? "bg-gold-500/[0.03]"
                    : "bg-transparent";
                const rowBorderLeft = row.pending
                  ? "border-l-[3px] border-gold-500/55"
                  : row.edited
                    ? "border-l-2 border-gold-500"
                    : "border-l-2 border-transparent";
                const rowBorderBottom = i < rows.length - 1 ? "border-b border-edge" : "border-b-0";
                return (
                  <div
                    key={row.key}
                    className={`grid min-h-[48px] grid-cols-[260px_1fr_90px_36px] items-center px-5 ${rowBg} ${rowBorderLeft} ${rowBorderBottom}`}
                  >
                    {/* Key */}
                    <div className="flex items-center gap-2 pr-4">
                      {row.required && (
                        <span className="text-[14px] leading-none text-gold-500">*</span>
                      )}
                      <span className="font-mono text-[12px] text-bone">{row.key}</span>
                      {row.edited && (
                        <span
                          data-testid="dirty-dot"
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500"
                        />
                      )}
                    </div>

                    {/* Value */}
                    <div className="flex items-center gap-2 pr-4">
                      {row.pending && !row.visible ? (
                        <span className="font-mono text-[11px] italic text-gold-500">
                          PENDING {"—"} not yet set
                        </span>
                      ) : row.visible ? (
                        <input
                          type="text"
                          data-testid={`value-input-${row.key}`}
                          value={row.value}
                          onChange={(e) => handleEdit(row.key, e.target.value)}
                          autoComplete="off"
                          placeholder={row.pending ? "Enter real value..." : undefined}
                          className={VALUE_INPUT}
                        />
                      ) : (
                        <span className="font-mono text-[13px] tracking-[0.15em] text-ash">
                          {"••••••••••••••••••••••••"}
                        </span>
                      )}
                      {row.pending && !row.visible ? (
                        <div className="flex gap-1.5">
                          <button
                            data-testid={`set-value-${row.key}`}
                            onClick={() => toggleVisible(row.key)}
                            className="cursor-pointer rounded border border-gold-500/40 bg-gold-500/10 px-2.5 py-0.5 font-sans text-[11px] font-semibold text-gold-500 hover:bg-gold-500/20"
                          >
                            Set value
                          </button>
                          <button
                            data-testid={`accept-value-${row.key}`}
                            onClick={() => handleAccept(row.key)}
                            title="Accept the random value as the final secret"
                            className="cursor-pointer rounded border border-go-500/40 bg-go-500/10 px-2.5 py-0.5 font-sans text-[11px] font-semibold text-go-500 hover:bg-go-500/20"
                          >
                            Accept random
                          </button>
                        </div>
                      ) : (
                        <button
                          data-testid={`eye-${row.key}`}
                          onClick={() => toggleVisible(row.key)}
                          aria-label={row.visible ? "Hide value" : "Reveal value"}
                          className={`flex cursor-pointer items-center bg-transparent p-1 text-[13px] ${row.visible ? "text-gold-500" : "text-ash-dim"}`}
                        >
                          {"👁"}
                        </button>
                      )}
                    </div>

                    {/* Type */}
                    <div>
                      {row.pending ? (
                        <span className="rounded-sm border border-gold-500/20 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold-500">
                          PENDING
                        </span>
                      ) : (
                        <span className="rounded-sm border border-blue-400/20 bg-blue-400/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">
                          {row.type}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="relative flex justify-center">
                      <button
                        data-testid={`overflow-${row.key}`}
                        onClick={() => setOverflowKey(overflowKey === row.key ? null : row.key)}
                        className="cursor-pointer bg-transparent p-1 text-[16px] text-ash-dim"
                      >
                        {"⋯"}
                      </button>
                      {overflowKey === row.key && (
                        <div
                          data-testid={`overflow-menu-${row.key}`}
                          className="absolute right-0 top-full z-10 min-w-[200px] rounded-md border border-edge bg-ink-850 p-1 shadow-soft-drop"
                        >
                          <button
                            data-testid={`reset-random-${row.key}`}
                            onClick={() => {
                              setOverflowKey(null);
                              setConfirmReset(row.key);
                            }}
                            title="Use this to immediately invalidate a compromised secret while you arrange a replacement."
                            className="block w-full cursor-pointer rounded bg-transparent px-2.5 py-1.5 text-left font-sans text-[12px] text-gold-500 hover:bg-ink-800"
                          >
                            Reset to random (pending)
                          </button>
                          <button
                            data-testid={`delete-key-${row.key}`}
                            onClick={() => {
                              setOverflowKey(null);
                              setConfirmDelete(row.key);
                            }}
                            className="block w-full cursor-pointer rounded bg-transparent px-2.5 py-1.5 text-left font-sans text-[12px] text-stop-500 hover:bg-ink-800"
                          >
                            Delete key
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add key row */}
              {adding && (
                <div className="flex flex-col gap-2.5 border-t border-edge px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <input
                      data-testid="new-key-input"
                      placeholder="KEY_NAME"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className={NEW_KEY_INPUT}
                    />
                    {/* Mode toggle */}
                    <div
                      role="radiogroup"
                      className="flex overflow-hidden rounded-md border border-edge"
                    >
                      <button
                        data-testid="mode-set-value"
                        role="radio"
                        aria-checked={addMode === "value"}
                        onClick={() => {
                          setAddMode("value");
                          setNewValue("");
                        }}
                        className={`cursor-pointer border-r border-edge px-3.5 py-1 font-sans text-[11px] font-semibold ${
                          addMode === "value"
                            ? "bg-gold-500/15 text-gold-500"
                            : "bg-transparent text-ash"
                        }`}
                      >
                        Set value
                      </button>
                      <button
                        data-testid="mode-random"
                        role="radio"
                        aria-checked={addMode === "random"}
                        onClick={() => {
                          setAddMode("random");
                          setNewValue("");
                        }}
                        className={`cursor-pointer px-3.5 py-1 font-sans text-[11px] font-semibold ${
                          addMode === "random"
                            ? "bg-gold-500/15 text-gold-500"
                            : "bg-transparent text-ash"
                        }`}
                      >
                        Random (pending)
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {addMode === "value" ? (
                      <input
                        data-testid="new-value-input"
                        type="password"
                        placeholder="value"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        autoComplete="off"
                        className={NEW_VALUE_INPUT}
                      />
                    ) : (
                      <div className="flex-1 px-2.5 py-1.5 font-mono text-[11px] italic text-gold-500">
                        A cryptographically random placeholder will be generated server-side.
                      </div>
                    )}
                    <Button
                      variant="primary"
                      data-testid="add-key-submit"
                      onClick={() => {
                        if (isProduction) setProtectedConfirm("add");
                        else handleAdd();
                      }}
                    >
                      {addMode === "random" ? "Generate random value" : "Add"}
                    </Button>
                    <Button
                      onClick={() => {
                        setAdding(false);
                        setAddMode("value");
                        setNewKey("");
                        setNewValue("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Reset to random confirmation dialog */}
            {confirmReset && (
              <div
                data-testid="confirm-reset-dialog"
                className="mt-4 rounded-lg border border-gold-500/30 bg-gold-500/[0.04] px-4 py-3.5 font-sans text-[12px]"
              >
                <p className="m-0 mb-2.5 text-bone">
                  Reset <strong className="font-mono">{confirmReset}</strong> to a random
                  placeholder? The current value will be overwritten.
                </p>
                {isProduction && (
                  <p className="m-0 mb-2.5 text-[12px] font-semibold text-stop-500">
                    {"🔒"} This is a protected environment.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    data-testid="confirm-reset-yes"
                    onClick={() => handleResetToRandom(confirmReset)}
                  >
                    Reset to random
                  </Button>
                  <Button data-testid="confirm-reset-no" onClick={() => setConfirmReset(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Delete key confirmation dialog */}
            {confirmDelete && (
              <div
                data-testid="confirm-delete-dialog"
                className="mt-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3.5 font-sans text-[12px]"
              >
                <p className="m-0 mb-2.5 text-bone">
                  Permanently delete <strong className="font-mono">{confirmDelete}</strong> from{" "}
                  <strong>{env}</strong>? This cannot be undone.
                </p>
                {isProduction && (
                  <p className="m-0 mb-2.5 text-[12px] font-semibold text-stop-500">
                    {"🔒"} This is a protected environment.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    data-testid="confirm-delete-yes"
                    onClick={() => handleDelete(confirmDelete)}
                  >
                    Delete
                  </Button>
                  <Button data-testid="confirm-delete-no" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Protected environment confirmation dialog */}
            {protectedConfirm && (
              <div
                data-testid="confirm-protected-dialog"
                className="mt-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3.5 font-sans text-[12px]"
              >
                <p className="m-0 mb-2.5 text-bone">
                  {"🔒"} <strong className="text-stop-500">Protected environment.</strong> You are
                  about to {protectedConfirm === "save" ? "commit changes to" : "add a key to"}{" "}
                  <strong>{env}</strong>. Are you sure?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    data-testid="confirm-protected-yes"
                    onClick={async () => {
                      const action = protectedConfirm;
                      setProtectedConfirm(null);
                      if (action === "save") await handleSave(true);
                      else await handleAdd(true);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    data-testid="confirm-protected-no"
                    onClick={() => setProtectedConfirm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Schema section */}
            <div className="mt-6">
              <div className="mb-2.5 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ash">
                Schema · schemas/{ns}.yaml
              </div>
              <div
                data-testid="schema-summary"
                className="rounded-lg border border-edge bg-ink-850 px-4 py-3 font-mono text-[11px] leading-relaxed text-ash"
              >
                {(() => {
                  const errors = lintIssues.filter((i) => i.severity === "error");
                  const warnings = lintIssues.filter((i) => i.severity === "warning");
                  if (errors.length === 0 && warnings.length === 0) {
                    return (
                      <>
                        <span className="text-go-500">{"✓"}</span> All required keys present
                        &nbsp;·&nbsp;
                        <span className="text-go-500">{"✓"}</span> All types valid &nbsp;·&nbsp;
                        <span className="text-ash-dim">0 warnings</span>
                      </>
                    );
                  }
                  return (
                    <>
                      {errors.length > 0 && (
                        <span className="text-stop-500">
                          {errors.length} error{errors.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {errors.length > 0 && warnings.length > 0 && <span> &nbsp;·&nbsp; </span>}
                      {warnings.length > 0 && (
                        <span className="text-warn-500">
                          {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
