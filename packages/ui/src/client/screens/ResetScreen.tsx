import React, { useState } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar, Field, Input } from "../primitives";
import type { BackendType, ClefManifest, ResetResult, ResetScope } from "@clef-sh/core";
import type { ViewName } from "../components/Sidebar";

interface ResetScreenProps {
  manifest: ClefManifest | null;
  setView: (view: ViewName) => void;
  reloadManifest: () => void;
}

interface ResetResponse {
  success: boolean;
  result: ResetResult;
}

const ALL_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp"] as const;
type SelectableBackend = (typeof ALL_BACKENDS)[number];

const BACKEND_LABELS: Record<SelectableBackend, string> = {
  age: "age",
  awskms: "AWS KMS",
  gcpkms: "GCP KMS",
  azurekv: "Azure Key Vault",
  pgp: "PGP",
};

const KEY_PLACEHOLDERS: Record<string, string> = {
  awskms: "arn:aws:kms:region:account:key/id",
  gcpkms: "projects/.../locations/.../keyRings/.../cryptoKeys/...",
  azurekv: "https://vault-name.vault.azure.net/keys/key-name/version",
  pgp: "PGP fingerprint",
};

type ScopeKind = "env" | "namespace" | "cell";
type Phase = "idle" | "running" | "done";

const SELECT_CLASSES =
  "w-full bg-ink-850 border border-edge rounded-md px-2.5 py-1.5 font-sans text-[13px] text-bone outline-none cursor-pointer focus-visible:border-gold-500";

