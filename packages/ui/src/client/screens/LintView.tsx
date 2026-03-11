import React, { useState, useEffect, useCallback } from "react";
import { theme, SEVERITY_META, CATEGORY_META } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { CopyButton } from "../components/CopyButton";
import type { ViewName } from "../components/Sidebar";
import type { LintResult, LintIssue } from "@clef-sh/core";

interface LintViewProps {
  setView: (view: ViewName) => void;
  setNs: (ns: string) => void;
}

export function LintView({ setView, setNs }: LintViewProps) {
  const [filter, setFilter] = useState("all");
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [loading, setLoading] = useState(false);

  const loadLint = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/lint");
      if (res.ok) {
        setLintResult(await res.json());
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLint();
  }, [loadLint]);

  const issues = lintResult?.issues ?? [];
  const fileCount = lintResult?.fileCount ?? 0;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  const visible = issues
    .map((issue, idx) => ({ ...issue, _idx: idx }))
    .filter((i) => !dismissed.includes(i._idx))
    .filter((i) => filter === "all" || i.severity === filter || i.category === filter);

  const handleNavigate = (issue: LintIssue) => {
    if (issue.file) {
      const parts = issue.file.split("/");
      const nsName = parts[parts.length - 2] ?? parts[0];
      setNs(nsName);
      setView("editor");
    }
  };

  const allClear = visible.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Lint"
        subtitle="clef lint \u2014 full repo health check"
        actions={
          <>
            <Button onClick={loadLint}>{"\u21BA"} Re-run</Button>
            {errors.length === 0 && <Button variant="primary">All clear {"\u2014"} commit</Button>}
          </>
        }
      />

      {/* Summary bar */}
      <div
        style={{
          padding: "14px 24px",
          background: "#0D0F14",
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {/* Severity filters */}
        {[
          {
            key: "all",
            label: "All issues",
            count: issues.length,
            color: theme.textMuted,
          },
          {
            key: "error",
            label: "Errors",
            count: errors.length,
            color: theme.red,
          },
          {
            key: "warning",
            label: "Warnings",
            count: warnings.length,
            color: theme.yellow,
          },
          {
            key: "info",
            label: "Info",
            count: infos.length,
            color: theme.blue,
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

        <div style={{ flex: 1 }} />

        {/* Category filters */}
        {(["matrix", "schema", "sops"] as const).map((cat) => {
          const m = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? "all" : cat)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: theme.mono,
                fontSize: 10,
                fontWeight: 600,
                color: filter === cat ? m.color : theme.textDim,
                background: filter === cat ? `${m.color}18` : "transparent",
                border: `1px solid ${filter === cat ? `${m.color}55` : theme.borderLight}`,
                letterSpacing: "0.06em",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {loading && <p style={{ color: theme.textMuted, fontFamily: theme.sans }}>Loading...</p>}

        {!loading && allClear && (
          <div
            data-testid="all-clear"
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
              All clear
            </div>
            <div
              style={{
                fontFamily: theme.mono,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              No issues found across {fileCount} files
            </div>
          </div>
        )}

        {/* Grouped issues */}
        {!loading &&
          !allClear &&
          (["error", "warning", "info"] as const).map((sev) => {
            const group = visible.filter((i) => i.severity === sev);
            if (!group.length) return null;
            const meta = SEVERITY_META[sev];

            return (
              <div key={sev} style={{ marginBottom: 24 }}>
                {/* Group header */}
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
                    {meta.label}s
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

                {/* Issue cards */}
                <div
                  style={{
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {group.map((issue, i) => {
                    const catMeta = CATEGORY_META[issue.category] ?? {
                      label: issue.category,
                      color: theme.textMuted,
                    };
                    const fileParts = issue.file?.split("/") ?? [];
                    const envName =
                      fileParts.length >= 2
                        ? fileParts[fileParts.length - 1]?.replace(".enc.yaml", "")
                        : undefined;

                    return (
                      <div
                        key={issue._idx}
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
                        {/* Category badge */}
                        <div style={{ flexShrink: 0, paddingTop: 2 }}>
                          <span
                            style={{
                              fontFamily: theme.mono,
                              fontSize: 9,
                              fontWeight: 700,
                              color: catMeta.color,
                              background: `${catMeta.color}18`,
                              border: `1px solid ${catMeta.color}33`,
                              borderRadius: 3,
                              padding: "2px 6px",
                              letterSpacing: "0.07em",
                              textTransform: "uppercase",
                            }}
                          >
                            {catMeta.label}
                          </span>
                        </div>

                        {/* Main content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* File + key */}
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
                              data-testid={`file-ref-${issue.file}`}
                              role="link"
                              tabIndex={0}
                              onClick={() => handleNavigate(issue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleNavigate(issue);
                              }}
                              style={{
                                fontFamily: theme.mono,
                                fontSize: 12,
                                fontWeight: 600,
                                color: theme.accent,
                                cursor: issue.file ? "pointer" : "default",
                                textDecoration: issue.file ? "underline" : "none",
                                textDecorationColor: `${theme.accent}55`,
                                textDecorationStyle: "dotted",
                              }}
                            >
                              {issue.file}
                            </span>
                            {issue.key && (
                              <>
                                <span
                                  style={{
                                    fontFamily: theme.mono,
                                    fontSize: 11,
                                    color: theme.textDim,
                                  }}
                                >
                                  {"\u2192"}
                                </span>
                                <span
                                  style={{
                                    fontFamily: theme.mono,
                                    fontSize: 11,
                                    color: theme.text,
                                    background: "#1A1F2B",
                                    border: `1px solid ${theme.borderLight}`,
                                    borderRadius: 3,
                                    padding: "1px 7px",
                                  }}
                                >
                                  {issue.key}
                                </span>
                              </>
                            )}
                            {envName && <EnvBadge env={envName} small />}
                          </div>

                          {/* Message */}
                          <div
                            style={{
                              fontFamily: theme.sans,
                              fontSize: 12,
                              color: theme.textMuted,
                              marginBottom: issue.fixCommand ? 10 : 0,
                            }}
                          >
                            {issue.message}
                          </div>

                          {/* Fix command */}
                          {issue.fixCommand && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                background: "#0D0F14",
                                border: `1px solid ${theme.borderLight}`,
                                borderRadius: 6,
                                padding: "6px 10px",
                                width: "fit-content",
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: theme.mono,
                                  fontSize: 11,
                                  color: theme.green,
                                }}
                              >
                                $
                              </span>
                              <span
                                style={{
                                  fontFamily: theme.mono,
                                  fontSize: 11,
                                  color: theme.text,
                                }}
                              >
                                {issue.fixCommand}
                              </span>
                              <CopyButton text={issue.fixCommand} />
                            </div>
                          )}
                        </div>

                        {/* Dismiss */}
                        <button
                          onClick={() => setDismissed((d) => [...d, issue._idx])}
                          title="Dismiss"
                          aria-label="Dismiss issue"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: theme.textDim,
                            fontSize: 16,
                            flexShrink: 0,
                            padding: "0 4px",
                            lineHeight: 1,
                            transition: "color 0.1s",
                          }}
                        >
                          {"\u00D7"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {/* Footer hint */}
        {!loading && !allClear && (
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
              Fix all errors before committing. Warnings and info items won't block commits but
              should be reviewed. Run{" "}
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
                clef lint --fix
              </code>{" "}
              to auto-resolve safe issues.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
