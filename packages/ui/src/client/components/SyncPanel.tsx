import React, { useState, useEffect } from "react";
import { theme } from "../theme";
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
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: "16px 20px",
        marginTop: 8,
        marginBottom: 8,
      }}
    >
      {phase === "loading" && (
        <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.textMuted }}>
          Loading sync preview...
        </div>
      )}

      {phase === "preview" && plan && (
        <>
          {plan.totalKeys === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                data-testid="sync-in-sync"
                style={{ fontFamily: theme.sans, fontSize: 13, color: theme.green }}
              >
                All environments in sync
              </span>
              <Button onClick={onCancel}>Close</Button>
            </div>
          ) : (
            <>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  fontWeight: 600,
                  color: theme.text,
                  marginBottom: 10,
                }}
              >
                Sync {namespace} — {plan.totalKeys} key{plan.totalKeys !== 1 ? "s" : ""} to scaffold
              </div>

              {plan.hasProtectedEnvs && (
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 12,
                    color: theme.yellow,
                    background: theme.yellowDim,
                    border: `1px solid ${theme.yellow}33`,
                    borderRadius: 5,
                    padding: "6px 12px",
                    marginBottom: 10,
                  }}
                >
                  Includes protected environment(s)
                </div>
              )}

              <div data-testid="sync-preview-list" style={{ marginBottom: 12 }}>
                {plan.cells.map((cell) => (
                  <div
                    key={`${cell.namespace}/${cell.environment}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                    }}
                  >
                    <EnvBadge env={cell.environment} />
                    <span
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: theme.textMuted,
                      }}
                    >
                      {cell.missingKeys.join(", ")}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
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

      {phase === "syncing" && (
        <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.accent }}>Syncing...</div>
      )}

      {phase === "done" && result && (
        <div
          data-testid="sync-done"
          style={{ fontFamily: theme.sans, fontSize: 13, color: theme.green }}
        >
          Synced {result.totalKeysScaffolded} key{result.totalKeysScaffolded !== 1 ? "s" : ""}{" "}
          across {result.modifiedCells.length} environment
          {result.modifiedCells.length !== 1 ? "s" : ""}
        </div>
      )}

      {phase === "error" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.red }}>{error}</span>
          <Button onClick={onCancel}>Close</Button>
        </div>
      )}
    </div>
  );
}