export function ResetScreen({ manifest, setView, reloadManifest }: ResetScreenProps) {
  const environments = manifest?.environments ?? [];
  const namespaces = manifest?.namespaces ?? [];
  const firstEnv = environments[0]?.name ?? "";
  const firstNs = namespaces[0]?.name ?? "";

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [scopeKind, setScopeKind] = useState<ScopeKind>("env");
  const [envName, setEnvName] = useState(firstEnv);
  const [namespaceName, setNamespaceName] = useState(firstNs);
  const [cellNs, setCellNs] = useState(firstNs);
  const [cellEnv, setCellEnv] = useState(firstEnv);

  const [switchBackend, setSwitchBackend] = useState(false);
  const [targetBackend, setTargetBackend] = useState<BackendType>("age");
  const [targetKey, setTargetKey] = useState("");

  const [explicitKeys, setExplicitKeys] = useState("");
  const [typedConfirm, setTypedConfirm] = useState("");
  const [result, setResult] = useState<ResetResult | null>(null);

  // Mirrors core's `describeScope()` so the typed confirmation works without
  // a server round-trip.
  const scope: ResetScope | null =
    scopeKind === "env"
      ? envName
        ? { kind: "env", name: envName }
        : null
      : scopeKind === "namespace"
        ? namespaceName
          ? { kind: "namespace", name: namespaceName }
          : null
        : cellNs && cellEnv
          ? { kind: "cell", namespace: cellNs, environment: cellEnv }
          : null;

  const scopeLabel = !scope
    ? ""
    : scope.kind === "env"
      ? `env ${scope.name}`
      : scope.kind === "namespace"
        ? `namespace ${scope.name}`
        : `${scope.namespace}/${scope.environment}`;

  const backendKeyMissing =
    switchBackend && targetBackend !== "age" && targetKey.trim().length === 0;
  const confirmMatches = typedConfirm === scopeLabel && scopeLabel.length > 0;
  const canSubmit = scope !== null && confirmMatches && !backendKeyMissing && phase === "idle";

  const pendingCount = result
    ? Object.values(result.pendingKeysByCell).reduce((sum, keys) => sum + keys.length, 0)
    : 0;

  const handleReset = async () => {
    if (!scope) return;
    setPhase("running");
    setError(null);

    const explicitKeysList = explicitKeys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const body: {
      scope: ResetScope;
      backend?: BackendType;
      key?: string;
      keys?: string[];
    } = { scope };
    if (switchBackend) {
      body.backend = targetBackend;
      if (targetBackend !== "age") body.key = targetKey.trim();
    }
    if (explicitKeysList.length > 0) {
      body.keys = explicitKeysList;
    }

    try {
      const res = await apiFetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Reset failed" }))) as {
          error?: string;
        };
        setError(data.error ?? "Reset failed");
        setPhase("idle");
        return;
      }

      const data: ResetResponse = await res.json();
      setResult(data.result);
      reloadManifest();
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
      setPhase("idle");
    }
  };

  const handleStartOver = () => {
    setPhase("idle");
    setResult(null);
    setError(null);
    setTypedConfirm("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Reset</Toolbar.Title>
          <Toolbar.Subtitle>
            clef reset — destructively scaffold fresh placeholders
          </Toolbar.Subtitle>
        </div>
      </Toolbar>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-[620px] mx-auto">
          {error && (
            <div
              data-testid="reset-error"
              className="bg-stop-500/10 border border-stop-500/40 rounded-lg px-4 py-3 mb-4 font-sans text-[13px] text-stop-500"
            >
              {error}
            </div>
          )}

          {phase === "idle" && (
            <div>
              <div className="mb-5">
                <Label>Scope</Label>
                <div className="flex gap-4 mb-2.5">
                  {(["env", "namespace", "cell"] as const).map((k) => (
                    <label
                      key={k}
                      className={`flex items-center gap-1.5 cursor-pointer font-sans text-[13px] ${
                        scopeKind === k ? "text-bone" : "text-ash"
                      }`}
                    >
                      <input
                        type="radio"
                        name="reset-scope-kind"
                        checked={scopeKind === k}
                        onChange={() => {
                          setScopeKind(k);
                          setTypedConfirm("");
                        }}
                        data-testid={`reset-scope-${k}`}
                        className="accent-gold-500"
                      />
                      {k === "env" ? "Environment" : k === "namespace" ? "Namespace" : "Cell"}
                    </label>
                  ))}
                </div>

                {scopeKind === "env" && (
                  <select
                    value={envName}
                    onChange={(e) => {
                      setEnvName(e.target.value);
                      setTypedConfirm("");
                    }}
                    data-testid="reset-env-select"
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

                {scopeKind === "namespace" && (
                  <select
                    value={namespaceName}
                    onChange={(e) => {
                      setNamespaceName(e.target.value);
                      setTypedConfirm("");
                    }}
                    data-testid="reset-namespace-select"
                    className={SELECT_CLASSES}
                  >
                    {namespaces.map((ns) => (
                      <option key={ns.name} value={ns.name}>
                        {ns.name}
                      </option>
                    ))}
                  </select>
                )}

                {scopeKind === "cell" && (
                  <div className="flex gap-2">
                    <select
                      value={cellNs}
                      onChange={(e) => {
                        setCellNs(e.target.value);
                        setTypedConfirm("");
                      }}
                      data-testid="reset-cell-namespace-select"
                      className={`${SELECT_CLASSES} flex-1`}
                    >
                      {namespaces.map((ns) => (
                        <option key={ns.name} value={ns.name}>
                          {ns.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cellEnv}
                      onChange={(e) => {
                        setCellEnv(e.target.value);
                        setTypedConfirm("");
                      }}
                      data-testid="reset-cell-env-select"
                      className={`${SELECT_CLASSES} flex-1`}
                    >
                      {environments.map((env) => (
                        <option key={env.name} value={env.name}>
                          {env.name}
                          {env.protected ? " (protected)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mb-5">
                <label className="flex items-center gap-2 cursor-pointer font-sans text-[13px] text-bone">
                  <input
                    type="checkbox"
                    checked={switchBackend}
                    onChange={(e) => setSwitchBackend(e.target.checked)}
                    data-testid="reset-switch-backend"
                    className="accent-gold-500"
                  />
                  Switch backend as part of reset
                </label>
                {switchBackend && (
                  <div className="mt-3 p-3.5 bg-ink-850 border border-edge rounded-lg">
                    <Label>Target Backend</Label>
                    <div className="flex flex-col gap-1.5">
                      {ALL_BACKENDS.map((b) => (
                        <label
                          key={b}
                          className={`flex items-center gap-2 cursor-pointer font-sans text-[13px] ${
                            targetBackend === b ? "text-bone" : "text-ash"
                          }`}
                        >
                          <input
                            type="radio"
                            name="reset-target-backend"
                            checked={targetBackend === b}
                            onChange={() => {
                              setTargetBackend(b);
                              setTargetKey("");
                            }}
                            data-testid={`reset-backend-radio-${b}`}
                            className="accent-gold-500"
                          />
                          {BACKEND_LABELS[b]}
                        </label>
                      ))}
                    </div>
                    {targetBackend !== "age" && (
                      <div className="mt-3">
                        <Field label="Key Identifier">
                          <Input
                            type="text"
                            value={targetKey}
                            onChange={(e) => setTargetKey(e.target.value)}
                            placeholder={KEY_PLACEHOLDERS[targetBackend]}
                            data-testid="reset-backend-key-input"
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Optional explicit keys */}
              <div className="mb-5">
                <Label>Explicit Keys (optional)</Label>
                <Input
                  type="text"
                  value={explicitKeys}
                  onChange={(e) => setExplicitKeys(e.target.value)}
                  placeholder="DB_URL, DB_PASSWORD"
                  data-testid="reset-keys-input"
                />
                <div className="font-sans text-[11px] text-ash mt-1.5">
                  Comma-separated. Ignored when the namespace has a schema — schema keys are
                  authoritative.
                </div>
              </div>

              <div className="bg-stop-500/10 border border-stop-500/40 rounded-lg px-4 py-3.5 mb-4 font-sans text-[13px] text-stop-500 leading-relaxed">
                {"⚠"} This will <strong>ABANDON</strong> the current encrypted contents of the
                affected cells. Decryption will <strong>NOT</strong> be attempted. This cannot be
                undone except via <code>git revert</code>.
              </div>

              <div className="mb-5">
                <Label>
                  Type <code className="text-bone">{scopeLabel || "<scope>"}</code> to confirm
                </Label>
                <Input
                  type="text"
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value)}
                  placeholder={scopeLabel}
                  data-testid="reset-confirm-input"
                  disabled={!scope}
                />
              </div>

              <Button
                variant="danger"
                onClick={handleReset}
                disabled={!canSubmit}
                data-testid="reset-submit"
              >
                Reset {scopeLabel || "<scope>"}
              </Button>
            </div>
          )}

          {phase === "running" && (
            <div className="flex flex-col items-center pt-10" data-testid="reset-running">
              <div className="w-10 h-10 border-[3px] border-edge border-t-gold-500 rounded-full mb-4 animate-spin" />
              <div className="font-sans text-[14px] text-ash">Resetting {scopeLabel}...</div>
            </div>
          )}

          {phase === "done" && result && (
            <div data-testid="reset-done">
              <div className="flex flex-col items-center pt-5 pb-6">
                <div className="w-14 h-14 rounded-full bg-go-500/15 border border-go-500/40 flex items-center justify-center text-[24px] text-go-500 mb-4">
                  {"✓"}
                </div>
                <div className="font-sans font-semibold text-[16px] text-go-500 mb-2">
                  Reset complete
                </div>
                <div className="font-mono text-[12px] text-ash">
                  {result.scaffoldedCells.length} cell
                  {result.scaffoldedCells.length === 1 ? "" : "s"} scaffolded
                  {pendingCount > 0
                    ? `, ${pendingCount} pending placeholder${pendingCount === 1 ? "" : "s"}`
                    : ""}
                </div>
              </div>

              {result.backendChanged && (
                <div className="bg-ink-850 border border-edge rounded-md px-3.5 py-2.5 mb-4 font-mono text-[11px] text-ash">
                  Backend override written for: {result.affectedEnvironments.join(", ")}
                </div>
              )}

              {pendingCount > 0 && (
                <div className="font-sans text-[12px] text-ash mb-4 leading-relaxed">
                  Run <code>clef set</code> (or use the namespace editor) to replace placeholders
                  with real values.
                </div>
              )}

              <div className="flex gap-2.5">
                <Button
                  variant="primary"
                  onClick={() => setView("matrix")}
                  data-testid="reset-view-matrix"
                >
                  View in Matrix
                </Button>
                <Button variant="ghost" onClick={handleStartOver} data-testid="reset-start-over">
                  Reset another
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
    <div className="font-sans text-[12px] font-semibold text-ash mb-2 uppercase tracking-[0.05em]">
      {children}
    </div>
  );
}
