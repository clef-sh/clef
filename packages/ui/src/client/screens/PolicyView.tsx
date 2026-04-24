import React, { useState, useEffect, useCallback, useMemo } from "react";
import { theme, ENV_COLORS } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import type { ViewName } from "../components/Sidebar";
import type { PolicyDocument, FileRotationStatus, KeyRotationStatus } from "@clef-sh/core";

interface PolicyViewProps {
  setView: (view: ViewName) => void;
  setNs: (ns: string) => void;
}

interface PolicyCheckResponse {
  files: FileRotationStatus[];
  summary: {
    total_files: number;
    compliant: number;
    rotation_overdue: number;
    unknown_metadata: number;
  };
  policy: PolicyDocument;
  source: "file" | "default";
}

type StatusFilter = "all" | "overdue" | "unknown" | "ok";

const MS_PER_DAY = 86_400_000;

const STATUS_META = {
  overdue: { color: theme.red, bg: theme.redDim, label: "Overdue", icon: "\u2715" },
  unknown: { color: theme.yellow, bg: theme.yellowDim, label: "Unknown", icon: "?" },
  ok: { color: theme.green, bg: theme.greenDim, label: "OK", icon: "\u2713" },
} as const;

/**
 * A flattened row — one per (file, key) pair.  The PolicyView renders these
 * grouped by per-key status so users see the actual policy signal rather
 * than a file-level aggregate.
 */
interface KeyRow {
  key: KeyRotationStatus;
  file: FileRotationStatus;
}

function keyRowStatus(k: KeyRotationStatus): "overdue" | "unknown" | "ok" {
  // Unknown is checked before overdue because `rotation_overdue` is only
  // meaningful when `last_rotated_known` is true.
  if (!k.last_rotated_known) return "unknown";
  if (k.rotation_overdue) return "overdue";
  return "ok";
}

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

/** Derive max_age_days for a key from its rotation_due vs last_rotated_at. */
function keyLimitDays(k: KeyRotationStatus): number | null {
  if (!k.last_rotated_at || !k.rotation_due) return null;
  const due = new Date(k.rotation_due).getTime();
  const last = new Date(k.last_rotated_at).getTime();
  return Math.round((due - last) / MS_PER_DAY);
}

