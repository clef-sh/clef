import React, { useState, useEffect, useCallback, useRef } from "react";
import { theme, ENV_COLORS } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
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
  manifest: ClefManifest | null;
}

export function NamespaceEditor({ ns, manifest }: NamespaceEditorProps) {
  const [env, setEnv] = useState("");
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

  // Clear timeout on unmount
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
        `encrypted with ${backend} \u00B7 ${recipientCount} recipient${recipientCount !== 1 ? "s" : ""}`,
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

    // Reset idle timeout on any reveal action
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
    try {
      // Each PUT auto-commits via the transaction manager, matching CLI
      // behavior where each `clef set` is its own commit. Serialize so
      // each transaction completes before the next starts.
      for (const row of dirtyRows) {
        const payload: Record<string, unknown> = { value: row.value };
        if (confirmed) payload.confirmed = true;
        await apiFetch(`/api/namespace/${ns}/${env}/${row.key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      await loadData();
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
      if (data.warning) {
        setError(data.warning);
      }
      // Update local state directly — avoids an extra decrypt round-trip
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
      // Update local state directly — avoids an extra decrypt round-trip
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title={`/${ns}`}
        subtitle={`Namespace \u00B7 ${rows.length} keys`}
        actions={
          <>
            {hasChanges && (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => {
                  if (isProduction) {
                    setProtectedConfirm("save");
                  } else {
                    handleSave();
                  }
                }}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button variant="primary" data-testid="add-key-btn" onClick={() => setAdding(true)}>
              + Add key
            </Button>
          </>
        }
      />

      {/* Env tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: `1px solid ${theme.border}`,
          padding: "0 24px",
          background: "#0D0F14",
        }}
      >
        {environments.map((e) => {
          const isActive = env === e.name;
          const c = ENV_COLORS[e.name] ?? { color: theme.textMuted };
          return (
            <div
              key={e.name}
              role="tab"
              tabIndex={0}
              onClick={() => setEnv(e.name)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") setEnv(e.name);
              }}
              style={{
                padding: "10px 18px",
                cursor: "pointer",
                borderBottom: isActive ? `2px solid ${c.color}` : "2px solid transparent",
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: -1,
              }}
            >
              <EnvBadge env={e.name} small />
              <span
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? theme.text : theme.textMuted,
                }}
              >
                {e.name}
              </span>
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <div
          style={{
            padding: "10px 0",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: theme.mono,
              fontSize: 10,
              color: theme.textMuted,
            }}
          >
            {sopsInfo}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {/* Production warning */}
        {isProduction && (
          <div
            data-testid="production-warning"
            style={{
              marginBottom: 20,
              padding: "10px 16px",
              background: theme.redDim,
              border: `1px solid ${theme.red}44`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 14 }}>{"\uD83D\uDD12"}</span>
            <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.red }}>
              <strong>Production environment.</strong> Changes will require confirmation before
              committing.
            </span>
          </div>
        )}

        {loading && <p style={{ color: theme.textMuted, fontFamily: theme.sans }}>Loading...</p>}

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: theme.redDim,
              border: `1px solid ${theme.red}44`,
              borderRadius: 8,
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.red,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Keys table */}
            <div
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "260px 1fr 90px 36px",
                  background: "#0D0F14",
                  padding: "10px 20px",
                  borderBottom: `1px solid ${theme.border}`,
                  borderRadius: "10px 10px 0 0",
                }}
              >
                {["Key", "Value", "Type", ""].map((h) => (
                  <span
                    key={h || "actions"}
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 11,
                      fontWeight: 600,
                      color: theme.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              {rows.map((row, i) => (
                <div
                  key={row.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "260px 1fr 90px 36px",
                    padding: "0 20px",
                    borderBottom: i < rows.length - 1 ? `1px solid ${theme.border}` : "none",
                    background: row.pending
                      ? "#F0A50012"
                      : row.edited
                        ? `${theme.accent}08`
                        : "transparent",
                    borderLeft: row.pending
                      ? "3px solid #F0A50088"
                      : row.edited
                        ? `2px solid ${theme.accent}`
                        : "2px solid transparent",
                    alignItems: "center",
                    minHeight: 48,
                  }}
                >
                  {/* Key */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      paddingRight: 16,
                    }}
                  >
                    {row.required && (
                      <span
                        style={{
                          color: theme.accent,
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        *
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: theme.text,
                      }}
                    >
                      {row.key}
                    </span>
                    {row.edited && (
                      <span
                        data-testid="dirty-dot"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: theme.accent,
                          flexShrink: 0,
                          display: "inline-block",
                        }}
                      />
                    )}
                  </div>

                  {/* Value */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      paddingRight: 16,
                    }}
                  >
                    {row.pending && !row.visible ? (
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 11,
                          fontStyle: "italic",
                          color: theme.accent,
                        }}
                      >
                        PENDING {"\u2014"} not yet set
                      </span>
                    ) : row.visible ? (
                      <input
                        type="text"
                        data-testid={`value-input-${row.key}`}
                        value={row.value}
                        onChange={(e) => handleEdit(row.key, e.target.value)}
                        autoComplete="off"
                        placeholder={row.pending ? "Enter real value..." : undefined}
                        style={{
                          flex: 1,
                          background: "#0D0F14",
                          border: `1px solid ${theme.borderLight}`,
                          borderRadius: 5,
                          padding: "5px 10px",
                          fontFamily: theme.mono,
                          fontSize: 12,
                          color: theme.text,
                          outline: "none",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 13,
                          color: theme.textMuted,
                          letterSpacing: "0.15em",
                        }}
                      >
                        {"\u2022".repeat(Math.min(row.value.length, 20))}
                      </span>
                    )}
                    {row.pending && !row.visible ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          data-testid={`set-value-${row.key}`}
                          onClick={() => toggleVisible(row.key)}
                          style={{
                            background: `${theme.accent}18`,
                            border: `1px solid ${theme.accent}55`,
                            borderRadius: 5,
                            cursor: "pointer",
                            color: theme.accent,
                            padding: "3px 10px",
                            fontFamily: theme.sans,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          Set value
                        </button>
                        <button
                          data-testid={`accept-value-${row.key}`}
                          onClick={() => handleAccept(row.key)}
                          title="Accept the random value as the final secret"
                          style={{
                            background: `${theme.green}18`,
                            border: `1px solid ${theme.green}55`,
                            borderRadius: 5,
                            cursor: "pointer",
                            color: theme.green,
                            padding: "3px 10px",
                            fontFamily: theme.sans,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          Accept random
                        </button>
                      </div>
                    ) : (
                      <button
                        data-testid={`eye-${row.key}`}
                        onClick={() => toggleVisible(row.key)}
                        aria-label={row.visible ? "Hide value" : "Reveal value"}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: row.visible ? theme.accent : theme.textDim,
                          padding: 4,
                          display: "flex",
                          alignItems: "center",
                          fontSize: 13,
                        }}
                      >
                        {"\uD83D\uDC41"}
                      </button>
                    )}
                  </div>

                  {/* Type */}
                  <div>
                    {row.pending ? (
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 10,
                          fontWeight: 700,
                          color: theme.accent,
                          background: `${theme.accent}18`,
                          border: `1px solid ${theme.accent}33`,
                          borderRadius: 3,
                          padding: "2px 7px",
                        }}
                      >
                        PENDING
                      </span>
                    ) : (
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 10,
                          color: theme.blue,
                          background: theme.blueDim,
                          border: `1px solid ${theme.blue}33`,
                          borderRadius: 3,
                          padding: "2px 7px",
                        }}
                      >
                        {row.type}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
                    <button
                      data-testid={`overflow-${row.key}`}
                      onClick={() => setOverflowKey(overflowKey === row.key ? null : row.key)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: theme.textDim,
                        fontSize: 16,
                        padding: 4,
                      }}
                    >
                      {"\u22EF"}
                    </button>
                    {overflowKey === row.key && (
                      <div
                        data-testid={`overflow-menu-${row.key}`}
                        style={{
                          position: "absolute",
                          top: "100%",
                          right: 0,
                          zIndex: 10,
                          background: theme.surface,
                          border: `1px solid ${theme.border}`,
                          borderRadius: 6,
                          padding: 4,
                          minWidth: 200,
                          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                        }}
                      >
                        <button
                          data-testid={`reset-random-${row.key}`}
                          onClick={() => {
                            setOverflowKey(null);
                            setConfirmReset(row.key);
                          }}
                          title="Use this to immediately invalidate a compromised secret while you arrange a replacement."
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: theme.sans,
                            fontSize: 12,
                            color: theme.accent,
                            padding: "6px 10px",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = theme.surfaceHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "none";
                          }}
                        >
                          Reset to random (pending)
                        </button>
                        <button
                          data-testid={`delete-key-${row.key}`}
                          onClick={() => {
                            setOverflowKey(null);
                            setConfirmDelete(row.key);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: theme.sans,
                            fontSize: 12,
                            color: theme.red,
                            padding: "6px 10px",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = theme.surfaceHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "none";
                          }}
                        >
                          Delete key
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Add key row */}
              {adding && (
                <div
                  style={{
                    padding: "12px 20px",
                    borderTop: `1px solid ${theme.border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      data-testid="new-key-input"
                      placeholder="KEY_NAME"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      style={{
                        flex: "0 0 240px",
                        background: "#0D0F14",
                        border: `1px solid ${theme.accent}66`,
                        borderRadius: 5,
                        padding: "6px 10px",
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: theme.text,
                        outline: "none",
                      }}
                    />
                    {/* Mode toggle */}
                    <div
                      role="radiogroup"
                      style={{
                        display: "flex",
                        border: `1px solid ${theme.border}`,
                        borderRadius: 6,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        data-testid="mode-set-value"
                        role="radio"
                        aria-checked={addMode === "value"}
                        onClick={() => {
                          setAddMode("value");
                          setNewValue("");
                        }}
                        style={{
                          fontFamily: theme.sans,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 14px",
                          border: "none",
                          borderRight: `1px solid ${theme.border}`,
                          background: addMode === "value" ? `${theme.accent}22` : "transparent",
                          color: addMode === "value" ? theme.accent : theme.textMuted,
                          cursor: "pointer",
                        }}
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
                        style={{
                          fontFamily: theme.sans,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 14px",
                          border: "none",
                          background: addMode === "random" ? `${theme.accent}22` : "transparent",
                          color: addMode === "random" ? theme.accent : theme.textMuted,
                          cursor: "pointer",
                        }}
                      >
                        Random (pending)
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {addMode === "value" ? (
                      <input
                        data-testid="new-value-input"
                        type="password"
                        placeholder="value"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        autoComplete="off"
                        style={{
                          flex: 1,
                          background: "#0D0F14",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 5,
                          padding: "6px 10px",
                          fontFamily: theme.mono,
                          fontSize: 12,
                          color: theme.text,
                          outline: "none",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          fontFamily: theme.mono,
                          fontSize: 11,
                          fontStyle: "italic",
                          color: theme.accent,
                          padding: "6px 10px",
                        }}
                      >
                        A cryptographically random placeholder will be generated server-side.
                      </div>
                    )}
                    <Button
                      variant="primary"
                      data-testid="add-key-submit"
                      onClick={() => {
                        if (isProduction) {
                          setProtectedConfirm("add");
                        } else {
                          handleAdd();
                        }
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
                style={{
                  marginTop: 16,
                  padding: "14px 18px",
                  background: `${theme.accent}0A`,
                  border: `1px solid ${theme.accent}33`,
                  borderRadius: 8,
                  fontFamily: theme.sans,
                  fontSize: 12,
                }}
              >
                <p style={{ color: theme.text, margin: "0 0 10px 0" }}>
                  Reset <strong style={{ fontFamily: theme.mono }}>{confirmReset}</strong> to a
                  random placeholder? The current value will be overwritten.
                </p>
                {isProduction && (
                  <p
                    style={{
                      color: theme.red,
                      margin: "0 0 10px 0",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {"\uD83D\uDD12"} This is a protected environment.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
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
                style={{
                  marginTop: 16,
                  padding: "14px 18px",
                  background: theme.redDim,
                  border: `1px solid ${theme.red}44`,
                  borderRadius: 8,
                  fontFamily: theme.sans,
                  fontSize: 12,
                }}
              >
                <p style={{ color: theme.text, margin: "0 0 10px 0" }}>
                  Permanently delete{" "}
                  <strong style={{ fontFamily: theme.mono }}>{confirmDelete}</strong> from{" "}
                  <strong>{env}</strong>? This cannot be undone.
                </p>
                {isProduction && (
                  <p
                    style={{
                      color: theme.red,
                      margin: "0 0 10px 0",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {"\uD83D\uDD12"} This is a protected environment.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
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
                style={{
                  marginTop: 16,
                  padding: "14px 18px",
                  background: theme.redDim,
                  border: `1px solid ${theme.red}44`,
                  borderRadius: 8,
                  fontFamily: theme.sans,
                  fontSize: 12,
                }}
              >
                <p style={{ color: theme.text, margin: "0 0 10px 0" }}>
                  {"\uD83D\uDD12"}{" "}
                  <strong style={{ color: theme.red }}>Protected environment.</strong> You are about
                  to {protectedConfirm === "save" ? "commit changes to" : "add a key to"}{" "}
                  <strong>{env}</strong>. Are you sure?
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="primary"
                    data-testid="confirm-protected-yes"
                    onClick={async () => {
                      const action = protectedConfirm;
                      setProtectedConfirm(null);
                      if (action === "save") {
                        await handleSave(true);
                      } else {
                        await handleAdd(true);
                      }
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
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 11,
                  fontWeight: 600,
                  color: theme.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 10,
                }}
              >
                Schema {"\u00B7"} schemas/{ns}.yaml
              </div>
              <div
                data-testid="schema-summary"
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontFamily: theme.mono,
                  fontSize: 11,
                  color: theme.textMuted,
                  lineHeight: 1.7,
                }}
              >
                {(() => {
                  const errors = lintIssues.filter((i) => i.severity === "error");
                  const warnings = lintIssues.filter((i) => i.severity === "warning");
                  if (errors.length === 0 && warnings.length === 0) {
                    return (
                      <>
                        <span style={{ color: theme.green }}>{"\u2713"}</span> All required keys
                        present &nbsp;{"\u00B7"}&nbsp;
                        <span style={{ color: theme.green }}>{"\u2713"}</span> All types valid
                        &nbsp;{"\u00B7"}&nbsp;
                        <span style={{ color: theme.textDim }}>0 warnings</span>
                      </>
                    );
                  }
                  return (
                    <>
                      {errors.length > 0 && (
                        <span style={{ color: theme.red }}>
                          {errors.length} error{errors.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {errors.length > 0 && warnings.length > 0 && (
                        <span> &nbsp;{"\u00B7"}&nbsp; </span>
                      )}
                      {warnings.length > 0 && (
                        <span style={{ color: theme.yellow }}>
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
