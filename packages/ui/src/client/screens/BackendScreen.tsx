import React, { useState, useEffect } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import type {
  ClefManifest,
  BackendType,
  MigrationResult,
  MigrationProgressEvent,
} from "@clef-sh/core";
import type { ViewName } from "../components/Sidebar";

interface BackendScreenProps {
  manifest: ClefManifest | null;
  setView: (view: ViewName) => void;
  reloadManifest: () => void;
}

interface BackendConfigResponse {
  global: {
    default_backend: BackendType;
    aws_kms_arn?: string;
    gcp_kms_resource_id?: string;
    azure_kv_url?: string;
    pgp_fingerprint?: string;
  };
  environments: Array<{
    name: string;
    protected: boolean;
    effective: { backend: BackendType };
    hasOverride: boolean;
  }>;
}

interface MigrationResponse {
  success: boolean;
  result: MigrationResult;
  events: MigrationProgressEvent[];
}

const BACKEND_LABELS: Record<BackendType, string> = {
  age: "age",
  awskms: "AWS KMS",
  gcpkms: "GCP KMS",
  azurekv: "Azure Key Vault",
  pgp: "PGP",
  cloud: "Cloud KMS",
};

const KEY_PLACEHOLDERS: Record<string, string> = {
  awskms: "arn:aws:kms:region:account:key/id",
  gcpkms: "projects/.../locations/.../keyRings/.../cryptoKeys/...",
  azurekv: "https://vault-name.vault.azure.net/keys/key-name/version",
  pgp: "PGP fingerprint",
};

