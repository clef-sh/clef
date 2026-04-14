import React from "react";
import { theme } from "../theme";
import { EnvBadge } from "./EnvBadge";
import { StatusDot } from "./StatusDot";
import type { MatrixStatus } from "@clef-sh/core";

export interface MatrixGridProps {
  namespaces: Array<{ name: string }>;
  environments: Array<{ name: string }>;
  matrixStatuses: MatrixStatus[];
  onNamespaceClick?: (ns: string, env?: string) => void;
  onSyncClick?: (ns: string) => void;
  syncingNs?: string | null;
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

export function MatrixGrid({
  namespaces,
  environments,
  matrixStatuses,
  onNamespaceClick,
  onSyncClick,
  syncingNs,
}: MatrixGridProps) {
  return (
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
      {namespaces.map((ns, i) => {
        const nsCells = matrixStatuses.filter((s) => s.cell.namespace === ns.name);
        const hasDrift = nsCells.some((s) =>
          s.issues.some((issue) => issue.type === "missing_keys"),
        );

        return (
          <div
            key={ns.name}
            data-testid={`matrix-row-${ns.name}`}
            role="button"
            tabIndex={0}
            onClick={() => onNamespaceClick?.(ns.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onNamespaceClick?.(ns.name);
            }}
            // Cell-level clicks pass the environment; row-level is fallback
            style={{
              display: "grid",
              gridTemplateColumns: `180px ${environments.map(() => "1fr").join(" ")}`,
              borderBottom: i < namespaces.length - 1 ? `1px solid ${theme.border}` : "none",
              cursor: onNamespaceClick ? "pointer" : "default",
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
                  flex: 1,
                }}
              >
                {ns.name}
              </span>
              {hasDrift && syncingNs !== ns.name && onSyncClick && (
                <button
                  data-testid={`sync-btn-${ns.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSyncClick(ns.name);
                  }}
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 10,
                    fontWeight: 600,
                    color: theme.accent,
                    background: `${theme.accent}18`,
                    border: `1px solid ${theme.accent}33`,
                    borderRadius: 4,
                    padding: "2px 8px",
                    cursor: "pointer",
                  }}
                >
                  Sync
                </button>
              )}
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
                ? new Set(
                    cellStatus.issues
                      .filter((i) => i.type === "missing_keys" && i.key)
                      .map((i) => i.key),
                  ).size
                : 0;
              const warnKeyCount = cellStatus
                ? cellStatus.issues.filter((i) => i.type === "schema_warning").length
                : 0;
              const cellPending = cellStatus?.pendingCount ?? 0;

              return (
                <div
                  key={env.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNamespaceClick?.(ns.name, env.name);
                  }}
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
        );
      })}
    </div>
  );
}
