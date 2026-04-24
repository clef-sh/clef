import React, { useState, useEffect, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Scan"
        subtitle="clef scan — detect plaintext secrets"
        actions={
          scanState === "issues" || scanState === "clean" ? (
            <Button onClick={runScan}>&#x21BA; Scan again</Button>
          ) : undefined
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {/* ── Idle ────────────────────────────────────────────────────── */}
        {scanState === "idle" && (
          <div
            data-testid="scan-idle"
            style={{
              maxWidth: 520,
              margin: "0 auto",
              paddingTop: 40,
            }}
          >
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 14,
                color: theme.textMuted,
                marginBottom: 24,
                lineHeight: 1.6,
              }}
            >
              Scans your repository for secrets that have escaped the Clef matrix — plaintext values
              in files that should be encrypted.
            </div>

            {/* Severity selector */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.textMuted,
                  marginBottom: 10,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Severity
              </div>
              {(["all", "high"] as const).map((sev) => (
                <label
                  key={sev}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                    cursor: "pointer",
                    fontFamily: theme.sans,
                    fontSize: 13,
                    color: severity === sev ? theme.text : theme.textMuted,
                  }}
                >
                  <input
                    type="radio"
                    name="severity"
                    value={sev}
                    checked={severity === sev}
                    onChange={() => setSeverity(sev)}
                    style={{ accentColor: theme.accent }}
                    data-testid={`severity-${sev}`}
                  />
                  {sev === "all" ? "All (patterns + entropy)" : "High (patterns only)"}
                </label>
              ))}
            </div>

            <Button variant="primary" onClick={runScan} data-testid="scan-button">
              Scan repository
            </Button>

            <div
              style={{
                marginTop: 24,
                padding: "12px 16px",
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              &#x2139;&#xFE0F; <code style={{ fontFamily: theme.mono }}>clef scan</code> runs
              automatically on every commit via the pre-commit hook.
            </div>
          </div>
        )}

        {/* ── Scanning ────────────────────────────────────────────────── */}
        {scanState === "scanning" && (
          <div
            data-testid="scan-scanning"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              paddingTop: 80,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: `3px solid ${theme.accent}44`,
                borderTopColor: theme.accent,
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ fontFamily: theme.sans, fontSize: 14, color: theme.textMuted }}>
              Scanning...
            </div>
          </div>
        )}

        {/* ── Clean ───────────────────────────────────────────────────── */}
        {scanState === "clean" && result && (
          <div
            data-testid="scan-clean"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              paddingTop: 60,
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
                color: theme.green,
              }}
            >
              &#x2713;
            </div>
            <div
              style={{ fontFamily: theme.sans, fontWeight: 600, fontSize: 16, color: theme.green }}
            >
              No issues found
            </div>
            <div style={{ fontFamily: theme.mono, fontSize: 12, color: theme.textMuted }}>
              {result.filesScanned} files scanned in {durationSec}s
            </div>
            <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textDim }}>
              Last run: {formatRunAt(lastRunAt)}
            </div>
          </div>
        )}

        {/* ── Issues ──────────────────────────────────────────────────── */}
        {scanState === "issues" && result && (
          <div>
            {/* Summary */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{ fontFamily: theme.sans, fontSize: 14, color: theme.text, fontWeight: 600 }}
              >
                {totalIssues} issue{totalIssues !== 1 ? "s" : ""} found in {result.filesScanned}{" "}
                files ({durationSec}s)
              </span>
              <div style={{ flex: 1 }} />
              {/* Filter */}
              {(
                [
                  { key: "all", label: "All" },
                  { key: "unencrypted", label: "Unencrypted" },
                  { key: "pattern", label: "Pattern" },
                  { key: "entropy", label: "Entropy" },
                ] as { key: MatchFilter; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  data-testid={`filter-${key}`}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: theme.mono,
                    fontSize: 11,
                    fontWeight: filter === key ? 600 : 400,
                    color: filter === key ? theme.accent : theme.textMuted,
                    background: filter === key ? theme.accentDim : "transparent",
                    border: `1px solid ${filter === key ? theme.accent + "55" : theme.borderLight}`,
                  }}
                >
                  {label}
                </button>
              ))}
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
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 11,
                  color: theme.textDim,
                  marginTop: 12,
                }}
              >
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
  const color = type === "error" ? theme.red : theme.yellow;

  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${color}66`,
        borderRadius: 8,
        padding: "14px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Type badge + file */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: theme.mono,
              fontSize: 9,
              fontWeight: 700,
              color,
              background: `${color}18`,
              border: `1px solid ${color}33`,
              borderRadius: 3,
              padding: "2px 6px",
              letterSpacing: "0.07em",
            }}
          >
            {typeLabel}
          </span>
          <span
            style={{
              fontFamily: theme.mono,
              fontSize: 12,
              color: theme.accent,
              cursor: onViewFile ? "pointer" : "default",
            }}
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
        <div
          style={{ fontFamily: theme.mono, fontSize: 12, color: theme.text, marginBottom: 10 }}
          data-testid="match-preview"
        >
          {message}
        </div>

        {/* Fix command */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: theme.ink800,
            border: `1px solid ${theme.borderLight}`,
            borderRadius: 6,
            padding: "6px 10px",
            width: "fit-content",
          }}
        >
          <span style={{ fontFamily: theme.mono, fontSize: 11, color: theme.green }}>$</span>
          <span style={{ fontFamily: theme.mono, fontSize: 11, color: theme.text }}>
            {fixCommand}
          </span>
          <CopyButton text={fixCommand} />
        </div>

        {/* Actions */}
        {onViewFile && (
          <button
            data-testid="view-file-button"
            onClick={onViewFile}
            style={{
              marginTop: 8,
              background: "none",
              border: `1px solid ${theme.borderLight}`,
              borderRadius: 4,
              cursor: "pointer",
              color: theme.textMuted,
              fontFamily: theme.sans,
              fontSize: 11,
              padding: "3px 8px",
            }}
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
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: theme.textDim,
            fontSize: 16,
            flexShrink: 0,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          &#x00D7;
        </button>
      )}
    </div>
  );
}
