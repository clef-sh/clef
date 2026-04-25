import React, { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar } from "../primitives";
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
  hsm: "HSM (PKCS#11)",
};

const KEY_PLACEHOLDERS: Record<string, string> = {
  awskms: "arn:aws:kms:region:account:key/id",
  gcpkms: "projects/.../locations/.../keyRings/.../cryptoKeys/...",
  azurekv: "https://vault-name.vault.azure.net/keys/key-name/version",
  pgp: "PGP fingerprint",
  hsm: "pkcs11:slot=0;label=clef-dek-wrapper",
};

const ALL_BACKENDS: BackendType[] = ["age", "awskms", "gcpkms", "azurekv", "pgp", "hsm"];

const TEXT_INPUT_BASE =
  "w-full box-border rounded-md border border-edge bg-ink-850 px-3 py-2 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim";

const SELECT_CLASSES =
  "w-full rounded-md border border-edge bg-ink-850 px-2.5 py-1.5 font-sans text-[13px] text-bone cursor-pointer outline-none focus-visible:border-gold-500";

export function BackendScreen({ manifest, setView, reloadManifest }: BackendScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [config, setConfig] = useState<BackendConfigResponse | null>(null);

  const [targetBackend, setTargetBackend] = useState<BackendType>("age");
  const [targetKey, setTargetKey] = useState("");
  const [scope, setScope] = useState<"all" | "single">("all");
  const [selectedEnv, setSelectedEnv] = useState("");

  const [previewResult, setPreviewResult] = useState<MigrationResponse | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

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
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Backend</Toolbar.Title>
          <Toolbar.Subtitle>clef migrate-backend — change encryption backend</Toolbar.Subtitle>
        </div>
      </Toolbar>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[620px]">
          {/* Step indicator */}
          <div className="mb-8 flex items-center">
            {([1, 2, 3, 4] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                      step >= s
                        ? "bg-gold-500 border border-gold-500 text-ink-950"
                        : "bg-ink-850 border border-edge text-ash-dim"
                    }`}
                  >
                    {s}
                  </div>
                  <span
                    className={`font-sans text-[12px] ${
                      step >= s ? "text-bone" : "text-ash-dim"
                    } ${step === s ? "font-semibold" : "font-normal"}`}
                  >
                    {s === 1 ? "Configure" : s === 2 ? "Preview" : s === 3 ? "Migrate" : "Done"}
                  </span>
                </div>
                {i < 3 && (
                  <div
                    className={`mx-3 h-px min-w-[20px] flex-1 ${
                      step > s ? "bg-gold-500" : "bg-edge"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3 font-sans text-[13px] text-stop-500">
              {error}
            </div>
          )}

          {/* ── Step 1: Configure ─────────────────────────────────────── */}
          {step === 1 && (
            <div>
              {config && (
                <div className="mb-6">
                  <Label>Current Configuration</Label>
                  <div className="rounded-lg border border-edge bg-ink-850 p-3.5">
                    <div className="mb-2 font-mono text-[12px] text-bone">
                      Default backend:{" "}
                      <span className="font-semibold text-gold-500">
                        {BACKEND_LABELS[config.global.default_backend]}
                      </span>
                    </div>
                    {config.environments.map((env) => (
                      <div
                        key={env.name}
                        className="mb-px flex items-center gap-2 font-mono text-[11px] text-ash"
                      >
                        <span>
                          {env.protected ? "🔒 " : ""}
                          {env.name}
                        </span>
                        <span className="text-ash-dim">→</span>
                        <span className={env.hasOverride ? "text-warn-500" : "text-ash"}>
                          {BACKEND_LABELS[env.effective.backend]}
                          {env.hasOverride ? " (override)" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-5">
                <Label>Target Backend</Label>
                <div className="flex flex-col gap-1.5">
                  {ALL_BACKENDS.map((b) => (
                    <label
                      key={b}
                      className={`flex cursor-pointer items-center gap-2 font-sans text-[13px] ${
                        targetBackend === b ? "text-bone" : "text-ash"
                      }`}
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
                        className="accent-gold-500"
                        data-testid={`backend-radio-${b}`}
                      />
                      {BACKEND_LABELS[b]}
                    </label>
                  ))}
                </div>
              </div>

              {targetBackend !== "age" && (
                <div className="mb-5">
                  <Label>Key Identifier</Label>
                  <input
                    type="text"
                    value={targetKey}
                    onChange={(e) => setTargetKey(e.target.value)}
                    placeholder={KEY_PLACEHOLDERS[targetBackend]}
                    data-testid="backend-key-input"
                    className={TEXT_INPUT_BASE}
                  />
                </div>
              )}

              <div className="mb-6">
                <Label>Scope</Label>
                <div className="mb-2 flex gap-4">
                  <label
                    className={`flex cursor-pointer items-center gap-1.5 font-sans text-[13px] ${
                      scope === "all" ? "text-bone" : "text-ash"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "all"}
                      onChange={() => setScope("all")}
                      className="accent-gold-500"
                    />
                    All environments
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-1.5 font-sans text-[13px] ${
                      scope === "single" ? "text-bone" : "text-ash"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "single"}
                      onChange={() => setScope("single")}
                      className="accent-gold-500"
                    />
                    Single environment
                  </label>
                </div>
                {scope === "single" && (
                  <select
                    value={selectedEnv}
                    onChange={(e) => setSelectedEnv(e.target.value)}
                    data-testid="env-select"
                    className={SELECT_CLASSES}
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

              {needsConfirmation && (
                <div className="mb-4 rounded-lg border border-warn-500/30 bg-warn-500/10 px-4 py-3">
                  <div className="mb-2 font-sans text-[13px] text-warn-500">
                    This migration affects protected environments.
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 font-sans text-[12px] text-bone">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="accent-warn-500"
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
              <div className="mb-5 font-sans text-[13px] text-ash">
                Migrating to{" "}
                <span className="font-semibold text-gold-500">{BACKEND_LABELS[targetBackend]}</span>
                {scope === "single" ? ` (${selectedEnv} only)` : " (all environments)"}
              </div>

              {previewResult.events.filter((e) => e.type === "info").length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-go-500">
                    Files to migrate ({previewResult.events.filter((e) => e.type === "info").length}
                    )
                  </SectionLabel>
                  {previewResult.events
                    .filter((e) => e.type === "info")
                    .map((e, i) => (
                      <FileRow key={i} icon="→" iconClass="text-go-500" label={e.message} />
                    ))}
                </div>
              )}

              {previewResult.events.filter((e) => e.type === "skip").length > 0 && (
                <div className="mb-4">
                  <SectionLabel toneClass="text-ash-dim">
                    Already on target (
                    {previewResult.events.filter((e) => e.type === "skip").length})
                  </SectionLabel>
                  {previewResult.events
                    .filter((e) => e.type === "skip")
                    .map((e, i) => (
                      <FileRow key={i} icon="↷" iconClass="text-ash-dim" label={e.message} />
                    ))}
                </div>
              )}

              {previewResult.result.warnings.length > 0 && (
                <div className="mb-4">
                  {previewResult.result.warnings.map((w, i) => (
                    <div key={i} className="mb-1 font-mono text-[11px] text-warn-500">
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex gap-2.5">
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
            <div className="flex flex-col items-center pt-10">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-edge border-t-gold-500" />
              <div className="font-sans text-[14px] text-ash">
                Migrating... this may take a moment
              </div>
            </div>
          )}

          {/* ── Step 4: Result ────────────────────────────────────────── */}
          {step === 4 && applyResult && (
            <div>
              <div className="flex flex-col items-center pt-5 pb-8">
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full text-[24px] ${
                    applyResult.result.rolledBack
                      ? "border border-stop-500/30 bg-stop-500/10 text-stop-500"
                      : "border border-go-500/30 bg-go-500/10 text-go-500"
                  }`}
                >
                  {applyResult.result.rolledBack ? "⚠" : "✓"}
                </div>
                <div
                  className={`mb-2 font-sans text-[16px] font-semibold ${
                    applyResult.result.rolledBack ? "text-stop-500" : "text-go-500"
                  }`}
                >
                  {applyResult.result.rolledBack ? "Migration failed" : "Migration complete"}
                </div>
                {applyResult.result.rolledBack && applyResult.result.error && (
                  <div className="mb-2 text-center font-mono text-[12px] text-stop-500">
                    {applyResult.result.error}
                  </div>
                )}
                {applyResult.result.rolledBack && (
                  <div className="mb-2 font-sans text-[12px] text-ash">
                    All changes have been rolled back.
                  </div>
                )}
                {!applyResult.result.rolledBack && (
                  <div className="font-mono text-[12px] text-ash">
                    {applyResult.result.migratedFiles.length} migrated,{" "}
                    {applyResult.result.skippedFiles.length} skipped,{" "}
                    {applyResult.result.verifiedFiles.length} verified
                  </div>
                )}
              </div>

              {applyResult.result.warnings.length > 0 && (
                <div className="mb-4">
                  {applyResult.result.warnings.map((w, i) => (
                    <div key={i} className="mb-1 font-mono text-[11px] text-warn-500">
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              )}

              {!applyResult.result.rolledBack && (
                <div className="mb-6 rounded-md border border-edge bg-ink-850 px-3.5 py-2.5 font-mono text-[11px] text-ash">
                  git add clef.yaml .sops.yaml secrets/ &amp;&amp; git commit -m "chore: migrate
                  backend to {targetBackend}"
                </div>
              )}

              <div className="flex gap-2.5">
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
    <div className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
      {children}
    </div>
  );
}

function SectionLabel({ children, toneClass }: { children: React.ReactNode; toneClass: string }) {
  return (
    <div
      className={`mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] ${toneClass}`}
    >
      {children}
    </div>
  );
}

function FileRow({ icon, iconClass, label }: { icon: string; iconClass: string; label: string }) {
  return (
    <div className="mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1">
      <span className={`font-mono text-[13px] ${iconClass}`}>{icon}</span>
      <span className="font-mono text-[12px] text-bone">{label}</span>
    </div>
  );
}
