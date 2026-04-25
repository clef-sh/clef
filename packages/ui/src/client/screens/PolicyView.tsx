import React, { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { Toolbar, Card, EmptyState, Badge } from "../primitives";
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

interface StatusMeta {
  label: string;
  icon: string;
  // Tailwind class fragments per status — kept as strings so JIT picks them up.
  textClass: string;
  bgClass: string;
  borderClass: string;
  stripeClass: string;
  badgeTone: "stop" | "warn" | "go";
}

const STATUS_META: Record<"overdue" | "unknown" | "ok", StatusMeta> = {
  overdue: {
    label: "Overdue",
    icon: "✕",
    textClass: "text-stop-500",
    bgClass: "bg-stop-500/15",
    borderClass: "border-stop-500/40",
    stripeClass: "border-l-stop-500/40",
    badgeTone: "stop",
  },
  unknown: {
    label: "Unknown",
    icon: "?",
    textClass: "text-warn-500",
    bgClass: "bg-warn-500/15",
    borderClass: "border-warn-500/40",
    stripeClass: "border-l-warn-500/40",
    badgeTone: "warn",
  },
  ok: {
    label: "OK",
    icon: "✓",
    textClass: "text-go-500",
    bgClass: "bg-go-500/15",
    borderClass: "border-go-500/40",
    stripeClass: "border-l-go-500/40",
    badgeTone: "go",
  },
};

// Per-env override chip. Mirrors `EnvBadge` color choices so the policy's
// environment overrides read with the same colors as the matrix.
const ENV_OVERRIDE_CLASSES: Record<string, { text: string; bg: string; border: string }> = {
  dev: { text: "text-go-500", bg: "bg-go-500/10", border: "border-go-500/20" },
  staging: { text: "text-warn-500", bg: "bg-warn-500/10", border: "border-warn-500/20" },
  production: { text: "text-stop-500", bg: "bg-stop-500/10", border: "border-stop-500/20" },
};

interface KeyRow {
  key: KeyRotationStatus;
  file: FileRotationStatus;
}

function keyRowStatus(k: KeyRotationStatus): "overdue" | "unknown" | "ok" {
  if (!k.last_rotated_known) return "unknown";
  if (k.rotation_overdue) return "overdue";
  return "ok";
}

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

function keyLimitDays(k: KeyRotationStatus): number | null {
  if (!k.last_rotated_at || !k.rotation_due) return null;
  const due = new Date(k.rotation_due).getTime();
  const last = new Date(k.last_rotated_at).getTime();
  return Math.round((due - last) / MS_PER_DAY);
}

const FILTER_DEFINITIONS: ReadonlyArray<{
  key: StatusFilter;
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
}> = [
  {
    key: "all",
    label: "All keys",
    textClass: "text-ash",
    bgClass: "bg-ash/10",
    borderClass: "border-ash/30",
  },
  {
    key: "overdue",
    label: "Overdue",
    textClass: "text-stop-500",
    bgClass: "bg-stop-500/15",
    borderClass: "border-stop-500/40",
  },
  {
    key: "unknown",
    label: "Unknown",
    textClass: "text-warn-500",
    bgClass: "bg-warn-500/15",
    borderClass: "border-warn-500/40",
  },
  {
    key: "ok",
    label: "Compliant",
    textClass: "text-go-500",
    bgClass: "bg-go-500/15",
    borderClass: "border-go-500/40",
  },
];

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

  // Extract namespace from cell path; mirrors LintView's handleNavigate.
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

  const filterCounts: Record<StatusFilter, number> = {
    all: counts.total,
    overdue: counts.overdue,
    unknown: counts.unknown,
    ok: counts.ok,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Policy</Toolbar.Title>
          <Toolbar.Subtitle>{"clef policy check — rotation verdicts"}</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <Button onClick={loadPolicy}>{"↻"} Re-run</Button>
        </Toolbar.Actions>
      </Toolbar>

      {/* Policy summary card */}
      {policy && (
        <div className="border-b border-edge bg-ink-850 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ash-dim">
              Default
            </span>
            <span className="font-mono text-[13px] text-bone">
              {policy.rotation?.max_age_days ?? "—"}
              <span className="ml-0.5 text-ash">d</span>
            </span>

            {policy.rotation?.environments &&
              Object.entries(policy.rotation.environments).map(([env, cfg]) => {
                const c = ENV_OVERRIDE_CLASSES[env] ?? {
                  text: "text-ash",
                  bg: "bg-transparent",
                  border: "border-ash/20",
                };
                return (
                  <span
                    key={env}
                    className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[11px] ${c.text} ${c.bg} ${c.border}`}
                  >
                    <span className="font-bold tracking-[0.06em]">{env.toUpperCase()}</span>
                    <span>{cfg.max_age_days}d</span>
                  </span>
                );
              })}

            <div className="flex-1" />

            <span
              data-testid="policy-source"
              className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] ${
                source === "file"
                  ? "border-go-500/30 bg-go-500/10 text-go-500"
                  : "border-edge bg-transparent text-ash"
              }`}
            >
              {source === "file" ? ".clef/policy.yaml" : "Built-in default"}
            </span>

            {rawYaml && (
              <button
                data-testid="toggle-yaml"
                onClick={() => setShowYaml((v) => !v)}
                className="cursor-pointer rounded-md border border-gold-500/30 bg-transparent px-2 py-0.5 font-sans text-[11px] text-gold-500 hover:bg-gold-500/10"
              >
                {showYaml ? "Hide YAML" : "View YAML"}
              </button>
            )}
          </div>

          {showYaml && rawYaml && (
            <pre
              data-testid="raw-yaml"
              className="mt-3 max-h-[200px] overflow-auto rounded-md border border-edge-strong bg-ink-800 px-3.5 py-3 font-mono text-[11px] text-bone"
            >
              {rawYaml}
            </pre>
          )}
        </div>
      )}

      {/* Summary chips — per-key counts */}
      {!loading && counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-edge bg-ink-800 px-6 py-3.5">
          {FILTER_DEFINITIONS.map((f) => {
            const active = filter === f.key;
            const count = filterCounts[f.key];
            return (
              <button
                key={f.key}
                data-testid={`filter-${f.key}`}
                onClick={() => setFilter(f.key)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-pill border px-3 py-1 font-sans text-[12px] transition-colors ${
                  active
                    ? `${f.textClass} ${f.bgClass} ${f.borderClass} font-semibold`
                    : "border-edge bg-transparent text-ash hover:text-bone"
                }`}
              >
                <span className={`font-mono text-[11px] font-bold ${f.textClass}`}>{count}</span>
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {loading && <EmptyState title="Evaluating policy..." />}

        {!loading && noFiles && (
          <EmptyState
            data-testid="no-files"
            title="No matrix files to evaluate."
            body="Add a namespace to your manifest to start tracking rotation policy."
          />
        )}

        {!loading && allCompliant && (
          <div
            data-testid="all-compliant"
            className="flex flex-col items-center justify-center gap-3.5 py-14"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-go-500/30 bg-go-500/15 text-[24px] text-go-500">
              {"✓"}
            </div>
            <div className="font-sans text-[16px] font-semibold text-go-500">All compliant</div>
            <div className="font-mono text-[12px] text-ash">
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
              <div key={status} className="mb-6">
                <div className="mb-2.5 flex items-center gap-2.5">
                  <div
                    className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border font-mono text-[11px] font-bold ${meta.borderClass} ${meta.bgClass} ${meta.textClass}`}
                  >
                    {meta.icon}
                  </div>
                  <span className={`font-sans text-[13px] font-semibold ${meta.textClass}`}>
                    {meta.label}
                  </span>
                  <span
                    className={`rounded-pill border px-2 py-px font-mono text-[10px] ${meta.borderClass} ${meta.bgClass} ${meta.textClass}`}
                  >
                    {group.length}
                  </span>
                </div>

                <Card className="overflow-hidden">
                  {group.map((row, i) => {
                    const { file, key } = row;
                    const limit = keyLimitDays(key);
                    const nsHint = namespaceFromPath(file.path) ?? "<namespace>";
                    const message =
                      status === "unknown"
                        ? `No rotation record · run clef set ${nsHint}/${file.environment} ${key.key} to establish`
                        : key.last_rotated_at
                          ? `Last rotated ${ageInDays(key.last_rotated_at)}d ago · limit ${limit ?? "?"}d · ${key.rotation_count} rotation${key.rotation_count === 1 ? "" : "s"}`
                          : `Rotation state inconsistent`;
                    const statusTag =
                      status === "overdue" ? `${meta.label} ${key.days_overdue}d` : meta.label;

                    return (
                      <div
                        key={`${file.path}-${key.key}-${i}`}
                        className={`flex items-start gap-3.5 border-l-[3px] px-4.5 py-3.5 transition-colors ${meta.stripeClass} ${
                          i < group.length - 1 ? "border-b border-edge" : ""
                        }`}
                      >
                        <div className="shrink-0 pt-0.5">
                          <Badge tone={meta.badgeTone} variant="solid">
                            {statusTag}
                          </Badge>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              data-testid={`key-ref-${key.key}`}
                              className="font-mono text-[13px] font-bold text-bone"
                            >
                              {key.key}
                            </span>
                            <span className="font-mono text-[10px] text-ash">{"←"}</span>
                            <span
                              data-testid={`file-ref-${file.path}`}
                              role="link"
                              tabIndex={0}
                              onClick={() => handleNavigate(file)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleNavigate(file);
                              }}
                              className="cursor-pointer font-mono text-[11px] font-medium text-gold-500 underline decoration-gold-500/40 decoration-dotted"
                            >
                              {file.path}
                            </span>
                            <EnvBadge env={file.environment} small />
                          </div>

                          <div className="font-sans text-[12px] text-ash">{message}</div>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </div>
            );
          })}

        {/* Footer hint */}
        {!loading && summary && summary.total_files > 0 && (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-edge bg-ink-850 px-4 py-3">
            <span className="text-[14px]">{"💡"}</span>
            <span className="font-sans text-[12px] text-ash">
              Edit{" "}
              <code className="rounded-sm bg-gold-500/10 px-1.5 py-px font-mono text-[11px] text-gold-500">
                .clef/policy.yaml
              </code>{" "}
              to change rotation limits. Run{" "}
              <code className="rounded-sm bg-gold-500/10 px-1.5 py-px font-mono text-[11px] text-gold-500">
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
