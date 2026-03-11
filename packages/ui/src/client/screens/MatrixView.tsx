import React from "react";
import { theme } from "../theme";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { EnvBadge } from "../components/EnvBadge";
import { StatusDot } from "../components/StatusDot";
import type { ViewName } from "../components/Sidebar";
import type { ClefManifest, MatrixStatus } from "@clef-sh/core";

interface MatrixViewProps {
  setView: (view: ViewName) => void;
  setNs: (ns: string) => void;
  manifest: ClefManifest | null;
  matrixStatuses: MatrixStatus[];
}

function getStatusType(status: MatrixStatus): string {
  if (!status.cell.exists) return "missing_keys";
  const hasError = status.issues.some((i) => i.type === "missing_keys" || i.type === "sops_error");
  const hasWarning = status.issues.some((i) => i.type === "schema_warning");
  if (hasError) return "missing_keys";
  if (hasWarning) return "schema_warn";
  return "ok";
}

function formatDate(d: Date | null): string {
  if (!d) return "never";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  const diffW = Math.floor(diffD / 7);
  return `${diffW}w ago`;
}

export function MatrixView({ setView, setNs, manifest, matrixStatuses }: MatrixViewProps) {
  if (!manifest) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <TopBar title="Secret Matrix" subtitle="Loading..." />
        <div style={{ flex: 1, padding: 28 }}>
          <p style={{ color: theme.textMuted, fontFamily: theme.sans, fontSize: 13 }}>
            Loading manifest...
          </p>
        </div>
      </div>
    );
  }

  const environments = manifest.environments;
  const namespaces = manifest.namespaces;

  const healthyCount = matrixStatuses.filter((s) => s.cell.exists && s.issues.length === 0).length;
  const missingCount = matrixStatuses.filter(
    (s) => !s.cell.exists || s.issues.some((i) => i.type === "missing_keys"),
  ).length;
  const warnCount = matrixStatuses.filter((s) =>
    s.issues.some((i) => i.type === "schema_warning"),
  ).length;
  const totalPending = matrixStatuses.reduce((sum, s) => sum + (s.pendingCount ?? 0), 0);

  const fileCount = namespaces.length * environments.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Secret Matrix"
        subtitle={`${namespaces.length} namespaces \u00B7 ${environments.length} environments \u00B7 ${fileCount} files`}
        actions={
          <>
            <Button onClick={() => setView("lint")}>Lint All</Button>
            <Button variant="primary">+ Namespace</Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
        {/* Summary pills */}
        <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
          {[
            { label: `${healthyCount} healthy`, color: theme.green },
            { label: `${missingCount} missing keys`, color: theme.red },
            {
              label: `${warnCount} schema warning${warnCount !== 1 ? "s" : ""}`,
              color: theme.yellow,
            },
            ...(totalPending > 0
              ? [
                  {
                    label: `${totalPending} pending value${totalPending !== 1 ? "s" : ""}`,
                    color: theme.accent,
                  },
                ]
              : []),
          ].map((p) => (
            <div
              key={p.label}
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                fontWeight: 500,
                color: p.color,
                background: `${p.color}14`,
                border: `1px solid ${p.color}33`,
                borderRadius: 20,
                padding: "4px 14px",
              }}
            >
              {p.label}
            </div>
          ))}
        </div>

        {/* Matrix table */}
        <div
          data-testid="matrix-table"
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `180px ${environments.map(() => "1fr").join(" ")}`,
              borderBottom: `1px solid ${theme.border}`,
              background: "#0D0F14",
            }}
          >
            <div
              style={{
                padding: "12px 20px",
                fontFamily: theme.sans,
                fontSize: 11,
                fontWeight: 600,
                color: theme.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Namespace
            </div>
            {environments.map((env) => (
              <div
                key={env.name}
                style={{
                  padding: "12px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderLeft: `1px solid ${theme.border}`,
                }}
              >
                <EnvBadge env={env.name} />
                <span
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 12,
                    fontWeight: 500,
                    color: theme.text,
                  }}
                >
                  {env.name}
                </span>
              </div>
            ))}
          </div>

          {/* Namespace rows */}
          {namespaces.map((ns, i) => (
            <div
              key={ns.name}
              data-testid={`matrix-row-${ns.name}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setNs(ns.name);
                setView("editor");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setNs(ns.name);
                  setView("editor");
                }
              }}
              style={{
                display: "grid",
                gridTemplateColumns: `180px ${environments.map(() => "1fr").join(" ")}`,
                borderBottom: i < namespaces.length - 1 ? `1px solid ${theme.border}` : "none",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = theme.surfaceHover;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {/* Namespace label */}
              <div
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textDim,
                  }}
                >
                  //
                </span>
                <span
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text,
                  }}
                >
                  {ns.name}
                </span>
              </div>

              {/* Environment cells */}
              {environments.map((env) => {
                const cellStatus = matrixStatuses.find(
                  (s) => s.cell.namespace === ns.name && s.cell.environment === env.name,
                );
                const statusType = cellStatus ? getStatusType(cellStatus) : "ok";
                const keyCount = cellStatus?.keyCount ?? 0;
                const lastMod = cellStatus?.lastModified
                  ? formatDate(
                      cellStatus.lastModified instanceof Date
                        ? cellStatus.lastModified
                        : new Date(cellStatus.lastModified as unknown as string),
                    )
                  : "never";
                const missingKeyCount = cellStatus
                  ? cellStatus.issues.filter((i) => i.type === "missing_keys").length
                  : 0;
                const warnKeyCount = cellStatus
                  ? cellStatus.issues.filter((i) => i.type === "schema_warning").length
                  : 0;
                const cellPending = cellStatus?.pendingCount ?? 0;

                return (
                  <div
                    key={env.name}
                    style={{
                      padding: "14px 20px",
                      borderLeft: `1px solid ${theme.border}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <StatusDot status={statusType} />
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 11,
                          color: theme.textMuted,
                        }}
                      >
                        {keyCount} keys
                      </span>
                      {missingKeyCount > 0 && (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 10,
                            color: theme.red,
                            background: theme.redDim,
                            border: `1px solid ${theme.red}33`,
                            borderRadius: 3,
                            padding: "1px 5px",
                          }}
                        >
                          -{missingKeyCount} missing
                        </span>
                      )}
                      {warnKeyCount > 0 && (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 10,
                            color: theme.yellow,
                            background: theme.yellowDim,
                            border: `1px solid ${theme.yellow}33`,
                            borderRadius: 3,
                            padding: "1px 5px",
                          }}
                        >
                          {warnKeyCount} warn
                        </span>
                      )}
                      {cellPending > 0 && (
                        <span
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 10,
                            color: theme.accent,
                            background: `${theme.accent}18`,
                            border: `1px solid ${theme.accent}33`,
                            borderRadius: 3,
                            padding: "1px 5px",
                          }}
                        >
                          {cellPending} pending
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 10,
                        color: theme.textDim,
                      }}
                    >
                      {lastMod}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <Button data-testid="diff-environments-btn" onClick={() => setView("diff")}>
            Diff environments
          </Button>
        </div>
      </div>
    </div>
  );
}
