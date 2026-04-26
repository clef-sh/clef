import React, { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { Button } from "./Button";
import { EnvBadge } from "./EnvBadge";

interface SyncCellPlan {
  namespace: string;
  environment: string;
  missingKeys: string[];
  isProtected: boolean;
}

interface SyncPlan {
  cells: SyncCellPlan[];
  totalKeys: number;
  hasProtectedEnvs: boolean;
}

interface SyncResult {
  modifiedCells: string[];
  scaffoldedKeys: Record<string, string[]>;
  totalKeysScaffolded: number;
}

interface SyncPanelProps {
  namespace: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function SyncPanel({ namespace, onComplete, onCancel }: SyncPanelProps) {
  const [phase, setPhase] = useState<"loading" | "preview" | "syncing" | "done" | "error">(
    "loading",
  );
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/sync/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Preview failed");
          setPhase("error");
          return;
        }
        const data = (await res.json()) as SyncPlan;
        setPlan(data);
        setPhase("preview");
      } catch {
        if (!cancelled) {
          setError("Failed to load sync preview");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const handleSync = async () => {
    setPhase("syncing");
    try {
      const res = await apiFetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Sync failed");
        setPhase("error");
        return;
      }
      const data = await res.json();
      setResult(data.result as SyncResult);
      setPhase("done");
      setTimeout(onComplete, 1500);
    } catch {
      setError("Sync failed");
      setPhase("error");
    }
  };

  return (
    <div
      data-testid="sync-panel"
      className="my-2 rounded-lg border border-edge bg-ink-850 px-5 py-4"
    >
      {phase === "loading" && (
        <div className="font-sans text-[13px] text-ash">Loading sync preview...</div>
      )}

      {phase === "preview" && plan && (
        <>
          {plan.totalKeys === 0 ? (
            <div className="flex items-center gap-2.5">
              <span data-testid="sync-in-sync" className="font-sans text-[13px] text-go-500">
                All environments in sync
              </span>
              <Button onClick={onCancel}>Close</Button>
            </div>
          ) : (
            <>
              <div className="mb-2.5 font-sans text-[13px] font-semibold text-bone">
                Sync {namespace} — {plan.totalKeys} key{plan.totalKeys !== 1 ? "s" : ""} to scaffold
              </div>

              {plan.hasProtectedEnvs && (
                <div className="mb-2.5 rounded border border-warn-500/20 bg-warn-500/10 px-3 py-1.5 font-sans text-[12px] text-warn-500">
                  Includes protected environment(s)
                </div>
              )}

              <div data-testid="sync-preview-list" className="mb-3">
                {plan.cells.map((cell) => (
                  <div
                    key={`${cell.namespace}/${cell.environment}`}
                    className="flex items-center gap-2 py-1"
                  >
                    <EnvBadge env={cell.environment} />
                    <span className="font-mono text-[12px] text-ash">
                      {cell.missingKeys.join(", ")}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="primary" data-testid="sync-execute-btn" onClick={handleSync}>
                  Sync Now
                </Button>
                <Button data-testid="sync-cancel-btn" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {phase === "syncing" && <div className="font-sans text-[13px] text-gold-500">Syncing...</div>}

      {phase === "done" && result && (
        <div data-testid="sync-done" className="font-sans text-[13px] text-go-500">
          Synced {result.totalKeysScaffolded} key{result.totalKeysScaffolded !== 1 ? "s" : ""}{" "}
          across {result.modifiedCells.length} environment
          {result.modifiedCells.length !== 1 ? "s" : ""}
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2.5">
          <span className="font-sans text-[13px] text-stop-500">{error}</span>
          <Button onClick={onCancel}>Close</Button>
        </div>
      )}
    </div>
  );
}
