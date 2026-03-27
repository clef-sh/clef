import React, { useState, useEffect, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { EnvBadge } from "../components/EnvBadge";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import type { ClefManifest } from "@clef-sh/core";

interface EnvInfo {
  type: string;
  publicKey?: string;
  kms?: { provider: string; keyId: string };
  protected?: boolean;
}

interface IdentityInfo {
  name: string;
  description: string;
  namespaces: string[];
  environments: Record<string, EnvInfo>;
}

interface EnvBackendConfig {
  type: "age" | "kms";
  provider: string;
  keyId: string;
}

interface UpdateEnvState extends EnvBackendConfig {
  originalType: "age" | "kms";
  originalKeyId: string;
}

interface ServiceIdentitiesScreenProps {
  manifest: ClefManifest | null;
}

type View = "list" | "detail" | "create" | "keys" | "update" | "rotate-keys" | "delete-confirm";

export function ServiceIdentitiesScreen({ manifest }: ServiceIdentitiesScreenProps) {
  const [view, setView] = useState<View>("list");
  const [identities, setIdentities] = useState<IdentityInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set());
  const [envBackends, setEnvBackends] = useState<Record<string, EnvBackendConfig>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Post-create / post-rotate keys
  const [privateKeys, setPrivateKeys] = useState<Record<string, string>>({});
  const [createdName, setCreatedName] = useState("");

  // Update form state
  const [updateEnvBackends, setUpdateEnvBackends] = useState<Record<string, UpdateEnvState>>({});
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");

  // Rotate state
  const [rotatingEnv, setRotatingEnv] = useState<string | undefined>(undefined);
  const [rotatedKeys, setRotatedKeys] = useState<Record<string, string>>({});

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/service-identities");
      if (res.ok) {
        const data = await res.json();
        setIdentities(data.identities);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedIdentity = identities.find((i) => i.name === selected);

  const openCreate = useCallback(() => {
    setName("");
    setDescription("");
    setSelectedNamespaces(new Set());
    const defaults: Record<string, EnvBackendConfig> = {};
    for (const env of manifest?.environments ?? []) {
      defaults[env.name] = { type: "age", provider: "aws", keyId: "" };
    }
    setEnvBackends(defaults);
    setCreateError("");
    setView("create");
  }, [manifest]);

  const openUpdate = useCallback((identity: IdentityInfo) => {
    const defaults: Record<string, UpdateEnvState> = {};
    for (const [envName, envInfo] of Object.entries(identity.environments)) {
      const t: "age" | "kms" = envInfo.type === "kms" ? "kms" : "age";
      defaults[envName] = {
        type: t,
        provider: envInfo.kms?.provider ?? "aws",
        keyId: envInfo.kms?.keyId ?? "",
        originalType: t,
        originalKeyId: envInfo.kms?.keyId ?? "",
      };
    }
    setUpdateEnvBackends(defaults);
    setUpdateError("");
    setView("update");
  }, []);

  const goList = useCallback(() => {
    setSelected(null);
    setError("");
    setView("list");
  }, []);

  const goDetail = useCallback(() => {
    setError("");
    setDeleteError("");
    setView("detail");
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    setCreating(true);
    setCreateError("");
    try {
      const kmsEnvConfigs: Record<string, { provider: string; keyId: string }> = {};
      for (const [envName, cfg] of Object.entries(envBackends)) {
        if (cfg.type === "kms") {
          kmsEnvConfigs[envName] = { provider: cfg.provider, keyId: cfg.keyId };
        }
      }
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        namespaces: Array.from(selectedNamespaces),
      };
      if (Object.keys(kmsEnvConfigs).length > 0) {
        body.kmsEnvConfigs = kmsEnvConfigs;
      }
      const res = await apiFetch("/api/service-identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create service identity.");
        return;
      }
      setCreatedName(data.identity.name);
      setPrivateKeys(data.privateKeys ?? {});
      setView("keys");
    } catch {
      setCreateError("Network error. Check that the UI server is running.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate() {
    if (!selected) return;
    setUpdating(true);
    setUpdateError("");
    try {
      const kmsEnvConfigs: Record<string, { provider: string; keyId: string }> = {};
      for (const [envName, state] of Object.entries(updateEnvBackends)) {
        if (state.type === "kms") {
          if (state.originalType !== "kms" || state.keyId !== state.originalKeyId) {
            kmsEnvConfigs[envName] = { provider: state.provider, keyId: state.keyId };
          }
        }
      }
      if (Object.keys(kmsEnvConfigs).length === 0) {
        setUpdateError("No changes to apply.");
        return;
      }
      const res = await apiFetch(`/api/service-identities/${encodeURIComponent(selected)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kmsEnvConfigs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUpdateError(data.error ?? "Failed to update service identity.");
        return;
      }
      await load();
      goDetail();
    } catch {
      setUpdateError("Network error. Check that the UI server is running.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleRotate(envName: string) {
    if (!selected) return;
    setRotatingEnv(envName);
    setError("");
    try {
      const res = await apiFetch(`/api/service-identities/${encodeURIComponent(selected)}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: envName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to rotate key.");
        return;
      }
      setRotatedKeys(data.privateKeys ?? {});
      await load();
      setView("rotate-keys");
    } catch {
      setError("Network error. Check that the UI server is running.");
    } finally {
      setRotatingEnv(undefined);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`/api/service-identities/${encodeURIComponent(selected)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error ?? "Failed to delete service identity.");
        return;
      }
      await load();
      goList();
    } catch {
      setDeleteError("Network error. Check that the UI server is running.");
    } finally {
      setDeleting(false);
    }
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar
          title="Service Identities"
          subtitle="Per-service cryptographic access scoping"
          actions={
            manifest && (
              <Button variant="primary" onClick={openCreate}>
                + New identity
              </Button>
            )
          }
        />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {identities.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  color: theme.textMuted,
                  fontFamily: theme.sans,
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>{"\uD83D\uDD11"}</div>
                No service identities configured.
                {manifest && (
                  <div style={{ marginTop: 16 }}>
                    <Button variant="primary" onClick={openCreate}>
                      Create the first one
                    </Button>
                  </div>
                )}
              </div>
            )}

            {identities.map((si) => (
              <div
                key={si.name}
                role="button"
                tabIndex={0}
                data-testid={`si-${si.name}`}
                onClick={() => {
                  setSelected(si.name);
                  setError("");
                  setView("detail");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSelected(si.name);
                    setView("detail");
                  }
                }}
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "16px 20px",
                  marginBottom: 8,
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = theme.borderLight;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = theme.border;
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span
                    style={{
                      fontFamily: theme.sans,
                      fontWeight: 600,
                      fontSize: 14,
                      color: theme.text,
                    }}
                  >
                    {si.name}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 12,
                    color: theme.textMuted,
                    marginBottom: 10,
                  }}
                >
                  Scoped to: <span style={{ color: theme.text }}>{si.namespaces.join(", ")}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(si.environments).map(([envName, envInfo]) => (
                    <span
                      key={envName}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <EnvBadge env={envName} small />
                      <span
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 9,
                          color: envInfo.type === "kms" ? theme.purple : theme.textDim,
                        }}
                      >
                        {envInfo.type === "kms" ? "KMS" : "age"}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────────────────────
  if (view === "detail") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar
          title={selectedIdentity?.name ?? selected ?? ""}
          subtitle={selectedIdentity?.description}
          actions={
            <div style={{ display: "flex", gap: 6 }}>
              {selectedIdentity && (
                <Button
                  data-testid="update-backends-btn"
                  variant="ghost"
                  onClick={() => openUpdate(selectedIdentity)}
                >
                  Update backends
                </Button>
              )}
              <button
                data-testid="back-button"
                onClick={goList}
                style={{
                  background: "none",
                  border: `1px solid ${theme.borderLight}`,
                  borderRadius: 6,
                  padding: "4px 12px",
                  cursor: "pointer",
                  fontFamily: theme.sans,
                  fontSize: 12,
                  color: theme.textMuted,
                  transition: "all 0.12s",
                }}
              >
                {"\u2190"} Back
              </button>
            </div>
          }
        />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {selectedIdentity && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <Label>Scoped namespaces</Label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {selectedIdentity.namespaces.map((ns) => (
                      <span
                        key={ns}
                        style={{
                          fontFamily: theme.mono,
                          fontSize: 11,
                          color: theme.accent,
                          background: theme.accentDim,
                          border: `1px solid ${theme.accent}33`,
                          borderRadius: 4,
                          padding: "2px 8px",
                        }}
                      >
                        {ns}
                      </span>
                    ))}
                  </div>
                </div>

                <Label>Environment keys</Label>

                {manifest?.environments.map((env) => {
                  const envInfo = selectedIdentity.environments[env.name];
                  if (!envInfo) return null;
                  const isProtected = envInfo.protected ?? false;
                  const isRotating = rotatingEnv === env.name;

                  return (
                    <div
                      key={env.name}
                      data-testid={`env-${env.name}`}
                      style={{
                        background: theme.surface,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 8,
                        padding: "16px 20px",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <EnvBadge env={env.name} />
                          {isProtected && (
                            <span style={{ fontSize: 12, color: theme.red }}>{"\uD83D\uDD12"}</span>
                          )}
                          {envInfo.type === "kms" && (
                            <span
                              style={{
                                fontFamily: theme.mono,
                                fontSize: 10,
                                color: theme.purple,
                                background: theme.purpleDim,
                                border: `1px solid ${theme.purple}33`,
                                borderRadius: 3,
                                padding: "1px 6px",
                              }}
                            >
                              KMS
                            </span>
                          )}
                        </div>
                        {envInfo.type === "age" && (
                          <button
                            data-testid={`rotate-${env.name}`}
                            disabled={isRotating}
                            onClick={() => handleRotate(env.name)}
                            style={{
                              background: "none",
                              border: `1px solid ${theme.borderLight}`,
                              borderRadius: 5,
                              padding: "3px 10px",
                              cursor: isRotating ? "default" : "pointer",
                              fontFamily: theme.sans,
                              fontSize: 11,
                              color: isRotating ? theme.textDim : theme.textMuted,
                              opacity: isRotating ? 0.5 : 1,
                            }}
                          >
                            {isRotating ? "Rotating…" : "Rotate key"}
                          </button>
                        )}
                      </div>

                      {envInfo.type === "kms" && envInfo.kms && (
                        <div
                          style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textMuted }}
                        >
                          <div style={{ marginBottom: 8 }}>
                            Authentication: <span style={{ color: theme.purple }}>IAM + KMS</span>
                          </div>
                          <div>
                            Provider:{" "}
                            <span style={{ color: theme.text }}>{envInfo.kms.provider}</span>
                          </div>
                          <div style={{ marginTop: 4 }}>
                            Key ID:{" "}
                            <span style={{ color: theme.text, wordBreak: "break-all" }}>
                              {envInfo.kms.keyId}
                            </span>
                          </div>
                          <div
                            style={{
                              marginTop: 10,
                              padding: "8px 12px",
                              background: theme.purpleDim,
                              border: `1px solid ${theme.purple}33`,
                              borderRadius: 4,
                              fontSize: 11,
                              color: theme.purple,
                              fontFamily: theme.sans,
                            }}
                          >
                            No keys to provision. CI and runtime authenticate via IAM role with
                            kms:Decrypt permission.
                          </div>
                        </div>
                      )}

                      {envInfo.type === "age" && (
                        <div
                          style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textMuted }}
                        >
                          <div style={{ marginBottom: 8 }}>
                            Authentication: <span style={{ color: theme.green }}>age key</span>
                          </div>
                          <div>
                            Public key:{" "}
                            <span style={{ color: theme.text }}>
                              {envInfo.publicKey
                                ? `${envInfo.publicKey.slice(0, 12)}...${envInfo.publicKey.slice(-6)}`
                                : "unknown"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div
                  style={{
                    marginTop: 32,
                    paddingTop: 20,
                    borderTop: `1px solid ${theme.border}`,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <Button
                    data-testid="delete-identity-btn"
                    variant="danger"
                    onClick={() => {
                      setDeleteError("");
                      setView("delete-confirm");
                    }}
                  >
                    Delete identity
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Delete confirm view ───────────────────────────────────────────────────────
  if (view === "delete-confirm") {
    return (
      <div
        data-testid="delete-confirm-view"
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <TopBar title="Delete service identity" subtitle="This action cannot be undone" />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            {deleteError && <ErrorBanner>{deleteError}</ErrorBanner>}

            <div
              style={{
                background: "#1a0a0a",
                border: `1px solid ${theme.red}55`,
                borderRadius: 8,
                padding: "16px 20px",
                marginBottom: 24,
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.red,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Delete <span style={{ fontFamily: theme.mono }}>{selected}</span>?
              </div>
              <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.6 }}>
                This will remove the identity from{" "}
                <span style={{ fontFamily: theme.mono }}>clef.yaml</span> and de-register its
                recipients from all scoped encrypted files. Any runtimes currently using this
                identity's private key will lose access on the next artifact refresh.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button
                data-testid="cancel-delete-btn"
                variant="ghost"
                onClick={goDetail}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                data-testid="confirm-delete-btn"
                variant="danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete identity"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Rotate keys result view ───────────────────────────────────────────────────
  if (view === "rotate-keys") {
    return (
      <div
        data-testid="rotate-keys-view"
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <TopBar title="Key rotated" subtitle={`New keys for ${selected}`} />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <div
              style={{
                background: "#1a1200",
                border: `1px solid ${theme.yellow}55`,
                borderRadius: 8,
                padding: "14px 18px",
                marginBottom: 20,
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.yellow,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
              <span>
                Copy the new private key now — it will not be shown again. Provision it to the
                runtime and invalidate the old key.
              </span>
            </div>

            <Label>New private keys</Label>
            {Object.entries(rotatedKeys).map(([envName, key]) => (
              <div
                key={envName}
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "14px 18px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <EnvBadge env={envName} />
                  <CopyButton text={key} />
                </div>
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                    wordBreak: "break-all",
                    background: theme.bg,
                    borderRadius: 4,
                    padding: "8px 10px",
                  }}
                >
                  {key}
                </div>
              </div>
            ))}

            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <Button data-testid="rotate-done-btn" variant="primary" onClick={goDetail}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Update backends view ──────────────────────────────────────────────────────
  if (view === "update") {
    const environments = manifest?.environments ?? [];

    const changedCount = Object.values(updateEnvBackends).filter((state) => {
      if (state.type !== "kms") return false;
      return state.originalType !== "kms" || state.keyId !== state.originalKeyId;
    }).length;

    const canUpdate =
      changedCount > 0 &&
      Object.entries(updateEnvBackends).every(([, state]) => {
        if (state.type !== "kms") return true;
        return state.keyId.trim() !== "";
      });

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar
          title="Update backends"
          subtitle={`Environment backends for ${selected}`}
          actions={
            <button
              onClick={goDetail}
              style={{
                background: "none",
                border: `1px solid ${theme.borderLight}`,
                borderRadius: 6,
                padding: "4px 12px",
                cursor: "pointer",
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              {"\u2190"} Cancel
            </button>
          }
        />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            {updateError && <ErrorBanner>{updateError}</ErrorBanner>}

            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Switch age environments to KMS, or update an existing KMS key ID. To revert KMS to
              age, delete and recreate the identity.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
              {environments.map((env) => {
                const state = updateEnvBackends[env.name];
                if (!state) return null;

                return (
                  <div
                    key={env.name}
                    style={{
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: "14px 16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: state.type === "kms" ? 12 : 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <EnvBadge env={env.name} />
                        {env.protected && (
                          <span style={{ fontSize: 11, color: theme.red }}>{"\uD83D\uDD12"}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(["age", "kms"] as const).map((t) => {
                          const locked = state.originalType === "kms" && t === "age";
                          return (
                            <button
                              key={t}
                              data-testid={
                                t === "kms" ? `update-kms-toggle-${env.name}` : undefined
                              }
                              disabled={locked}
                              onClick={() => {
                                if (locked) return;
                                setUpdateEnvBackends((prev) => ({
                                  ...prev,
                                  [env.name]: { ...state, type: t },
                                }));
                              }}
                              title={locked ? "KMS → age requires delete and recreate" : undefined}
                              style={{
                                background:
                                  state.type === t
                                    ? t === "kms"
                                      ? theme.purple
                                      : theme.accent
                                    : "transparent",
                                border: `1px solid ${
                                  state.type === t
                                    ? t === "kms"
                                      ? theme.purple
                                      : theme.accent
                                    : theme.border
                                }`,
                                borderRadius: 4,
                                padding: "3px 10px",
                                cursor: locked ? "not-allowed" : "pointer",
                                fontFamily: theme.mono,
                                fontSize: 11,
                                color: state.type === t ? "#fff" : theme.textMuted,
                                opacity: locked ? 0.4 : 1,
                                transition: "all 0.1s",
                              }}
                            >
                              {t.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {state.type === "kms" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <select
                          value={state.provider}
                          onChange={(e) =>
                            setUpdateEnvBackends((prev) => ({
                              ...prev,
                              [env.name]: { ...state, provider: e.target.value },
                            }))
                          }
                          style={{
                            ...inputStyle,
                            width: 90,
                            flexShrink: 0,
                            padding: "7px 8px",
                          }}
                        >
                          <option value="aws">AWS</option>
                          <option value="gcp">GCP</option>
                          <option value="azure">Azure</option>
                        </select>
                        <input
                          data-testid={`update-keyid-${env.name}`}
                          value={state.keyId}
                          onChange={(e) =>
                            setUpdateEnvBackends((prev) => ({
                              ...prev,
                              [env.name]: { ...state, keyId: e.target.value },
                            }))
                          }
                          placeholder="arn:aws:kms:… or key resource ID"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={goDetail} disabled={updating}>
                Cancel
              </Button>
              <Button
                data-testid="update-submit-btn"
                variant="primary"
                onClick={handleUpdate}
                disabled={!canUpdate || updating}
              >
                {updating ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Keys result view (post-creation) ─────────────────────────────────────────
  if (view === "keys") {
    const hasAgeKeys = Object.keys(privateKeys).length > 0;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar title={`${createdName} created`} subtitle="Service identity ready" />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            {hasAgeKeys && (
              <div
                style={{
                  background: "#1a1200",
                  border: `1px solid ${theme.yellow}55`,
                  borderRadius: 8,
                  padding: "14px 18px",
                  marginBottom: 20,
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.yellow,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
                <span>
                  Copy these private keys now — they will not be shown again. Store each key
                  securely and provision it to the relevant runtime.
                </span>
              </div>
            )}

            {!hasAgeKeys && (
              <div
                style={{
                  background: theme.purpleDim,
                  border: `1px solid ${theme.purple}44`,
                  borderRadius: 8,
                  padding: "14px 18px",
                  marginBottom: 20,
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.purple,
                }}
              >
                All environments use KMS. No private keys to provision — runtimes authenticate via
                IAM role.
              </div>
            )}

            <Label>Private keys</Label>
            {Object.entries(privateKeys).map(([envName, key]) => (
              <div
                key={envName}
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "14px 18px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <EnvBadge env={envName} />
                  <CopyButton text={key} />
                </div>
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                    wordBreak: "break-all",
                    background: theme.bg,
                    borderRadius: 4,
                    padding: "8px 10px",
                  }}
                >
                  {key}
                </div>
              </div>
            ))}

            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="primary"
                onClick={() => {
                  load();
                  goList();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Create form ───────────────────────────────────────────────────────────────
  const namespaces = manifest?.namespaces ?? [];
  const environments = manifest?.environments ?? [];

  const nameError =
    name.trim() && identities.some((i) => i.name === name.trim())
      ? "A service identity with this name already exists."
      : "";
  const canSubmit =
    name.trim() !== "" &&
    !nameError &&
    selectedNamespaces.size > 0 &&
    environments.every((env) => {
      const cfg = envBackends[env.name];
      return cfg?.type === "age" || (cfg?.type === "kms" && cfg.provider && cfg.keyId.trim());
    });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="New service identity"
        subtitle="Scope cryptographic access to specific namespaces"
        actions={
          <button
            onClick={goList}
            style={{
              background: "none",
              border: `1px solid ${theme.borderLight}`,
              borderRadius: 6,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            {"\u2190"} Cancel
          </button>
        }
      />
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          {createError && <ErrorBanner>{createError}</ErrorBanner>}

          {/* Name */}
          <div style={{ marginBottom: 20 }}>
            <FieldLabel>Name</FieldLabel>
            <input
              data-testid="si-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. api-gateway"
              style={inputStyle}
            />
            {nameError && (
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 12,
                  color: theme.red,
                  marginTop: 6,
                }}
              >
                {nameError}
              </div>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom: 24 }}>
            <FieldLabel>Description (optional)</FieldLabel>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. API gateway service account"
              style={inputStyle}
            />
          </div>

          {/* Namespaces */}
          <div style={{ marginBottom: 24 }}>
            <FieldLabel>Namespaces</FieldLabel>
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 10,
              }}
            >
              This identity can decrypt secrets only from the selected namespaces.
            </div>
            {namespaces.length === 0 && (
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.textDim }}>
                No namespaces defined in manifest.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {namespaces.map((ns) => {
                const checked = selectedNamespaces.has(ns.name);
                return (
                  <label
                    key={ns.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      background: checked ? theme.accentDim : theme.surface,
                      border: `1px solid ${checked ? theme.accent + "55" : theme.border}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "all 0.1s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selectedNamespaces);
                        if (e.target.checked) next.add(ns.name);
                        else next.delete(ns.name);
                        setSelectedNamespaces(next);
                      }}
                      style={{ accentColor: theme.accent }}
                    />
                    <span
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 12,
                        color: checked ? theme.accent : theme.text,
                      }}
                    >
                      {ns.name}
                    </span>
                    {ns.description && (
                      <span
                        style={{ fontFamily: theme.sans, fontSize: 11, color: theme.textMuted }}
                      >
                        — {ns.description}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Per-environment backend */}
          <div style={{ marginBottom: 28 }}>
            <FieldLabel>Environment backends</FieldLabel>
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 10,
              }}
            >
              Age generates a key pair per environment. KMS uses your cloud provider — no key
              material is provisioned.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {environments.map((env) => {
                const cfg = envBackends[env.name] ?? { type: "age", provider: "aws", keyId: "" };
                return (
                  <div
                    key={env.name}
                    style={{
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: "14px 16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: cfg.type === "kms" ? 12 : 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <EnvBadge env={env.name} />
                        {env.protected && (
                          <span style={{ fontSize: 11, color: theme.red }}>{"\uD83D\uDD12"}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(["age", "kms"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() =>
                              setEnvBackends((prev) => ({
                                ...prev,
                                [env.name]: { ...cfg, type: t },
                              }))
                            }
                            style={{
                              background:
                                cfg.type === t
                                  ? t === "kms"
                                    ? theme.purple
                                    : theme.accent
                                  : "transparent",
                              border: `1px solid ${
                                cfg.type === t
                                  ? t === "kms"
                                    ? theme.purple
                                    : theme.accent
                                  : theme.border
                              }`,
                              borderRadius: 4,
                              padding: "3px 10px",
                              cursor: "pointer",
                              fontFamily: theme.mono,
                              fontSize: 11,
                              color: cfg.type === t ? "#fff" : theme.textMuted,
                              transition: "all 0.1s",
                            }}
                          >
                            {t.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {cfg.type === "kms" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <select
                          value={cfg.provider}
                          onChange={(e) =>
                            setEnvBackends((prev) => ({
                              ...prev,
                              [env.name]: { ...cfg, provider: e.target.value },
                            }))
                          }
                          style={{
                            ...inputStyle,
                            width: 90,
                            flexShrink: 0,
                            padding: "7px 8px",
                          }}
                        >
                          <option value="aws">AWS</option>
                          <option value="gcp">GCP</option>
                          <option value="azure">Azure</option>
                        </select>
                        <input
                          value={cfg.keyId}
                          onChange={(e) =>
                            setEnvBackends((prev) => ({
                              ...prev,
                              [env.name]: { ...cfg, keyId: e.target.value },
                            }))
                          }
                          placeholder="arn:aws:kms:… or key resource ID"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={goList} disabled={creating}>
              Cancel
            </Button>
            <Button
              data-testid="create-si-submit"
              variant="primary"
              onClick={handleCreate}
              disabled={!canSubmit || creating}
            >
              {creating ? "Creating…" : "Create identity"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: 6,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
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
