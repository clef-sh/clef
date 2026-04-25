import React, { useState, useEffect, useCallback } from "react";
import { ScanSearch } from "lucide-react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import { Toolbar } from "../primitives";
import type { ScanResult } from "@clef-sh/core";

type ScanState = "idle" | "scanning" | "clean" | "issues";
type MatchFilter = "all" | "unencrypted" | "pattern" | "entropy";

export function ScanScreen() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [severity, setSeverity] = useState<"all" | "high">("all");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [filter, setFilter] = useState<MatchFilter>("all");

  // On mount, restore last scan result from session
  useEffect(() => {
    apiFetch("/api/scan/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { lastRun: ScanResult | null; lastRunAt: string | null } | null) => {
        if (data?.lastRun) {
          setResult(data.lastRun);
          setLastRunAt(data.lastRunAt);
          const hasIssues =
            data.lastRun.matches.length > 0 || data.lastRun.unencryptedMatrixFiles.length > 0;
          setScanState(hasIssues ? "issues" : "clean");
        }
      })
      .catch(() => {
        // Silently fail — idle state is fine
      });
  }, []);

  const runScan = useCallback(async () => {
    setScanState("scanning");
    setDismissed([]);
    try {
      const res = await apiFetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ severity }),
      });
      if (!res.ok) throw new Error("Scan failed");
      const data: ScanResult = await res.json();
      setResult(data);
      setLastRunAt(new Date().toISOString());
      const hasIssues = data.matches.length > 0 || data.unencryptedMatrixFiles.length > 0;
      setScanState(hasIssues ? "issues" : "clean");
    } catch {
      setScanState("idle");
    }
  }, [severity]);

  const openFile = async (file: string) => {
    try {
      await apiFetch("/api/editor/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    } catch {
      // Non-fatal
    }
  };

  const formatRunAt = (iso: string | null) => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    return `${Math.floor(diff / 60_000)}m ago`;
  };

  const visibleMatches = (result?.matches ?? [])
    .map((m, i) => ({ ...m, _idx: i }))
    .filter((m) => !dismissed.includes(m._idx))
    .filter((m) => {
      if (filter === "pattern") return m.matchType === "pattern";
      if (filter === "entropy") return m.matchType === "entropy";
      return true;
    });

  const dismissedCount = dismissed.length;
  const totalIssues = (result?.matches.length ?? 0) + (result?.unencryptedMatrixFiles.length ?? 0);
  const durationSec = result ? (result.durationMs / 1000).toFixed(1) : "0.0";

  const filterButtons: ReadonlyArray<{ key: MatchFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "unencrypted", label: "Unencrypted" },
    { key: "pattern", label: "Pattern" },
    { key: "entropy", label: "Entropy" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Scan</Toolbar.Title>
          <Toolbar.Subtitle>clef scan — detect plaintext secrets</Toolbar.Subtitle>
        </div>
        {(scanState === "issues" || scanState === "clean") && (
          <Toolbar.Actions>
            <Button onClick={runScan}>↺ Scan again</Button>
          </Toolbar.Actions>
        )}
      </Toolbar>

      <div className="flex-1 overflow-auto p-6">
        {/* ── Idle ────────────────────────────────────────────────────── */}
        {scanState === "idle" && (
          <div data-testid="scan-idle" className="mx-auto max-w-[520px] pt-10">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <ScanSearch className="text-ash-dim" size={40} aria-hidden />
              <div className="font-sans text-[14px] leading-relaxed text-ash">
                Scans your repository for secrets that have escaped the Clef matrix — plaintext
                values in files that should be encrypted.
              </div>
            </div>

            {/* Severity selector */}
            <div className="mb-6">
              <div className="mb-2.5 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
                Severity
              </div>
              {(["all", "high"] as const).map((sev) => (
                <label
                  key={sev}
                  className={`mb-2 flex cursor-pointer items-center gap-2.5 font-sans text-[13px] ${
                    severity === sev ? "text-bone" : "text-ash"
                  }`}
                >
                  <input
                    type="radio"
                    name="severity"
                    value={sev}
                    checked={severity === sev}
                    onChange={() => setSeverity(sev)}
                    className="accent-gold-500"
                    data-testid={`severity-${sev}`}
                  />
                  {sev === "all" ? "All (patterns + entropy)" : "High (patterns only)"}
                </label>
              ))}
            </div>

            <Button variant="primary" onClick={runScan} data-testid="scan-button">
              Scan repository
            </Button>

            <div className="mt-6 rounded-md border border-edge bg-ink-850 px-4 py-3 font-sans text-[12px] text-ash">
              ℹ️ <code className="font-mono">clef scan</code> runs automatically on every commit via
              the pre-commit hook.
            </div>
          </div>
        )}

        {/* ── Scanning ────────────────────────────────────────────────── */}
        {scanState === "scanning" && (
          <div
            data-testid="scan-scanning"
            className="flex flex-col items-center justify-center gap-4 pt-20"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-gold-500/30 border-t-gold-500" />
            <div className="font-sans text-[14px] text-ash">Scanning...</div>
          </div>
        )}

        {/* ── Clean ───────────────────────────────────────────────────── */}
        {scanState === "clean" && result && (
          <div
            data-testid="scan-clean"
            className="flex flex-col items-center justify-center gap-3.5 pt-14"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-go-500/30 bg-go-500/15 text-[24px] text-go-500">
              ✓
            </div>
            <div className="font-sans text-[16px] font-semibold text-go-500">No issues found</div>
            <div className="font-mono text-[12px] text-ash">
              {result.filesScanned} files scanned in {durationSec}s
            </div>
            <div className="font-mono text-[11px] text-ash-dim">
              Last run: {formatRunAt(lastRunAt)}
            </div>
          </div>
        )}

        {/* ── Issues ──────────────────────────────────────────────────── */}
        {scanState === "issues" && result && (
          <div>
            {/* Summary */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="font-sans text-[14px] font-semibold text-bone">
                {totalIssues} issue{totalIssues !== 1 ? "s" : ""} found in {result.filesScanned}{" "}
                files ({durationSec}s)
              </span>
              <div className="flex-1" />
              {/* Filter */}
              {filterButtons.map(({ key, label }) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    data-testid={`filter-${key}`}
                    onClick={() => setFilter(key)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                      active
                        ? "border-gold-500/30 bg-gold-500/10 font-semibold text-gold-500"
                        : "border-edge-strong bg-transparent text-ash"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Unencrypted matrix files */}
            {(filter === "all" || filter === "unencrypted") &&
              result.unencryptedMatrixFiles.map((file) => (
                <IssueCard
                  key={`unenc-${file}`}
                  type="error"
                  typeLabel="UNENCRYPTED FILE"
                  file={file}
                  message="Missing SOPS metadata — file is in plaintext."
                  fixCommand={`clef encrypt ${file.replace(/\.enc\.(yaml|json)$/, "")}`}
                  onViewFile={() => openFile(file)}
                />
              ))}

            {/* Pattern / entropy matches */}
            {visibleMatches.map((match) => (
              <IssueCard
                key={`match-${match._idx}`}
                type="warning"
                typeLabel={
                  match.matchType === "pattern"
                    ? (match.patternName ?? "Pattern match").toUpperCase()
                    : `HIGH ENTROPY (${match.entropy?.toFixed(1)})`
                }
                file={`${match.file}:${match.line}`}
                message={match.preview}
                fixCommand={
                  match.matchType === "pattern"
                    ? `clef set <namespace>/<env> <KEY>`
                    : `clef set <namespace>/<env> ${match.preview.split("=")[0]}`
                }
                onViewFile={() => openFile(match.file)}
                onDismiss={() => setDismissed((d) => [...d, match._idx])}
              />
            ))}

            {dismissedCount > 0 && (
              <div className="mt-3 font-mono text-[11px] text-ash-dim">
                {dismissedCount} dismissed
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface IssueCardProps {
  type: "error" | "warning";
  typeLabel: string;
  file: string;
  message: string;
  fixCommand: string;
  onViewFile?: () => void;
  onDismiss?: () => void;
}

function IssueCard({
  type,
  typeLabel,
  file,
  message,
  fixCommand,
  onViewFile,
  onDismiss,
}: IssueCardProps) {
  const stripeClass = type === "error" ? "border-l-stop-500/40" : "border-l-warn-500/40";
  const tagClass =
    type === "error"
      ? "text-stop-500 bg-stop-500/15 border-stop-500/30"
      : "text-warn-500 bg-warn-500/15 border-warn-500/30";

  return (
    <div
      className={`mb-3 flex items-start gap-3.5 rounded-md border border-edge border-l-[3px] bg-ink-850 px-4.5 py-3.5 ${stripeClass}`}
    >
      <div className="min-w-0 flex-1">
        {/* Type badge + file */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.07em] ${tagClass}`}
          >
            {typeLabel}
          </span>
          <span
            className={`font-mono text-[12px] text-gold-500 ${onViewFile ? "cursor-pointer" : ""}`}
            onClick={onViewFile}
            role={onViewFile ? "button" : undefined}
            tabIndex={onViewFile ? 0 : undefined}
            onKeyDown={
              onViewFile
                ? (e) => {
                    if (e.key === "Enter") onViewFile();
                  }
                : undefined
            }
          >
            {file}
          </span>
        </div>

        {/* Message (preview) */}
        <div className="mb-2.5 font-mono text-[12px] text-bone" data-testid="match-preview">
          {message}
        </div>

        {/* Fix command */}
        <div className="flex w-fit items-center gap-2 rounded-md border border-edge-strong bg-ink-800 px-2.5 py-1.5">
          <span className="font-mono text-[11px] text-go-500">$</span>
          <span className="font-mono text-[11px] text-bone">{fixCommand}</span>
          <CopyButton text={fixCommand} />
        </div>

        {/* Actions */}
        {onViewFile && (
          <button
            data-testid="view-file-button"
            onClick={onViewFile}
            className="mt-2 cursor-pointer rounded-md border border-edge-strong bg-transparent px-2 py-0.5 font-sans text-[11px] text-ash"
          >
            View file
          </button>
        )}
      </div>

      {onDismiss && (
        <button
          data-testid="dismiss-button"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss issue"
          className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-[16px] leading-none text-ash-dim"
        >
          ×
        </button>
      )}
    </div>
  );
}
