import React from "react";
import { Hash } from "lucide-react";
import { EnvBadge } from "./EnvBadge";
import { StatusDot } from "./StatusDot";
import { Table } from "../primitives";
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
    <Table data-testid="matrix-table">
      <Table.Header>
        <tr>
          <Table.HeaderCell className="w-[180px]">Namespace</Table.HeaderCell>
          {environments.map((env) => (
            <Table.HeaderCell key={env.name} className="border-l border-edge">
              <span className="inline-flex items-center gap-2">
                <EnvBadge env={env.name} />
                <span className="font-sans text-[12px] font-medium text-bone normal-case tracking-normal">
                  {env.name}
                </span>
              </span>
            </Table.HeaderCell>
          ))}
        </tr>
      </Table.Header>
      <tbody>
        {namespaces.map((ns) => {
          const nsCells = matrixStatuses.filter((s) => s.cell.namespace === ns.name);
          const hasDrift = nsCells.some((s) =>
            s.issues.some((issue) => issue.type === "missing_keys"),
          );
          return (
            <Table.Row
              key={ns.name}
              data-testid={`matrix-row-${ns.name}`}
              role="button"
              tabIndex={0}
              interactive={Boolean(onNamespaceClick)}
              tone={hasDrift ? "drift" : undefined}
              onClick={() => onNamespaceClick?.(ns.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNamespaceClick?.(ns.name);
              }}
            >
              <Table.Cell className="px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <Hash size={11} strokeWidth={1.75} className="text-ash-deep" aria-hidden="true" />
                  <span className="flex-1 font-mono text-[13px] font-semibold text-bone">
                    {ns.name}
                  </span>
                  {hasDrift && syncingNs !== ns.name && onSyncClick && (
                    <button
                      data-testid={`sync-btn-${ns.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSyncClick(ns.name);
                      }}
                      className="rounded border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 font-sans text-[10px] font-semibold text-gold-500 cursor-pointer hover:bg-gold-500/20"
                    >
                      Sync
                    </button>
                  )}
                </div>
              </Table.Cell>
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
                  <Table.Cell key={env.name} className="border-l border-edge px-5 py-3.5">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={statusType} />
                        <span className="font-mono text-[11px] text-ash">{keyCount} keys</span>
                        {missingKeyCount > 0 && (
                          <span className="rounded-sm border border-stop-500/20 bg-stop-500/10 px-1.5 py-px font-mono text-[10px] text-stop-500">
                            -{missingKeyCount} missing
                          </span>
                        )}
                        {warnKeyCount > 0 && (
                          <span className="rounded-sm border border-warn-500/20 bg-warn-500/10 px-1.5 py-px font-mono text-[10px] text-warn-500">
                            {warnKeyCount} warn
                          </span>
                        )}
                        {cellPending > 0 && (
                          <span className="rounded-sm border border-gold-500/20 bg-gold-500/10 px-1.5 py-px font-mono text-[10px] text-gold-500">
                            {cellPending} pending
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-ash-deep">{lastMod}</div>
                    </div>
                  </Table.Cell>
                );
              })}
            </Table.Row>
          );
        })}
      </tbody>
    </Table>
  );
}