const ALL_BACKENDS: BackendType[] = ["age", "awskms", "gcpkms", "azurekv", "pgp"];
export function BackendScreen({ manifest, setView, reloadManifest }: BackendScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [config, setConfig] = useState<BackendConfigResponse | null>(null);

  // Step 1 state
  const [targetBackend, setTargetBackend] = useState<BackendType>("age");
  const [targetKey, setTargetKey] = useState("");
  const [scope, setScope] = useState<"all" | "single">("all");
  const [selectedEnv, setSelectedEnv] = useState("");

  // Step 2 state
  const [previewResult, setPreviewResult] = useState<MigrationResponse | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Step 3/4 state
  const [applyResult, setApplyResult] = useState<MigrationResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (manifest && manifest.environments.length > 0 && !selectedEnv) {
      setSelectedEnv(manifest.environments[0].name);
    }
  }, [manifest, selectedEnv]);

  const loadConfig = async () => {
    try {
      const res = await apiFetch("/api/backend-config");
      if (res.ok) {
        setConfig(await res.json());
      }
    } catch {
      // Silently fail
    }
  };

  const handlePreview = async (withConfirmation = false) => {
    setLoading(true);
    setError(null);

    const body = {
      target: {
        backend: targetBackend,
        key: targetBackend !== "age" ? targetKey : undefined,
      },
      environment: scope === "single" ? selectedEnv : undefined,
      confirmed: withConfirmation || undefined,
    };

    try {
      const res = await apiFetch("/api/migrate-backend/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        setNeedsConfirmation(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Preview failed");
        setLoading(false);
        return;
      }

      const data: MigrationResponse = await res.json();
      setPreviewResult(data);
      setNeedsConfirmation(false);
      setConfirmed(false);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setStep(3);
    setError(null);

    const body = {
      target: {
        backend: targetBackend,
        key: targetBackend !== "age" ? targetKey : undefined,
      },
      environment: scope === "single" ? selectedEnv : undefined,
      confirmed: true,
    };

    try {
      const res = await apiFetch("/api/migrate-backend/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Migration failed");
        setStep(2);
        return;
      }

      const data: MigrationResponse = await res.json();
      setApplyResult(data);
      reloadManifest();
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
      setStep(2);
    }
  };

  const handleReset = () => {
    setStep(1);
    setPreviewResult(null);
    setApplyResult(null);
    setNeedsConfirmation(false);
    setConfirmed(false);
    setError(null);
    loadConfig();
  };

  const environments = manifest?.environments ?? [];
  const migrateCount =
    previewResult?.events.filter((e) => e.type === "info" && e.message.startsWith("Would"))
      .length ?? 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Backend" subtitle="clef migrate-backend — change encryption backend" />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          {/* Step indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              marginBottom: 32,
            }}
          >
            {([1, 2, 3, 4] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: step >= s ? theme.accent : theme.surface,
                      border: `1px solid ${step >= s ? theme.accent : theme.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: theme.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      color: step >= s ? "#000" : theme.textDim,
                    }}
                  >
                    {s}
                  </div>
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 12,
                      color: step >= s ? theme.text : theme.textDim,
                      fontWeight: step === s ? 600 : 400,
                    }}
                  >
                    {s === 1 ? "Configure" : s === 2 ? "Preview" : s === 3 ? "Migrate" : "Done"}
                  </span>
                </div>
                {i < 3 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: step > s ? theme.accent : theme.border,
                      margin: "0 12px",
                      minWidth: 20,
                    }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {error && (
            <div
              style={{
                background: theme.redDim,
                border: `1px solid ${theme.red}44`,
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.red,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Step 1: Configure ─────────────────────────────────────── */}
          {step === 1 && (
            <div>
              {/* Current config */}
              {config && (
                <div style={{ marginBottom: 24 }}>
                  <Label>Current Configuration</Label>
                  <div
                    style={{
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: theme.text,
                        marginBottom: 8,
                      }}
                    >
                      Default backend:{" "}
                      <span style={{ color: theme.accent, fontWeight: 600 }}>
                        {BACKEND_LABELS[config.global.default_backend]}
                      </span>
                    </div>
                    {config.environments.map((env) => (
                      <div
                        key={env.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontFamily: theme.mono,
                          fontSize: 11,
                          color: theme.textMuted,
                          marginBottom: 2,
                        }}
                      >
                        <span>
                          {env.protected ? "\uD83D\uDD12 " : ""}
                          {env.name}
                        </span>
                        <span style={{ color: theme.textDim }}>{"\u2192"}</span>
                        <span style={{ color: env.hasOverride ? theme.yellow : theme.textMuted }}>
                          {BACKEND_LABELS[env.effective.backend]}
                          {env.hasOverride ? " (override)" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Target backend */}
              <div style={{ marginBottom: 20 }}>
                <Label>Target Backend</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ALL_BACKENDS.map((b) => (
                    <label
                      key={b}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        fontFamily: theme.sans,
                        fontSize: 13,
                        color: targetBackend === b ? theme.text : theme.textMuted,
                      }}
                    >
                      <input
                        type="radio"
                        name="backend"
                        value={b}
                        checked={targetBackend === b}
                        onChange={() => {
                          setTargetBackend(b);
                          setTargetKey("");
                        }}
                        style={{ accentColor: theme.accent }}
                        data-testid={`backend-radio-${b}`}
                      />
                      {BACKEND_LABELS[b]}
                    </label>
                  ))}
                </div>
              </div>

              {/* Key input (non-age) */}
              {targetBackend !== "age" && (
                <div style={{ marginBottom: 20 }}>
                  <Label>Key Identifier</Label>
                  <input
                    type="text"
                    value={targetKey}
                    onChange={(e) => setTargetKey(e.target.value)}
                    placeholder={KEY_PLACEHOLDERS[targetBackend]}
                    data-testid="backend-key-input"
                    style={{
                      width: "100%",
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: "8px 12px",
                      fontFamily: theme.mono,
                      fontSize: 12,
                      color: theme.text,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {/* Scope */}
              <div style={{ marginBottom: 24 }}>
                <Label>Scope</Label>
                <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontFamily: theme.sans,
                      fontSize: 13,
                      color: scope === "all" ? theme.text : theme.textMuted,
                    }}
                  >
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "all"}
                      onChange={() => setScope("all")}
                      style={{ accentColor: theme.accent }}
                    />
                    All environments
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontFamily: theme.sans,
                      fontSize: 13,
                      color: scope === "single" ? theme.text : theme.textMuted,
                    }}
                  >
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "single"}
                      onChange={() => setScope("single")}
                      style={{ accentColor: theme.accent }}
                    />
                    Single environment
                  </label>
                </div>
                {scope === "single" && (
                  <select
                    value={selectedEnv}
                    onChange={(e) => setSelectedEnv(e.target.value)}
                    data-testid="env-select"
                    style={{
                      width: "100%",
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontFamily: theme.sans,
                      fontSize: 13,
                      color: theme.text,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {environments.map((env) => (
                      <option key={env.name} value={env.name}>
                        {env.name}
                        {env.protected ? " (protected)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Protected env confirmation */}
              {needsConfirmation && (
                <div
                  style={{
                    background: theme.yellowDim,
                    border: `1px solid ${theme.yellow}44`,
                    borderRadius: 8,
                    padding: "12px 16px",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 13,
                      color: theme.yellow,
                      marginBottom: 8,
                    }}
                  >
                    This migration affects protected environments.
                  </div>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontFamily: theme.sans,
                      fontSize: 12,
                      color: theme.text,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      style={{ accentColor: theme.yellow }}
                      data-testid="protected-confirm"
                    />
                    I understand and want to proceed
                  </label>
                </div>
              )}

              <Button
                variant="primary"
                onClick={() => handlePreview(confirmed)}
                disabled={loading || (targetBackend !== "age" && !targetKey.trim())}
              >
                {loading
                  ? "Loading..."
                  : needsConfirmation && confirmed
                    ? "Confirm & Preview"
                    : "Preview"}
              </Button>
            </div>
          )}

          {/* ── Step 2: Preview ───────────────────────────────────────── */}
          {step === 2 && previewResult && (
            <div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.textMuted,
                  marginBottom: 20,
                }}
              >
                Migrating to{" "}
                <span style={{ color: theme.accent, fontWeight: 600 }}>
                  {BACKEND_LABELS[targetBackend]}
                </span>
                {scope === "single" ? ` (${selectedEnv} only)` : " (all environments)"}
              </div>

              {/* Events / files to migrate */}
              {previewResult.events.filter((e) => e.type === "info").length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.green}>
                    Files to migrate ({previewResult.events.filter((e) => e.type === "info").length}
                    )
                  </SectionLabel>
                  {previewResult.events
                    .filter((e) => e.type === "info")
                    .map((e, i) => (
                      <FileRow key={i} icon={"\u2192"} iconColor={theme.green} label={e.message} />
                    ))}
                </div>
              )}

              {/* Skipped files */}
              {previewResult.events.filter((e) => e.type === "skip").length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel color={theme.textDim}>
                    Already on target (
                    {previewResult.events.filter((e) => e.type === "skip").length})
                  </SectionLabel>
                  {previewResult.events
                    .filter((e) => e.type === "skip")
                    .map((e, i) => (
                      <FileRow
                        key={i}
                        icon={"\u21B7"}
                        iconColor={theme.textDim}
                        label={e.message}
                      />
                    ))}
                </div>
              )}

              {/* Warnings */}
              {previewResult.result.warnings.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {previewResult.result.warnings.map((w, i) => (
                    <div
                      key={i}
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 11,
                        color: theme.yellow,
                        marginBottom: 4,
                      }}
                    >
                      {"\u26A0"} {w}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <Button variant="ghost" onClick={handleReset}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={handleApply}
                  disabled={migrateCount === 0}
                  data-testid="apply-button"
                >
                  Migrate {migrateCount} file{migrateCount !== 1 ? "s" : ""}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Executing ─────────────────────────────────────── */}
          {step === 3 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 40,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: `3px solid ${theme.border}`,
                  borderTopColor: theme.accent,
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                  marginBottom: 16,
                }}
              />
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 14,
                  color: theme.textMuted,
                }}
              >
                Migrating... this may take a moment
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* ── Step 4: Result ────────────────────────────────────────── */}
          {step === 4 && applyResult && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 20,
                  paddingBottom: 32,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: applyResult.result.rolledBack ? theme.redDim : theme.greenDim,
                    border: `1px solid ${applyResult.result.rolledBack ? theme.red + "44" : theme.green + "44"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: applyResult.result.rolledBack ? theme.red : theme.green,
                    marginBottom: 16,
                  }}
                >
                  {applyResult.result.rolledBack ? "\u26A0" : "\u2713"}
                </div>

                <div
                  style={{
                    fontFamily: theme.sans,
                    fontWeight: 600,
                    fontSize: 16,
                    color: applyResult.result.rolledBack ? theme.red : theme.green,
                    marginBottom: 8,
                  }}
                >
                  {applyResult.result.rolledBack ? "Migration failed" : "Migration complete"}
                </div>

                {applyResult.result.rolledBack && applyResult.result.error && (
                  <div
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 12,
                      color: theme.red,
                      marginBottom: 8,
                      textAlign: "center",
                    }}
                  >
                    {applyResult.result.error}
                  </div>
                )}

                {applyResult.result.rolledBack && (
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 12,
                      color: theme.textMuted,
                      marginBottom: 8,
                    }}
                  >
                    All changes have been rolled back.
                  </div>
                )}

                {!applyResult.result.rolledBack && (
                  <div
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 12,
                      color: theme.textMuted,
                    }}
                  >
                    {applyResult.result.migratedFiles.length} migrated,{" "}
                    {applyResult.result.skippedFiles.length} skipped,{" "}
                    {applyResult.result.verifiedFiles.length} verified
                  </div>
                )}
              </div>

              {/* Warnings */}
              {applyResult.result.warnings.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {applyResult.result.warnings.map((w, i) => (
                    <div
                      key={i}
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 11,
                        color: theme.yellow,
                        marginBottom: 4,
                      }}
                    >
                      {"\u26A0"} {w}
                    </div>
                  ))}
                </div>
              )}

              {!applyResult.result.rolledBack && (
                <div
                  style={{
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                    padding: "10px 14px",
                    marginBottom: 24,
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                  }}
                >
                  git add clef.yaml .sops.yaml secrets/ && git commit -m "chore: migrate backend to{" "}
                  {targetBackend}"
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="primary" onClick={() => setView("matrix")}>
                  View in Matrix
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Migrate again
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: 8,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 11,
        fontWeight: 600,
        color,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function FileRow({ icon, iconColor, label }: { icon: string; iconColor: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 10px",
        borderRadius: 6,
        marginBottom: 3,
      }}
    >
      <span style={{ color: iconColor, fontFamily: theme.mono, fontSize: 13 }}>{icon}</span>
      <span style={{ fontFamily: theme.mono, fontSize: 12, color: theme.text }}>{label}</span>
    </div>
  );
}
