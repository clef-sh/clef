import React, { useState, useEffect, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { CopyButton } from "../components/CopyButton";
import type { ClefManifest, DiffResult } from "@clef-sh/core";

interface DiffViewProps {
  manifest: ClefManifest | null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

export function DiffView({ manifest }: DiffViewProps) {
  const environments = manifest?.environments ?? [];
  const namespaces = manifest?.namespaces ?? [];

  const [ns, setNs] = useState(namespaces[0]?.name ?? "");
  const [envA, setEnvA] = useState(environments[0]?.name ?? "");
  const [envB, setEnvB] = useState(environments[environments.length - 1]?.name ?? "");
  const [showSame, setShowSame] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (namespaces.length > 0 && !ns) setNs(namespaces[0].name);
    if (environments.length > 0 && !envA) setEnvA(environments[0].name);
    if (environments.length > 1 && !envB) setEnvB(environments[environments.length - 1].name);
  }, [namespaces, environments, ns, envA, envB]);

  const loadDiff = useCallback(async () => {
    if (!ns || !envA || !envB || envA === envB) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/diff/${ns}/${envA}/${envB}`);
      if (res.ok) {
        setDiffResult(await res.json());
      } else {
        setDiffResult(null);
      }
    } catch {
      setDiffResult(null);
    } finally {
      setLoading(false);
    }
  }, [ns, envA, envB]);

  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  const rows = diffResult?.rows ?? [];
  const filtered = rows.filter((r) => showSame || r.status !== "identical");

  const changedCount = rows.filter((r) => r.status === "changed").length;
  const missingACount = rows.filter((r) => r.status === "missing_a").length;
  const missingBCount = rows.filter((r) => r.status === "missing_b").length;
  const identicalCount = rows.filter((r) => r.status === "identical").length;
  const missingRows = rows.filter((r) => r.status === "missing_a" || r.status === "missing_b");

  const statusMeta: Record<string, { label: string; color: string }> = {
    changed: { label: "Changed", color: theme.yellow },
    identical: { label: "Identical", color: theme.textMuted },
    missing_a: { label: `Missing in ${envA}`, color: theme.red },
    missing_b: { label: `Missing in ${envB}`, color: theme.red },
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Environment Diff"
        subtitle="Compare secrets across environments"
        actions={
          <Button
            variant="primary"
            data-testid="sync-missing-btn"
            onClick={() => {
              setToastVisible(true);
              setTimeout(() => setToastVisible(false), 2000);
            }}
          >
            Sync missing keys {"\u2192"}
          </Button>
        }
      />

      {/* Toast */}
      {toastVisible && (
        <div
          data-testid="coming-soon-toast"
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            padding: "10px 18px",
            background: theme.surface,
            border: `1px solid ${theme.accent}44`,
            borderRadius: 8,
            fontFamily: theme.sans,
            fontSize: 12,
            color: theme.accent,
            zIndex: 1000,
          }}
        >
          Coming soon
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          padding: "14px 24px",
          background: "#0D0F14",
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            Namespace
          </span>
          <select
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: "5px 10px",
              fontFamily: theme.mono,
              fontSize: 12,
              color: theme.text,
              cursor: "pointer",
            }}
          >
            {namespaces.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            Compare
          </span>
          <select
            value={envA}
            onChange={(e) => setEnvA(e.target.value)}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: "5px 10px",
              fontFamily: theme.mono,
              fontSize: 12,
              color: theme.text,
              cursor: "pointer",
            }}
          >
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
          <span
            style={{
              fontFamily: theme.mono,
              fontSize: 12,
              color: theme.textDim,
            }}
          >
            {"\u2192"}
          </span>
          <select
            value={envB}
            onChange={(e) => setEnvB(e.target.value)}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: "5px 10px",
              fontFamily: theme.mono,
              fontSize: 12,
              color: theme.text,
              cursor: "pointer",
            }}
          >
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1 }} />

        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showSame}
            onChange={(e) => setShowSame(e.target.checked)}
            style={{ accentColor: theme.accent }}
          />
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            Show identical
          </span>
        </label>
      </div>

      {/* Summary strip */}
      <div
        style={{
          padding: "10px 24px",
          display: "flex",
          gap: 10,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        {[
          { label: `${changedCount} changed`, color: theme.yellow },
          ...(missingACount > 0
            ? [{ label: `${missingACount} missing in ${envA}`, color: theme.red }]
            : []),
          ...(missingBCount > 0
            ? [{ label: `${missingBCount} missing in ${envB}`, color: theme.red }]
            : []),
          { label: `${identicalCount} identical`, color: theme.textMuted },
        ].map((p) => (
          <span
            key={p.label}
            style={{
              fontFamily: theme.mono,
              fontSize: 11,
              color: p.color,
              background: `${p.color}14`,
              border: `1px solid ${p.color}33`,
              borderRadius: 20,
              padding: "2px 10px",
            }}
          >
            {p.label}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {loading && <p style={{ color: theme.textMuted, fontFamily: theme.sans }}>Loading...</p>}

        {!loading && (
          <>
            <div
              data-testid="diff-table"
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 1fr 1fr 100px",
                  background: "#0D0F14",
                  padding: "10px 20px",
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                <span
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 11,
                    fontWeight: 600,
                    color: theme.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  Key
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <EnvBadge env={envA} small />
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 11,
                      fontWeight: 600,
                      color: theme.textMuted,
                      textTransform: "uppercase",
                    }}
                  >
                    {envA}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <EnvBadge env={envB} small />
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 11,
                      fontWeight: 600,
                      color: theme.textMuted,
                      textTransform: "uppercase",
                    }}
                  >
                    {envB}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 11,
                    fontWeight: 600,
                    color: theme.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Status
                </span>
              </div>

              {filtered.map((row, i) => {
                const meta = statusMeta[row.status];
                return (
                  <div
                    key={row.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px 1fr 1fr 100px",
                      padding: "0 20px",
                      minHeight: 48,
                      alignItems: "center",
                      borderBottom: i < filtered.length - 1 ? `1px solid ${theme.border}` : "none",
                      background:
                        row.status === "changed"
                          ? `${theme.yellow}06`
                          : row.status.startsWith("missing")
                            ? `${theme.red}06`
                            : "transparent",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: theme.text,
                        paddingRight: 16,
                      }}
                    >
                      {row.key}
                    </span>

                    {/* Env A value */}
                    <div style={{ paddingRight: 16 }}>
                      {row.valueA !== null ? (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: row.status === "changed" ? theme.yellow : theme.textMuted,
                            background: row.status === "changed" ? theme.yellowDim : "transparent",
                            padding: row.status === "changed" ? "2px 6px" : "0",
                            borderRadius: 3,
                          }}
                        >
                          {truncate(row.valueA, 36)}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: theme.textDim,
                            fontStyle: "italic",
                          }}
                        >
                          {"\u2014"} not set {"\u2014"}
                        </span>
                      )}
                    </div>

                    {/* Env B value */}
                    <div style={{ paddingRight: 16 }}>
                      {row.valueB !== null ? (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: row.status === "changed" ? theme.blue : theme.textMuted,
                            background: row.status === "changed" ? theme.blueDim : "transparent",
                            padding: row.status === "changed" ? "2px 6px" : "0",
                            borderRadius: 3,
                          }}
                        >
                          {truncate(row.valueB, 36)}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: theme.textDim,
                            fontStyle: "italic",
                          }}
                        >
                          {"\u2014"} not set {"\u2014"}
                        </span>
                      )}
                    </div>

                    {/* Status badge */}
                    <span
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 10,
                        fontWeight: 600,
                        color: meta.color,
                        background: `${meta.color}18`,
                        border: `1px solid ${meta.color}33`,
                        borderRadius: 3,
                        padding: "2px 8px",
                        display: "inline-block",
                      }}
                    >
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Inline fix hint */}
            {missingRows.length > 0 && (
              <div
                data-testid="fix-hint"
                style={{
                  marginTop: 20,
                  padding: "14px 18px",
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {missingRows.map((row) => {
                  const missingEnv = row.status === "missing_a" ? envA : envB;
                  const cmd = `clef set ${ns}/${missingEnv} ${row.key}`;
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{"\uD83D\uDCA1"}</span>
                      <span
                        style={{
                          fontFamily: theme.sans,
                          fontSize: 12,
                          color: theme.textMuted,
                          flex: 1,
                        }}
                      >
                        <strong style={{ color: theme.text }}>{row.key}</strong> is missing in{" "}
                        <EnvBadge env={missingEnv} small />. Run{" "}
                        <code
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: theme.accent,
                            background: theme.accentDim,
                            padding: "1px 6px",
                            borderRadius: 3,
                          }}
                        >
                          {cmd}
                        </code>{" "}
                        to add it.
                      </span>
                      <CopyButton text={cmd} />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
