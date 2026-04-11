import React, { useState } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Reset" subtitle="clef reset — destructively scaffold fresh placeholders" />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          {error && (
            <div
              data-testid="reset-error"
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

          {phase === "idle" && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <Label>Scope</Label>
                <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                  {(["env", "namespace", "cell"] as const).map((k) => (
                    <label
                      key={k}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        fontFamily: theme.sans,
                        fontSize: 13,
                        color: scopeKind === k ? theme.text : theme.textMuted,
                      }}
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
                        style={{ accentColor: theme.accent }}
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
                    style={selectStyle}
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
                    style={selectStyle}
                  >
                    {namespaces.map((ns) => (
                      <option key={ns.name} value={ns.name}>
                        {ns.name}
                      </option>
                    ))}
                  </select>
                )}

                {scopeKind === "cell" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={cellNs}
                      onChange={(e) => {
                        setCellNs(e.target.value);
                        setTypedConfirm("");
                      }}
                      data-testid="reset-cell-namespace-select"
                      style={{ ...selectStyle, flex: 1 }}
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
                      style={{ ...selectStyle, flex: 1 }}
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

              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontFamily: theme.sans,
                    fontSize: 13,
                    color: theme.text,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={switchBackend}
                    onChange={(e) => setSwitchBackend(e.target.checked)}
                    data-testid="reset-switch-backend"
                    style={{ accentColor: theme.accent }}
                  />
                  Switch backend as part of reset
                </label>
                {switchBackend && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 14,
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                    }}
                  >
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
                            name="reset-target-backend"
                            checked={targetBackend === b}
                            onChange={() => {
                              setTargetBackend(b);
                              setTargetKey("");
                            }}
                            data-testid={`reset-backend-radio-${b}`}
                            style={{ accentColor: theme.accent }}
                          />
                          {BACKEND_LABELS[b]}
                        </label>
                      ))}
                    </div>
                    {targetBackend !== "age" && (
                      <div style={{ marginTop: 12 }}>
                        <Label>Key Identifier</Label>
                        <input
                          type="text"
                          value={targetKey}
                          onChange={(e) => setTargetKey(e.target.value)}
                          placeholder={KEY_PLACEHOLDERS[targetBackend]}
                          data-testid="reset-backend-key-input"
                          style={textInputStyle}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Optional explicit keys */}
              <div style={{ marginBottom: 20 }}>
                <Label>Explicit Keys (optional)</Label>
                <input
                  type="text"
                  value={explicitKeys}
                  onChange={(e) => setExplicitKeys(e.target.value)}
                  placeholder="DB_URL, DB_PASSWORD"
                  data-testid="reset-keys-input"
                  style={textInputStyle}
                />
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 11,
                    color: theme.textMuted,
                    marginTop: 6,
                  }}
                >
                  Comma-separated. Ignored when the namespace has a schema — schema keys are
                  authoritative.
                </div>
              </div>

              <div
                style={{
                  background: theme.redDim,
                  border: `1px solid ${theme.red}44`,
                  borderRadius: 8,
                  padding: "14px 16px",
                  marginBottom: 16,
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.red,
                  lineHeight: 1.5,
                }}
              >
                {"\u26A0"} This will <strong>ABANDON</strong> the current encrypted contents of the
                affected cells. Decryption will <strong>NOT</strong> be attempted. This cannot be
                undone except via <code>git revert</code>.
              </div>

              <div style={{ marginBottom: 20 }}>
                <Label>
                  Type <code style={{ color: theme.text }}>{scopeLabel || "<scope>"}</code> to
                  confirm
                </Label>
                <input
                  type="text"
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value)}
                  placeholder={scopeLabel}
                  data-testid="reset-confirm-input"
                  disabled={!scope}
                  style={textInputStyle}
                />
              </div>

              <Button
                variant="primary"
                onClick={handleReset}
                disabled={!canSubmit}
                data-testid="reset-submit"
              >
                Reset {scopeLabel || "<scope>"}
              </Button>
            </div>
          )}

          {phase === "running" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 40,
              }}
              data-testid="reset-running"
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
                Resetting {scopeLabel}...
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {phase === "done" && result && (
            <div data-testid="reset-done">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 20,
                  paddingBottom: 24,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: theme.greenDim,
                    border: `1px solid ${theme.green}44`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: theme.green,
                    marginBottom: 16,
                  }}
                >
                  {"\u2713"}
                </div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontWeight: 600,
                    fontSize: 16,
                    color: theme.green,
                    marginBottom: 8,
                  }}
                >
                  Reset complete
                </div>
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 12,
                    color: theme.textMuted,
                  }}
                >
                  {result.scaffoldedCells.length} cell
                  {result.scaffoldedCells.length === 1 ? "" : "s"} scaffolded
                  {pendingCount > 0
                    ? `, ${pendingCount} pending placeholder${pendingCount === 1 ? "" : "s"}`
                    : ""}
                </div>
              </div>

              {result.backendChanged && (
                <div
                  style={{
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                    padding: "10px 14px",
                    marginBottom: 16,
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                  }}
                >
                  Backend override written for: {result.affectedEnvironments.join(", ")}
                </div>
              )}

              {pendingCount > 0 && (
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 12,
                    color: theme.textMuted,
                    marginBottom: 16,
                    lineHeight: 1.5,
                  }}
                >
                  Run <code>clef set</code> (or use the namespace editor) to replace placeholders
                  with real values.
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
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

const selectStyle: React.CSSProperties = {
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
};

const textInputStyle: React.CSSProperties = {
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
};
