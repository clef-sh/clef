import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { CopyButton } from "../components/CopyButton";
import { Toolbar, Card, Badge, EmptyState } from "../primitives";
import type { BadgeTone } from "../primitives";
import type { ViewName } from "../components/Sidebar";
import type { LintResult, LintIssue } from "@clef-sh/core";

interface LintViewProps {
  setView: (view: ViewName) => void;
  setNs: (ns: string) => void;
}

type Severity = "error" | "warning" | "info";
type Category = "matrix" | "schema" | "sops";

const SEVERITY_TW: Record<
  Severity,
  {
    label: string;
    icon: string;
    text: string;
    bg: string;
    border: string;
    rowStripe: string;
  }
> = {
  error: {
    label: "Error",
    icon: "✕",
    text: "text-stop-500",
    bg: "bg-stop-500/10",
    border: "border-stop-500/30",
    rowStripe: "border-l-[3px] border-l-stop-500/40",
  },
  warning: {
    label: "Warning",
    icon: "⚠",
    text: "text-warn-500",
    bg: "bg-warn-500/10",
    border: "border-warn-500/30",
    rowStripe: "border-l-[3px] border-l-warn-500/40",
  },
  info: {
    label: "Info",
    icon: "i",
    text: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
    rowStripe: "border-l-[3px] border-l-blue-400/40",
  },
};

const CATEGORY_TW: Record<Category, { label: string; tone: BadgeTone }> = {
  matrix: { label: "Matrix", tone: "gold" },
  schema: { label: "Schema", tone: "blue" },
  sops: { label: "SOPS", tone: "purple" },
};

const FILTER_TW: Record<string, { text: string; bgActive: string; borderActive: string }> = {
  all: {
    text: "text-ash",
    bgActive: "bg-ash/15",
    borderActive: "border-ash/30",
  },
  error: {
    text: "text-stop-500",
    bgActive: "bg-stop-500/15",
    borderActive: "border-stop-500/40",
  },
  warning: {
    text: "text-warn-500",
    bgActive: "bg-warn-500/15",
    borderActive: "border-warn-500/40",
  },
  info: {
    text: "text-blue-400",
    bgActive: "bg-blue-400/15",
    borderActive: "border-blue-400/40",
  },
};