export function PolicyView({ setView, setNs }: PolicyViewProps) {
  const [data, setData] = useState<PolicyCheckResponse | null>(null);
  const [rawYaml, setRawYaml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showYaml, setShowYaml] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const [checkRes, policyRes] = await Promise.all([
        apiFetch("/api/policy/check"),
        apiFetch("/api/policy"),
      ]);
      if (checkRes.ok) {
        setData((await checkRes.json()) as PolicyCheckResponse);
      }
      if (policyRes.ok) {
        const p = (await policyRes.json()) as { rawYaml: string };
        setRawYaml(p.rawYaml);
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  // Extract the namespace from a cell path.  The cell path is shaped like
  // `{prefix...}/<namespace>/<environment>.enc.yaml` per the manifest's
  // file_pattern — so the second-to-last segment is always the namespace,
  // regardless of how many leading directories the repo uses.  Mirrors
  // LintView's handleNavigate.
  const namespaceFromPath = (filePath: string): string | undefined => {
    const parts = filePath.split("/");
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  };

  const handleNavigate = (file: FileRotationStatus) => {
    const ns = namespaceFromPath(file.path);
    if (ns) {
      setNs(ns);
      setView("editor");
    }
  };

  const files = data?.files ?? [];
  const summary = data?.summary;
  const policy = data?.policy;
  const source = data?.source;

  // Flatten (file, key) pairs so we can group by per-key status.  This is the
  // authoritative view of rotation compliance — unknown rotation state on a
  // single key fails the gate regardless of how many other keys are fresh.
  const allRows: KeyRow[] = useMemo(
    () => files.flatMap((f) => f.keys.map((k) => ({ file: f, key: k }))),
    [files],
  );

  const visible = useMemo(
    () => (filter === "all" ? allRows : allRows.filter((r) => keyRowStatus(r.key) === filter)),
    [allRows, filter],
  );

  const counts = useMemo(() => {
    let overdue = 0;
    let unknown = 0;
    let ok = 0;
    for (const r of allRows) {
      const s = keyRowStatus(r.key);
      if (s === "overdue") overdue++;
      else if (s === "unknown") unknown++;
      else ok++;
    }
    return { overdue, unknown, ok, total: allRows.length };
  }, [allRows]);

  const allCompliant = counts.total > 0 && counts.overdue === 0 && counts.unknown === 0;
  const noFiles = !loading && files.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Policy"
        subtitle={"clef policy check \u2014 rotation verdicts"}
        actions={<Button onClick={loadPolicy}>{"\u21BB"} Re-run</Button>}
      />

      {/* Policy summary card */}
      {policy && (
        <div
          style={{
            padding: "16px 24px",
            background: theme.surface,
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: theme.sans,
                fontSize: 11,
                fontWeight: 600,
                color: theme.textDim,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Default
            </span>
            <span
              style={{
                fontFamily: theme.mono,
                fontSize: 13,
                color: theme.text,
              }}
            >
              {policy.rotation?.max_age_days ?? "\u2014"}
              <span style={{ color: theme.textMuted, marginLeft: 2 }}>d</span>
            </span>

            {policy.rotation?.environments &&
              Object.entries(policy.rotation.environments).map(([env, cfg]) => {
                const c = ENV_COLORS[env] ?? { color: theme.textMuted, bg: "transparent" };
                return (
                  <span
                    key={env}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: c.bg,
                      border: `1px solid ${c.color}33`,
                      fontFamily: theme.mono,
                      fontSize: 11,
                      color: c.color,
                    }}
                  >
                    <span style={{ fontWeight: 700, letterSpacing: "0.06em" }}>
                      {env.toUpperCase()}
                    </span>
                    <span>{cfg.max_age_days}d</span>
                  </span>
                );
              })}

            <div style={{ flex: 1 }} />

            <span
              data-testid="policy-source"
              style={{
                fontFamily: theme.mono,
                fontSize: 10,
                color: source === "file" ? theme.green : theme.textMuted,
                background: source === "file" ? theme.greenDim : "transparent",
                border: `1px solid ${source === "file" ? `${theme.green}44` : theme.border}`,
                borderRadius: 3,
                padding: "2px 8px",
              }}
            >
              {source === "file" ? ".clef/policy.yaml" : "Built-in default"}
            </span>

            {rawYaml && (
              <button
                data-testid="toggle-yaml"
                onClick={() => setShowYaml((v) => !v)}
                style={{
                  fontFamily: theme.sans,
                  fontSize: 11,
                  color: theme.accent,
                  background: "transparent",
                  border: `1px solid ${theme.accent}33`,
                  borderRadius: 4,
                  padding: "3px 9px",
                  cursor: "pointer",
                }}
              >
                {showYaml ? "Hide YAML" : "View YAML"}
              </button>
            )}
          </div>

          {showYaml && rawYaml && (
            <pre
              data-testid="raw-yaml"
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: theme.ink800,
                border: `1px solid ${theme.borderLight}`,
                borderRadius: 6,
                fontFamily: theme.mono,
                fontSize: 11,
                color: theme.text,
                overflow: "auto",
                maxHeight: 200,
              }}
            >
              {rawYaml}
            </pre>
          )}
        </div>
      )}

      {/* Summary chips — per-key counts, not per-file */}
      {!loading && counts.total > 0 && (
        <div
          style={{
            padding: "14px 24px",
            background: theme.ink800,
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {[
            {
              key: "all" as const,
              label: "All keys",
              count: counts.total,
              color: theme.textMuted,
            },
            {
              key: "overdue" as const,
              label: "Overdue",
              count: counts.overdue,
              color: theme.red,
            },
            {
              key: "unknown" as const,
              label: "Unknown",
              count: counts.unknown,
              color: theme.yellow,
            },
            {
              key: "ok" as const,
              label: "Compliant",
              count: counts.ok,
              color: theme.green,
            },
          ].map((f) => (
            <button
              key={f.key}
              data-testid={`filter-${f.key}`}
              onClick={() => setFilter(f.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 20,
                cursor: "pointer",
                fontFamily: theme.sans,
                fontSize: 12,
                fontWeight: filter === f.key ? 600 : 400,
                color: filter === f.key ? f.color : theme.textMuted,
                background: filter === f.key ? `${f.color}18` : "transparent",
                border: `1px solid ${filter === f.key ? `${f.color}55` : theme.border}`,
                transition: "all 0.12s",
              }}
            >
              <span
                style={{
                  fontFamily: theme.mono,
                  fontSize: 11,
                  fontWeight: 700,
                  color: f.color,
                }}
              >
                {f.count}
              </span>
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {loading && (
          <>
            <style>{`
              @keyframes clef-policy-line {
                0% { transform: scaleX(0); opacity: 0; }
                10% { opacity: 1; }
                50% { transform: scaleX(1); opacity: 1; }
                80% { transform: scaleX(1); opacity: 0.3; }
                100% { transform: scaleX(0); opacity: 0; }
              }
              @keyframes clef-policy-glow {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 1; }
              }
            `}</style>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 24px",
              }}
            >
              <div
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 10,
                  padding: "28px 40px",
                  textAlign: "center",
                  minWidth: 200,
                }}
              >
                <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                  {[0, 0.3, 0.6].map((delay, i) => (
                    <div
                      key={i}
                      style={{
                        height: 3,
                        borderRadius: 2,
                        background: theme.accent,
                        transformOrigin: "left",
                        animation: `clef-policy-line 1.8s ease-in-out ${delay}s infinite`,
                        opacity: 0,
                        width: [120, 90, 105][i],
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                    animation: "clef-policy-glow 1.8s ease-in-out infinite",
                  }}
                >
                  Evaluating policy...
                </div>
              </div>
            </div>
          </>
        )}

        {!loading && noFiles && (
          <div
            data-testid="no-files"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "60px 0",
              color: theme.textMuted,
              fontFamily: theme.sans,
              fontSize: 13,
            }}
          >
            No matrix files to evaluate.
          </div>
        )}

        {!loading && allCompliant && (
          <div
            data-testid="all-compliant"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "60px 0",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: theme.greenDim,
                border: `1px solid ${theme.green}44`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              {"\u2713"}
            </div>
            <div
              style={{
                fontFamily: theme.sans,
                fontWeight: 600,
                fontSize: 16,
                color: theme.green,
              }}
            >
              All compliant
            </div>
            <div
              style={{
                fontFamily: theme.mono,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              {counts.total} key{counts.total === 1 ? "" : "s"} within rotation window across{" "}
              {summary?.total_files ?? 0} file{summary?.total_files === 1 ? "" : "s"}
            </div>
          </div>
        )}

        {/* Grouped per-key rows */}
        {!loading &&
          !allCompliant &&
          !noFiles &&
          policy &&
          (["overdue", "unknown", "ok"] as const).map((status) => {
            if (filter !== "all" && filter !== status) return null;
            const group = visible.filter((r) => keyRowStatus(r.key) === status);
            if (!group.length) return null;
            const meta = STATUS_META[status];

            return (
              <div key={status} style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: meta.bg,
                      border: `1px solid ${meta.color}44`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: theme.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      color: meta.color,
                    }}
                  >
                    {meta.icon}
                  </div>
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontWeight: 600,
                      fontSize: 13,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                  <span
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 10,
                      color: meta.color,
                      background: meta.bg,
                      border: `1px solid ${meta.color}33`,
                      borderRadius: 10,
                      padding: "1px 8px",
                    }}
                  >
                    {group.length}
                  </span>
                </div>

                <div
                  style={{
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {group.map((row, i) => {
                    const { file, key } = row;
                    const limit = keyLimitDays(key);
                    const nsHint = namespaceFromPath(file.path) ?? "<namespace>";
                    const message =
                      status === "unknown"
                        ? `No rotation record \u00B7 run clef set ${nsHint}/${file.environment} ${key.key} to establish`
                        : key.last_rotated_at
                          ? `Last rotated ${ageInDays(key.last_rotated_at)}d ago \u00B7 limit ${limit ?? "?"}d \u00B7 ${key.rotation_count} rotation${key.rotation_count === 1 ? "" : "s"}`
                          : `Rotation state inconsistent`;
                    const statusTag =
                      status === "overdue" ? `${meta.label} ${key.days_overdue}d` : meta.label;

                    return (
                      <div
                        key={`${file.path}-${key.key}-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          borderBottom: i < group.length - 1 ? `1px solid ${theme.border}` : "none",
                          borderLeft: `3px solid ${meta.color}66`,
                          transition: "background 0.1s",
                          padding: "14px 18px",
                          gap: 14,
                        }}
                      >
                        <div style={{ flexShrink: 0, paddingTop: 2 }}>
                          <span
                            style={{
                              fontFamily: theme.mono,
                              fontSize: 9,
                              fontWeight: 700,
                              color: meta.color,
                              background: `${meta.color}18`,
                              border: `1px solid ${meta.color}33`,
                              borderRadius: 3,
                              padding: "2px 6px",
                              letterSpacing: "0.07em",
                              textTransform: "uppercase",
                            }}
                          >
                            {statusTag}
                          </span>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 4,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              data-testid={`key-ref-${key.key}`}
                              style={{
                                fontFamily: theme.mono,
                                fontSize: 13,
                                fontWeight: 700,
                                color: theme.text,
                              }}
                            >
                              {key.key}
                            </span>
                            <span
                              style={{
                                fontFamily: theme.mono,
                                fontSize: 10,
                                color: theme.textMuted,
                              }}
                            >
                              {"\u2190"}
                            </span>
                            <span
                              data-testid={`file-ref-${file.path}`}
                              role="link"
                              tabIndex={0}
                              onClick={() => handleNavigate(file)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleNavigate(file);
                              }}
                              style={{
                                fontFamily: theme.mono,
                                fontSize: 11,
                                fontWeight: 500,
                                color: theme.accent,
                                cursor: "pointer",
                                textDecoration: "underline",
                                textDecorationColor: `${theme.accent}55`,
                                textDecorationStyle: "dotted",
                              }}
                            >
                              {file.path}
                            </span>
                            <EnvBadge env={file.environment} small />
                          </div>

                          <div
                            style={{
                              fontFamily: theme.sans,
                              fontSize: 12,
                              color: theme.textMuted,
                            }}
                          >
                            {message}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {/* Footer hint */}
        {!loading && summary && summary.total_files > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: "12px 16px",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 14 }}>{"\uD83D\uDCA1"}</span>
            <span
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              Edit{" "}
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
                .clef/policy.yaml
              </code>{" "}
              to change rotation limits. Run{" "}
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
                clef policy check
              </code>{" "}
              locally to reproduce this verdict.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
