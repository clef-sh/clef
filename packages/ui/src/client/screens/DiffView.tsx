import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { CopyButton } from "../components/CopyButton";
import { Toolbar, Table, EmptyState } from "../primitives";
import type { ClefManifest, DiffResult } from "@clef-sh/core";

interface DiffViewProps {
  manifest: ClefManifest | null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const SELECT_CLASSES =
  "rounded-md border border-edge bg-ink-850 px-2.5 py-1 font-mono text-[12px] text-bone cursor-pointer focus:outline-none focus:border-edge-strong";

type DiffStatus = "changed" | "identical" | "missing_a" | "missing_b";

export function DiffView({ manifest }: DiffViewProps) {
  const environments = manifest?.environments ?? [];
  const namespaces = manifest?.namespaces ?? [];

  const [ns, setNs] = useState(namespaces[0]?.name ?? "");
  const [envA, setEnvA] = useState(environments[0]?.name ?? "");
  const [envB, setEnvB] = useState(environments[environments.length - 1]?.name ?? "");
  const [showSame, setShowSame] = useState(false);
  const [showValues, setShowValues] = useState(false);
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
      const qs = showValues ? "?showValues=true" : "";
      const res = await apiFetch(`/api/diff/${ns}/${envA}/${envB}${qs}`);
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
  }, [ns, envA, envB, showValues]);

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

  const statusMeta: Record<
    DiffStatus,
    { label: string; text: string; bg: string; border: string }
  > = {
    changed: {
      label: "Changed",
      text: "text-warn-500",
      bg: "bg-warn-500/10",
      border: "border-warn-500/30",
    },
    identical: {
      label: "Identical",
      text: "text-ash",
      bg: "bg-ash/10",
      border: "border-ash/20",
    },
    missing_a: {
      label: `Missing in ${envA}`,
      text: "text-stop-500",
      bg: "bg-stop-500/10",
      border: "border-stop-500/30",
    },
    missing_b: {
      label: `Missing in ${envB}`,
      text: "text-stop-500",
      bg: "bg-stop-500/10",
      border: "border-stop-500/30",
    },
  };

  const summaryPills: Array<{ label: string; text: string; bg: string; border: string }> = [
    {
      label: `${changedCount} changed`,
      text: "text-warn-500",
      bg: "bg-warn-500/10",
      border: "border-warn-500/30",
    },
    ...(missingACount > 0
      ? [
          {
            label: `${missingACount} missing in ${envA}`,
            text: "text-stop-500",
            bg: "bg-stop-500/10",
            border: "border-stop-500/30",
          },
        ]
      : []),
    ...(missingBCount > 0
      ? [
          {
            label: `${missingBCount} missing in ${envB}`,
            text: "text-stop-500",
            bg: "bg-stop-500/10",
            border: "border-stop-500/30",
          },
        ]
      : []),
    {
      label: `${identicalCount} identical`,
      text: "text-ash",
      bg: "bg-ash/10",
      border: "border-ash/20",
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Environment Diff</Toolbar.Title>
          <Toolbar.Subtitle>Compare secrets across environments</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <Button
            variant="primary"
            data-testid="sync-missing-btn"
            onClick={() => {
              setToastVisible(true);
              setTimeout(() => setToastVisible(false), 2000);
            }}
          >
            Sync missing keys {"→"}
          </Button>
        </Toolbar.Actions>
      </Toolbar>

      {/* Toast */}
      {toastVisible && (
        <div
          data-testid="coming-soon-toast"
          className="fixed right-5 top-5 z-[1000] rounded-md border border-gold-500/30 bg-ink-850 px-4 py-2.5 font-sans text-[12px] text-gold-500"
        >
          Coming soon
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-edge bg-ink-800 px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-sans text-[12px] text-ash">Namespace</span>
          <select value={ns} onChange={(e) => setNs(e.target.value)} className={SELECT_CLASSES}>
            {namespaces.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-sans text-[12px] text-ash">Compare</span>
          <select value={envA} onChange={(e) => setEnvA(e.target.value)} className={SELECT_CLASSES}>
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
          <span className="font-mono text-[12px] text-ash-dim">{"→"}</span>
          <select value={envB} onChange={(e) => setEnvB(e.target.value)} className={SELECT_CLASSES}>
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showValues}
            onChange={(e) => setShowValues(e.target.checked)}
            data-testid="show-values-toggle"
            className="accent-gold-500"
          />
          <span className="font-sans text-[12px] text-ash">Show values</span>
        </label>

        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showSame}
            onChange={(e) => setShowSame(e.target.checked)}
            className="accent-gold-500"
          />
          <span className="font-sans text-[12px] text-ash">Show identical</span>
        </label>
      </div>

      {/* Summary strip */}
      <div className="flex gap-2.5 border-b border-edge px-6 py-2.5">
        {summaryPills.map((p) => (
          <span
            key={p.label}
            className={`rounded-pill border px-2.5 py-px font-mono text-[11px] ${p.text} ${p.bg} ${p.border}`}
          >
            {p.label}
          </span>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && <EmptyState title="Loading..." body="Computing diff between environments" />}

        {!loading && (
          <>
            <Table data-testid="diff-table">
              <Table.Header>
                <tr>
                  <Table.HeaderCell className="w-[220px]">Key</Table.HeaderCell>
                  <Table.HeaderCell>
                    <div className="flex items-center gap-2">
                      <EnvBadge env={envA} small />
                      <span>{envA}</span>
                    </div>
                  </Table.HeaderCell>
                  <Table.HeaderCell>
                    <div className="flex items-center gap-2">
                      <EnvBadge env={envB} small />
                      <span>{envB}</span>
                    </div>
                  </Table.HeaderCell>
                  <Table.HeaderCell className="w-[120px]">Status</Table.HeaderCell>
                </tr>
              </Table.Header>
              <tbody>
                {filtered.map((row) => {
                  const status = row.status as DiffStatus;
                  const meta = statusMeta[status];
                  const isChanged = status === "changed";
                  const isMissing = status === "missing_a" || status === "missing_b";
                  const rowBg = isChanged
                    ? "bg-warn-500/[0.025]"
                    : isMissing
                      ? "bg-stop-500/[0.025]"
                      : "";
                  return (
                    <Table.Row
                      key={row.key}
                      tone={isMissing ? "drift" : undefined}
                      className={rowBg}
                    >
                      <Table.Cell className="font-mono text-[12px] text-bone">{row.key}</Table.Cell>
                      <Table.Cell>
                        {row.valueA !== null ? (
                          <span
                            className={`font-mono text-[11px] ${
                              isChanged
                                ? "rounded-sm bg-warn-500/15 px-1.5 py-0.5 text-warn-500"
                                : "text-ash"
                            }`}
                          >
                            {truncate(row.valueA, 36)}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] italic text-ash-dim">
                            {"—"} not set {"—"}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {row.valueB !== null ? (
                          <span
                            className={`font-mono text-[11px] ${
                              isChanged
                                ? "rounded-sm bg-blue-400/15 px-1.5 py-0.5 text-blue-400"
                                : "text-ash"
                            }`}
                          >
                            {truncate(row.valueB, 36)}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] italic text-ash-dim">
                            {"—"} not set {"—"}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span
                          className={`inline-block rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold ${meta.text} ${meta.bg} ${meta.border}`}
                        >
                          {meta.label}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </tbody>
            </Table>

            {/* Inline fix hint */}
            {missingRows.length > 0 && (
              <div
                data-testid="fix-hint"
                className="mt-5 flex flex-col gap-2.5 rounded-md border border-edge bg-ink-850 px-[18px] py-3.5"
              >
                {missingRows.map((row) => {
                  const missingEnv = row.status === "missing_a" ? envA : envB;
                  const cmd = `clef set ${ns}/${missingEnv} ${row.key}`;
                  return (
                    <div key={row.key} className="flex items-center gap-3">
                      <span className="text-[16px]">{"💡"}</span>
                      <span className="flex-1 font-sans text-[12px] text-ash">
                        <strong className="text-bone">{row.key}</strong> is missing in{" "}
                        <EnvBadge env={missingEnv} small />. Run{" "}
                        <code className="rounded-sm bg-gold-500/15 px-1.5 py-px font-mono text-[11px] text-gold-500">
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