export function LintView({ setView, setNs }: LintViewProps) {
  const [filter, setFilter] = useState<string>("all");
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

  const severityFilters: Array<{
    key: string;
    label: string;
    count: number;
  }> = [
    { key: "all", label: "All issues", count: issues.length },
    { key: "error", label: "Errors", count: errors.length },
    { key: "warning", label: "Warnings", count: warnings.length },
    { key: "info", label: "Info", count: infos.length },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Lint</Toolbar.Title>
          <Toolbar.Subtitle>clef lint &mdash; full repo health check</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <Button onClick={loadLint}>
            <RefreshCw size={12} className="mr-1 inline-block align-[-2px]" />
            Re-run
          </Button>
          {errors.length === 0 && <Button variant="primary">All clear &mdash; commit</Button>}
        </Toolbar.Actions>
      </Toolbar>

      {/* Summary bar — only shown when there are issues */}
      {!loading && !allClear && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-edge bg-ink-800 px-6 py-3.5">
          {/* Severity filters */}
          {severityFilters.map((f) => {
            const tw = FILTER_TW[f.key];
            const active = filter === f.key;
            const baseClasses =
              "flex items-center gap-1.5 rounded-pill border px-3 py-1 font-sans text-[12px] transition-colors";
            const activeClasses = active
              ? `${tw.text} ${tw.bgActive} ${tw.borderActive} font-semibold`
              : "text-ash border-edge font-normal hover:border-edge-strong";
            return (
              <button
                key={f.key}
                data-testid={`filter-${f.key}`}
                onClick={() => setFilter(f.key)}
                className={`${baseClasses} ${activeClasses}`}
              >
                <span className={`font-mono text-[11px] font-bold ${tw.text}`}>{f.count}</span>
                {f.label}
              </button>
            );
          })}

          <div className="flex-1" />

          {/* Category filters */}
          {(["matrix", "schema", "sops"] as const).map((cat) => {
            const m = CATEGORY_TW[cat];
            const active = filter === cat;
            return (
              <button
                key={cat}
                onClick={() => setFilter(active ? "all" : cat)}
                className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                  active
                    ? "bg-ink-800 border-edge-strong text-bone"
                    : "border-edge-strong text-ash-dim hover:text-ash"
                }`}
              >
                <Badge tone={m.tone} variant={active ? "solid" : "outline"}>
                  {m.label}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <>
            <style>{`
              @keyframes clef-scan-line {
                0% { transform: scaleX(0); opacity: 0; }
                10% { opacity: 1; }
                50% { transform: scaleX(1); opacity: 1; }
                80% { transform: scaleX(1); opacity: 0.3; }
                100% { transform: scaleX(0); opacity: 0; }
              }
              @keyframes clef-scan-glow {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 1; }
              }
              .clef-scan-line { animation: clef-scan-line 1.8s ease-in-out infinite; transform-origin: left; opacity: 0; }
              .clef-scan-line-0 { animation-delay: 0s; width: 120px; }
              .clef-scan-line-1 { animation-delay: 0.3s; width: 90px; }
              .clef-scan-line-2 { animation-delay: 0.6s; width: 105px; }
              .clef-scan-glow { animation: clef-scan-glow 1.8s ease-in-out infinite; }
            `}</style>
            <div className="flex items-center justify-center px-6 py-12">
              <div className="min-w-[200px] rounded-card border border-edge bg-ink-850 px-10 py-7 text-center">
                <div className="mb-4 flex flex-col gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-[3px] rounded-sm bg-gold-500 clef-scan-line clef-scan-line-${i}`}
                    />
                  ))}
                </div>
                <div className="font-mono text-[11px] text-ash clef-scan-glow">Linting...</div>
              </div>
            </div>
          </>
        )}

        {!loading && allClear && (
          <EmptyState
            data-testid="all-clear"
            icon={<span className="text-go-500">{"✓"}</span>}
            title="All clear"
            body={`No issues found across ${fileCount} files`}
          />
        )}

        {/* Grouped issues */}
        {!loading &&
          !allClear &&
          (["error", "warning", "info"] as const).map((sev) => {
            const group = visible.filter((i) => i.severity === sev);
            if (!group.length) return null;
            const meta = SEVERITY_TW[sev];

            return (
              <div key={sev} className="mb-6">
                {/* Group header */}
                <div className="mb-2.5 flex items-center gap-2.5">
                  <div
                    className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border font-mono text-[11px] font-bold ${meta.bg} ${meta.border} ${meta.text}`}
                  >
                    {meta.icon}
                  </div>
                  <span className={`font-sans text-[13px] font-semibold ${meta.text}`}>
                    {meta.label}s
                  </span>
                  <span
                    className={`rounded-pill border px-2 py-px font-mono text-[10px] ${meta.bg} ${meta.border} ${meta.text}`}
                  >
                    {group.length}
                  </span>
                </div>

                {/* Issue cards */}
                <Card>
                  {group.map((issue, i) => {
                    const catKey = (issue.category as Category) ?? "matrix";
                    const catMeta = CATEGORY_TW[catKey] ?? {
                      label: issue.category,
                      tone: "default" as BadgeTone,
                    };
                    const fileParts = issue.file?.split("/") ?? [];
                    const envName =
                      fileParts.length >= 2
                        ? fileParts[fileParts.length - 1]?.replace(".enc.yaml", "")
                        : undefined;
                    const isLast = i === group.length - 1;

                    return (
                      <div
                        key={issue._idx}
                        className={`flex items-start gap-3.5 px-[18px] py-3.5 ${meta.rowStripe} ${
                          !isLast ? "border-b border-edge" : ""
                        }`}
                      >
                        {/* Category badge */}
                        <div className="shrink-0 pt-0.5">
                          <Badge tone={catMeta.tone}>{catMeta.label}</Badge>
                        </div>

                        {/* Main content */}
                        <div className="min-w-0 flex-1">
                          {/* File + key */}
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              data-testid={`file-ref-${issue.file}`}
                              role="link"
                              tabIndex={0}
                              onClick={() => handleNavigate(issue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleNavigate(issue);
                              }}
                              className={`font-mono text-[12px] font-semibold text-gold-500 ${
                                issue.file
                                  ? "cursor-pointer underline decoration-gold-500/40 decoration-dotted"
                                  : "cursor-default no-underline"
                              }`}
                            >
                              {issue.file}
                            </span>
                            {issue.key && (
                              <>
                                <span className="font-mono text-[11px] text-ash-dim">{"→"}</span>
                                <span className="rounded-sm border border-edge-strong bg-ink-900 px-[7px] py-px font-mono text-[11px] text-bone">
                                  {issue.key}
                                </span>
                              </>
                            )}
                            {envName && <EnvBadge env={envName} small />}
                          </div>

                          {/* Message */}
                          <div
                            className={`font-sans text-[12px] text-ash ${issue.fixCommand ? "mb-2.5" : ""}`}
                          >
                            {issue.message}
                          </div>

                          {/* Fix command */}
                          {issue.fixCommand && (
                            <div className="flex w-fit items-center gap-2 rounded-md border border-edge-strong bg-ink-800 px-2.5 py-1.5">
                              <span className="font-mono text-[11px] text-go-500">$</span>
                              <span className="font-mono text-[11px] text-bone">
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
                          className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-[16px] leading-none text-ash-dim transition-colors hover:text-bone"
                        >
                          {"×"}
                        </button>
                      </div>
                    );
                  })}
                </Card>
              </div>
            );
          })}

        {/* Footer hint */}
        {!loading && !allClear && (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-edge bg-ink-850 px-4 py-3">
            <span className="text-[14px]">{"💡"}</span>
            <span className="font-sans text-[12px] text-ash">
              Fix all errors before committing. Warnings and info items won&apos;t block commits but
              should be reviewed. Run{" "}
              <code className="rounded-sm bg-gold-500/15 px-1.5 py-px font-mono text-[11px] text-gold-500">
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
