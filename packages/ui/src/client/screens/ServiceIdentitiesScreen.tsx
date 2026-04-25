import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { EnvBadge } from "../components/EnvBadge";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import { Toolbar } from "../primitives";
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
  packOnly?: boolean;
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

const INPUT_BASE =
  "w-full box-border rounded-md border border-edge bg-ink-850 px-3 py-2 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim";

const SMALL_INPUT_BASE =
  "rounded-md border border-edge bg-ink-850 px-2 py-1.5 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500";

const BACK_BUTTON =
  "cursor-pointer rounded-md border border-edge-strong bg-transparent px-3 py-1 font-sans text-[12px] text-ash hover:bg-ink-800";

export function ServiceIdentitiesScreen({ manifest }: ServiceIdentitiesScreenProps) {
  const [view, setView] = useState<View>("list");
  const [identities, setIdentities] = useState<IdentityInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set());
  const [envBackends, setEnvBackends] = useState<Record<string, EnvBackendConfig>>({});
  const [role, setRole] = useState<"ci" | "runtime">("ci");
  const [sharedRecipient, setSharedRecipient] = useState(true);
  const [sharedRecipientOverridden, setSharedRecipientOverridden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [privateKeys, setPrivateKeys] = useState<Record<string, string>>({});
  const [createdName, setCreatedName] = useState("");
  const [wasSharedRecipient, setWasSharedRecipient] = useState(false);

  const [updateEnvBackends, setUpdateEnvBackends] = useState<Record<string, UpdateEnvState>>({});
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");

  const [rotatingEnv, setRotatingEnv] = useState<string | undefined>(undefined);
  const [rotatedKeys, setRotatedKeys] = useState<Record<string, string>>({});

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
    setRole("ci");
    setSharedRecipient(true);
    setSharedRecipientOverridden(false);
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
      if (role === "runtime") body.packOnly = true;
      if (sharedRecipient) {
        body.sharedRecipient = true;
      } else if (Object.keys(kmsEnvConfigs).length > 0) {
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
      setWasSharedRecipient(data.sharedRecipient === true);
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>Service Identities</Toolbar.Title>
            <Toolbar.Subtitle>Per-service cryptographic access scoping</Toolbar.Subtitle>
          </div>
          {manifest && (
            <Toolbar.Actions>
              <Button variant="primary" onClick={openCreate}>
                + New identity
              </Button>
            </Toolbar.Actions>
          )}
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[620px]">
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {identities.length === 0 && (
              <div className="px-6 py-12 text-center font-sans text-[13px] text-ash">
                <div className="mb-3 text-[28px] opacity-40">{"🔑"}</div>
                No service identities configured.
                {manifest && (
                  <div className="mt-4 flex justify-center">
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
                className="mb-2 cursor-pointer rounded-lg border border-edge bg-ink-850 px-5 py-4 transition-colors hover:border-edge-strong"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="font-sans text-[14px] font-semibold text-bone">{si.name}</span>
                  {si.packOnly && (
                    <span
                      data-testid={`si-runtime-badge-${si.name}`}
                      className="rounded-sm border border-warn-500/20 bg-warn-500/10 px-1.5 py-px font-mono text-[9px] text-warn-500"
                    >
                      runtime
                    </span>
                  )}
                </div>
                <div className="mb-2.5 font-sans text-[12px] text-ash">
                  Scoped to: <span className="text-bone">{si.namespaces.join(", ")}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(si.environments).map(([envName, envInfo]) => (
                    <span key={envName} className="inline-flex items-center gap-1">
                      <EnvBadge env={envName} small />
                      <span
                        className={`font-mono text-[9px] ${envInfo.type === "kms" ? "text-purple-400" : "text-ash-dim"}`}
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>{selectedIdentity?.name ?? selected ?? ""}</Toolbar.Title>
            {selectedIdentity?.description && (
              <Toolbar.Subtitle>{selectedIdentity.description}</Toolbar.Subtitle>
            )}
          </div>
          <Toolbar.Actions>
            {selectedIdentity && (
              <Button
                data-testid="update-backends-btn"
                variant="ghost"
                onClick={() => openUpdate(selectedIdentity)}
              >
                Update backends
              </Button>
            )}
            <button data-testid="back-button" onClick={goList} className={BACK_BUTTON}>
              {"←"} Back
            </button>
          </Toolbar.Actions>
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[620px]">
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {selectedIdentity && (
              <>
                <div className="mb-5">
                  <Label>Scoped namespaces</Label>
                  <div className="flex gap-1.5">
                    {selectedIdentity.namespaces.map((ns) => (
                      <span
                        key={ns}
                        className="rounded border border-gold-500/20 bg-gold-500/[0.08] px-2 py-0.5 font-mono text-[11px] text-gold-500"
                      >
                        {ns}
                      </span>
                    ))}
                  </div>
                </div>

                {selectedIdentity.packOnly && (
                  <div
                    data-testid="runtime-info-banner"
                    className="mb-5 rounded-lg border border-warn-500/20 bg-warn-500/10 px-4 py-2.5 font-sans text-[12px] leading-relaxed text-warn-500"
                  >
                    Runtime identity — keys are not registered on encrypted files. This identity can
                    only decrypt packed artifacts.
                  </div>
                )}

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
                      className="mb-2.5 rounded-lg border border-edge bg-ink-850 px-5 py-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <EnvBadge env={env.name} />
                          {isProtected && <span className="text-[12px] text-stop-500">{"🔒"}</span>}
                          {envInfo.type === "kms" && (
                            <span className="rounded-sm border border-purple-400/20 bg-purple-400/10 px-1.5 py-px font-mono text-[10px] text-purple-400">
                              KMS
                            </span>
                          )}
                        </div>
                        {envInfo.type === "age" && (
                          <button
                            data-testid={`rotate-${env.name}`}
                            disabled={isRotating}
                            onClick={() => handleRotate(env.name)}
                            className={`rounded border border-edge-strong px-2.5 py-0.5 font-sans text-[11px] ${isRotating ? "cursor-default text-ash-dim opacity-50" : "cursor-pointer text-ash hover:bg-ink-800"}`}
                          >
                            {isRotating ? "Rotating…" : "Rotate key"}
                          </button>
                        )}
                      </div>

                      {envInfo.type === "kms" && envInfo.kms && (
                        <div className="font-mono text-[11px] text-ash">
                          <div className="mb-2">
                            Authentication: <span className="text-purple-400">IAM + KMS</span>
                          </div>
                          <div>
                            Provider: <span className="text-bone">{envInfo.kms.provider}</span>
                          </div>
                          <div className="mt-1">
                            Key ID: <span className="break-all text-bone">{envInfo.kms.keyId}</span>
                          </div>
                          <div className="mt-2.5 rounded border border-purple-400/20 bg-purple-400/10 px-3 py-2 font-sans text-[11px] text-purple-400">
                            No keys to provision. CI and runtime authenticate via IAM role with
                            kms:Decrypt permission.
                          </div>
                        </div>
                      )}

                      {envInfo.type === "age" && (
                        <div className="font-mono text-[11px] text-ash">
                          <div className="mb-2">
                            Authentication: <span className="text-go-500">age key</span>
                          </div>
                          <div>
                            Public key:{" "}
                            <span className="text-bone">
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

                <div className="mt-8 flex justify-end border-t border-edge pt-5">
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
      <div data-testid="delete-confirm-view" className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>Delete service identity</Toolbar.Title>
            <Toolbar.Subtitle>This action cannot be undone</Toolbar.Subtitle>
          </div>
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[560px]">
            {deleteError && <ErrorBanner>{deleteError}</ErrorBanner>}

            <div className="mb-6 rounded-lg border border-stop-500/40 bg-stop-500/[0.06] px-5 py-4 font-sans text-[13px] text-stop-500">
              <div className="mb-2 font-semibold">
                Delete <span className="font-mono">{selected}</span>?
              </div>
              <div className="text-[12px] leading-relaxed text-ash">
                This will remove the identity from <span className="font-mono">clef.yaml</span> and
                de-register its recipients from all scoped encrypted files. Any runtimes currently
                using this identity's private key will lose access on the next artifact refresh.
              </div>
            </div>

            <div className="flex justify-end gap-2">
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
      <div data-testid="rotate-keys-view" className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>Key rotated</Toolbar.Title>
            <Toolbar.Subtitle>{`New keys for ${selected}`}</Toolbar.Subtitle>
          </div>
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[620px]">
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warn-500/40 bg-warn-500/[0.06] px-4 py-3.5 font-sans text-[13px] text-warn-500">
              <span className="shrink-0 text-[16px]">⚠</span>
              <span>
                Copy the new private key now — it will not be shown again. Provision it to the
                runtime and invalidate the old key.
              </span>
            </div>

            <Label>New private keys</Label>
            {Object.entries(rotatedKeys).map(([envName, key]) => (
              <div
                key={envName}
                className="mb-2.5 rounded-lg border border-edge bg-ink-850 px-4 py-3.5"
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <EnvBadge env={envName} />
                  <CopyButton text={key} />
                </div>
                <div className="break-all rounded bg-ink-950 px-2.5 py-2 font-mono text-[11px] text-ash">
                  {key}
                </div>
              </div>
            ))}

            <div className="mt-2 flex justify-end">
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>Update backends</Toolbar.Title>
            <Toolbar.Subtitle>{`Environment backends for ${selected}`}</Toolbar.Subtitle>
          </div>
          <Toolbar.Actions>
            <button onClick={goDetail} className={BACK_BUTTON}>
              {"←"} Cancel
            </button>
          </Toolbar.Actions>
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[560px]">
            {updateError && <ErrorBanner>{updateError}</ErrorBanner>}

            <div className="mb-4 font-sans text-[12px] leading-relaxed text-ash">
              Switch age environments to KMS, or update an existing KMS key ID. To revert KMS to
              age, delete and recreate the identity.
            </div>

            <div className="mb-7 flex flex-col gap-2">
              {environments.map((env) => {
                const state = updateEnvBackends[env.name];
                if (!state) return null;
                return (
                  <div
                    key={env.name}
                    className="rounded-lg border border-edge bg-ink-850 px-4 py-3.5"
                  >
                    <div
                      className={`flex items-center justify-between ${state.type === "kms" ? "mb-3" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <EnvBadge env={env.name} />
                        {env.protected && <span className="text-[11px] text-stop-500">{"🔒"}</span>}
                      </div>
                      <div className="flex gap-1">
                        {(["age", "kms"] as const).map((t) => {
                          const locked = state.originalType === "kms" && t === "age";
                          const isSelected = state.type === t;
                          const buttonClass = isSelected
                            ? t === "kms"
                              ? "bg-purple-400 border-purple-400 text-ghost"
                              : "bg-gold-500 border-gold-500 text-ink-950"
                            : "bg-transparent border-edge text-ash";
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
                              className={`rounded border px-2.5 py-0.5 font-mono text-[11px] transition-colors ${buttonClass} ${locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                            >
                              {t.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {state.type === "kms" && (
                      <div className="flex gap-2">
                        <select
                          value={state.provider}
                          onChange={(e) =>
                            setUpdateEnvBackends((prev) => ({
                              ...prev,
                              [env.name]: { ...state, provider: e.target.value },
                            }))
                          }
                          className={`${SMALL_INPUT_BASE} w-[90px] shrink-0`}
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
                          className={`${SMALL_INPUT_BASE} flex-1`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                data-testid="update-cancel-btn"
                variant="ghost"
                onClick={goDetail}
                disabled={updating}
              >
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
    const sharedKey = wasSharedRecipient ? Object.values(privateKeys)[0] : undefined;
    const sharedEnvNames = wasSharedRecipient ? Object.keys(privateKeys) : [];

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar>
          <div>
            <Toolbar.Title>{`${createdName} created`}</Toolbar.Title>
            <Toolbar.Subtitle>Service identity ready</Toolbar.Subtitle>
          </div>
        </Toolbar>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[620px]">
            {hasAgeKeys && (
              <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warn-500/40 bg-warn-500/[0.06] px-4 py-3.5 font-sans text-[13px] text-warn-500">
                <span className="shrink-0 text-[16px]">⚠</span>
                <span>
                  {wasSharedRecipient
                    ? `Copy this key now — it will not be shown again. Set it as CLEF_AGE_KEY in your CI. It decrypts: ${sharedEnvNames.join(", ")}.`
                    : "Copy these private keys now — they will not be shown again. Store each key securely and provision it to the relevant runtime."}
                </span>
              </div>
            )}

            {!hasAgeKeys && (
              <div className="mb-5 rounded-lg border border-purple-400/30 bg-purple-400/10 px-4 py-3.5 font-sans text-[13px] text-purple-400">
                All environments use KMS. No private keys to provision — runtimes authenticate via
                IAM role.
              </div>
            )}

            <Label>Private keys</Label>

            {wasSharedRecipient && sharedKey ? (
              <div className="mb-2.5 rounded-lg border border-gold-500/30 bg-ink-850 px-4 py-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-gold-500">
                      CLEF_AGE_KEY
                    </span>
                    <span className="font-sans text-[11px] text-ash-dim">—</span>
                    {sharedEnvNames.map((e) => (
                      <EnvBadge key={e} env={e} small />
                    ))}
                  </div>
                  <CopyButton text={sharedKey} />
                </div>
                <div className="break-all rounded bg-ink-950 px-2.5 py-2 font-mono text-[11px] text-ash">
                  {sharedKey}
                </div>
              </div>
            ) : (
              Object.entries(privateKeys).map(([envName, key]) => (
                <div
                  key={envName}
                  className="mb-2.5 rounded-lg border border-edge bg-ink-850 px-4 py-3.5"
                >
                  <div className="mb-2.5 flex items-center justify-between">
                    <EnvBadge env={envName} />
                    <CopyButton text={key} />
                  </div>
                  <div className="break-all rounded bg-ink-950 px-2.5 py-2 font-mono text-[11px] text-ash">
                    {key}
                  </div>
                </div>
              ))
            )}

            <div className="mt-2 flex justify-end">
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>New service identity</Toolbar.Title>
          <Toolbar.Subtitle>Scope cryptographic access to specific namespaces</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <button onClick={goList} className={BACK_BUTTON}>
            {"←"} Cancel
          </button>
        </Toolbar.Actions>
      </Toolbar>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[560px]">
          {createError && <ErrorBanner>{createError}</ErrorBanner>}

          <div className="mb-5">
            <FieldLabel>Name</FieldLabel>
            <input
              data-testid="si-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. api-gateway"
              className={INPUT_BASE}
            />
            {nameError && (
              <div className="mt-1.5 font-sans text-[12px] text-stop-500">{nameError}</div>
            )}
          </div>

          <div className="mb-6">
            <FieldLabel>Description (optional)</FieldLabel>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. API gateway service account"
              className={INPUT_BASE}
            />
          </div>

          <div className="mb-6">
            <FieldLabel>Role</FieldLabel>
            <div className="mb-2 flex w-fit overflow-hidden rounded-md border border-edge">
              {(["ci", "runtime"] as const).map((r) => (
                <button
                  key={r}
                  data-testid={`role-${r}`}
                  onClick={() => {
                    setRole(r);
                    const newDefault = r === "ci";
                    setSharedRecipient(newDefault);
                    setSharedRecipientOverridden(false);
                  }}
                  className={`cursor-pointer border-none px-4 py-1.5 font-sans text-[12px] transition-colors ${
                    role === r
                      ? "bg-gold-500 font-semibold text-ink-950"
                      : "bg-transparent font-normal text-ash"
                  }`}
                >
                  {r === "ci" ? "CI" : "Runtime"}
                </button>
              ))}
            </div>
            <div className="font-sans text-[12px] leading-relaxed text-ash">
              {role === "ci"
                ? "Decrypts files directly. Keys are registered on encrypted SOPS files. Use for CI pipelines and local tools."
                : "Decrypts packed artifacts only. Keys are NOT added to encrypted files — smaller blast radius for deployment targets (Lambda, ECS, containers)."}
            </div>
          </div>

          <div className="mb-6">
            <FieldLabel>Namespaces</FieldLabel>
            <div className="mb-2.5 font-sans text-[12px] text-ash">
              This identity can decrypt secrets only from the selected namespaces.
            </div>
            {namespaces.length === 0 && (
              <div className="font-sans text-[12px] text-ash-dim">
                No namespaces defined in manifest.
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {namespaces.map((ns) => {
                const checked = selectedNamespaces.has(ns.name);
                return (
                  <label
                    key={ns.name}
                    data-testid={`ns-checkbox-${ns.name}`}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3.5 py-2.5 transition-colors ${
                      checked ? "border-gold-500/40 bg-gold-500/[0.08]" : "border-edge bg-ink-850"
                    }`}
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
                      className="accent-gold-500"
                    />
                    <span
                      className={`font-mono text-[12px] ${checked ? "text-gold-500" : "text-bone"}`}
                    >
                      {ns.name}
                    </span>
                    {ns.description && (
                      <span className="font-sans text-[11px] text-ash">— {ns.description}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mb-7">
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Environment backends</FieldLabel>
              <label
                data-testid="shared-recipient-toggle"
                className={`flex cursor-pointer select-none items-center gap-1.5 font-sans text-[11px] ${sharedRecipient ? "text-gold-500" : "text-ash"}`}
              >
                <div
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${sharedRecipient ? "bg-gold-500" : "bg-edge"}`}
                >
                  <div
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${sharedRecipient ? "left-3.5" : "left-0.5"}`}
                  />
                  <input
                    type="checkbox"
                    checked={sharedRecipient}
                    onChange={(e) => {
                      setSharedRecipient(e.target.checked);
                      const roleDefault = role === "ci";
                      setSharedRecipientOverridden(e.target.checked !== roleDefault);
                    }}
                    className="absolute h-0 w-0 opacity-0"
                  />
                </div>
                Shared age key
              </label>
            </div>

            <div className="mb-2.5 font-sans text-[12px] text-ash">
              {sharedRecipient
                ? "One age key pair for all environments — one CI secret, easier to provision."
                : "Age generates a key pair per environment. KMS uses your cloud provider — no key material is provisioned."}
            </div>

            {sharedRecipientOverridden && (
              <div
                data-testid="shared-recipient-warning"
                className="mb-2.5 rounded-md border border-warn-500/40 bg-warn-500/[0.06] px-3.5 py-2.5 font-sans text-[12px] leading-relaxed text-warn-500"
              >
                {role === "ci" && !sharedRecipient
                  ? "Most CI pipelines use a single key. Per-environment keys are useful when your CI environments have separate secret access controls (e.g. GitHub environment protection rules)."
                  : "Runtime workloads typically use per-environment keys for isolation. A shared key means a compromised key in any environment decrypts artifacts for all environments."}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {sharedRecipient ? (
                <div className="flex items-center gap-3 rounded-lg border border-gold-500/30 bg-gold-500/[0.08] px-4 py-3.5">
                  <div className="flex flex-wrap gap-1.5">
                    {environments.map((env) => (
                      <EnvBadge key={env.name} env={env.name} small />
                    ))}
                  </div>
                  <span className="ml-auto font-mono text-[11px] text-gold-500">age (shared)</span>
                </div>
              ) : (
                environments.map((env) => {
                  const cfg = envBackends[env.name] ?? { type: "age", provider: "aws", keyId: "" };
                  return (
                    <div
                      key={env.name}
                      className="rounded-lg border border-edge bg-ink-850 px-4 py-3.5"
                    >
                      <div
                        className={`flex items-center justify-between ${cfg.type === "kms" ? "mb-3" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <EnvBadge env={env.name} />
                          {env.protected && (
                            <span className="text-[11px] text-stop-500">{"🔒"}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {(["age", "kms"] as const).map((t) => {
                            const isSelected = cfg.type === t;
                            const buttonClass = isSelected
                              ? t === "kms"
                                ? "bg-purple-400 border-purple-400 text-ghost"
                                : "bg-gold-500 border-gold-500 text-ink-950"
                              : "bg-transparent border-edge text-ash";
                            return (
                              <button
                                key={t}
                                onClick={() =>
                                  setEnvBackends((prev) => ({
                                    ...prev,
                                    [env.name]: { ...cfg, type: t },
                                  }))
                                }
                                className={`cursor-pointer rounded border px-2.5 py-0.5 font-mono text-[11px] transition-colors ${buttonClass}`}
                              >
                                {t.toUpperCase()}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {cfg.type === "kms" && (
                        <div className="flex gap-2">
                          <select
                            value={cfg.provider}
                            onChange={(e) =>
                              setEnvBackends((prev) => ({
                                ...prev,
                                [env.name]: { ...cfg, provider: e.target.value },
                              }))
                            }
                            className={`${SMALL_INPUT_BASE} w-[90px] shrink-0`}
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
                            className={`${SMALL_INPUT_BASE} flex-1`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
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
    <div className="mb-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 font-sans text-[12px] font-semibold text-ash">{children}</div>;
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3 font-sans text-[13px] text-stop-500">
      {children}
    </div>
  );
}
