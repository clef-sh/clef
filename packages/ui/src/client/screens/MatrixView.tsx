import React, { useState } from "react";
import { Button } from "../components/Button";
import { MatrixGrid } from "../components/MatrixGrid";
import { SyncPanel } from "../components/SyncPanel";
import { Toolbar } from "../primitives";
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
      <div className="flex flex-1 flex-col">
        <Toolbar>
          <div>
            <Toolbar.Title>Secret Matrix</Toolbar.Title>
            <Toolbar.Subtitle>Loading...</Toolbar.Subtitle>
          </div>
        </Toolbar>
        <div className="flex-1 p-7">
          <p className="font-sans text-[13px] text-ash">Loading manifest...</p>
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Secret Matrix</Toolbar.Title>
          <Toolbar.Subtitle>
            {`${namespaces.length} namespaces · ${environments.length} environments · ${fileCount} files`}
          </Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
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
        </Toolbar.Actions>
      </Toolbar>

      <div className="relative flex-1 overflow-auto p-7">
        {matrixLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/85 rounded-lg">
            <div className="rounded-card border border-edge bg-ink-850 px-9 py-6 text-center">
              <div className="mb-2 text-[20px] text-gold-500">{"♪"}</div>
              <div className="font-sans text-[13px] text-ash">Loading...</div>
            </div>
          </div>
        )}

        <SummaryPills
          healthy={healthyCount}
          missing={missingCount}
          warn={warnCount}
          pending={totalPending}
        />

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

        <div className="mt-5 flex gap-2.5">
          <Button data-testid="diff-environments-btn" onClick={() => setView("diff")}>
            Diff environments
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SummaryPillsProps {
  healthy: number;
  missing: number;
  warn: number;
  pending: number;
}

const PILL_BASE = "rounded-pill border px-3.5 py-1 font-sans text-[12px] font-medium";

function SummaryPills({ healthy, missing, warn, pending }: SummaryPillsProps) {
  return (
    <div className="mb-7 flex gap-2.5">
      <span className={`${PILL_BASE} text-go-500 bg-go-500/10 border-go-500/20`}>
        {healthy} healthy
      </span>
      <span className={`${PILL_BASE} text-stop-500 bg-stop-500/10 border-stop-500/20`}>
        {missing} missing keys
      </span>
      <span className={`${PILL_BASE} text-warn-500 bg-warn-500/10 border-warn-500/20`}>
        {warn} schema warning{warn !== 1 ? "s" : ""}
      </span>
      {pending > 0 && (
        <span className={`${PILL_BASE} text-gold-500 bg-gold-500/10 border-gold-500/20`}>
          {pending} pending value{pending !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
