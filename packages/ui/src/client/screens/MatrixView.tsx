import React, { useState } from "react";
import { theme } from "../theme";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { MatrixGrid } from "../components/MatrixGrid";
import { SyncPanel } from "../components/SyncPanel";
import type { ViewName } from "../components/Sidebar";
import type { ClefManifest, MatrixStatus } from "@clef-sh/core";

interface MatrixViewProps {
  setView: (view: ViewName) => void;
  setNs: (ns: string) => void;
  setEnv?: (env: string) => void;
  manifest: ClefManifest | null;
  matrixStatuses: MatrixStatus[];
  reloadMatrix?: () => void;
}

export function MatrixView({
  setView,
  setNs,
  setEnv,
  manifest,
  matrixStatuses,
  reloadMatrix,
}: MatrixViewProps) {
  const [syncingNs, setSyncingNs] = useState<string | null>(null);
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
  const matrixLoading = matrixStatuses.length === 0 && namespaces.length > 0;

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
            <Button onClick={() => setView("manifest")} data-testid="matrix-add-environment-btn">
              + Environment
            </Button>
            <Button
              variant="primary"
              onClick={() => setView("manifest")}
              data-testid="matrix-add-namespace-btn"
            >
              + Namespace
            </Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: 28, position: "relative" }}>
        {matrixLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `${theme.bg}dd`,
              zIndex: 10,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: "24px 36px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 20, color: theme.accent, marginBottom: 8 }}>{"\u266A"}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.textMuted }}>
                Loading...
              </div>
            </div>
          </div>
        )}
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

        <MatrixGrid
          namespaces={namespaces}
          environments={environments}
          matrixStatuses={matrixStatuses}
          onNamespaceClick={(nsName, envName) => {
            setNs(nsName);
            if (envName) setEnv?.(envName);
            setView("editor");
          }}
          onSyncClick={(nsName) => setSyncingNs(nsName)}
          syncingNs={syncingNs}
        />

        {syncingNs && (
          <SyncPanel
            namespace={syncingNs}
            onComplete={() => {
              setSyncingNs(null);
              reloadMatrix?.();
            }}
            onCancel={() => setSyncingNs(null)}
          />
        )}

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
