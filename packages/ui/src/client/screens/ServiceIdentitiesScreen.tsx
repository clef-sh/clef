import React, { useState, useEffect, useCallback, useRef } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { EnvBadge } from "../components/EnvBadge";
import { CopyButton } from "../components/CopyButton";
import type { ClefManifest } from "@clef-sh/core";

interface EnvInfo {
  type: string;
  publicKey?: string;
  kms?: { provider: string; keyId: string };
  protected?: boolean;
  hasKey?: boolean;
}

interface IdentityInfo {
  name: string;
  description: string;
  namespaces: string[];
  environments: Record<string, EnvInfo>;
}

interface ServiceIdentitiesScreenProps {
  manifest: ClefManifest | null;
}

const REVEAL_TIMEOUT_MS = 5 * 60 * 1000;

export function ServiceIdentitiesScreen({ manifest }: ServiceIdentitiesScreenProps) {
  const [identities, setIdentities] = useState<IdentityInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [confirmEnv, setConfirmEnv] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(revealTimeoutRef.current), []);

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

  const resetTimeout = () => {
    clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = setTimeout(() => {
      setRevealedKeys({});
    }, REVEAL_TIMEOUT_MS);
  };

  const revealKey = async (name: string, env: string, isProtected: boolean) => {
    const cacheKey = `${name}:${env}`;

    if (revealedKeys[cacheKey]) {
      const next = { ...revealedKeys };
      delete next[cacheKey];
      setRevealedKeys(next);
      return;
    }

    if (isProtected && confirmEnv !== env) {
      setConfirmEnv(env);
      return;
    }

    setLoading(cacheKey);
    setConfirmEnv(null);
    try {
      const qs = isProtected ? "?confirmed=true" : "";
      const res = await apiFetch(`/api/service-identities/${name}/key/${env}${qs}`);
      if (res.ok) {
        const data = await res.json();
        setRevealedKeys((prev) => ({ ...prev, [cacheKey]: data.privateKey }));
        resetTimeout();
      } else {
        const errData = await res.json();
        setError(errData.error ?? "Failed to retrieve key");
      }
    } catch {
      setError("Failed to retrieve key");
    } finally {
      setLoading(null);
    }
  };

  // List view
  if (!selected) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar
          title="Service Identities"
          subtitle="clef service -- manage service identity keys"
        />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
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
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textDim,
                    marginTop: 8,
                  }}
                >
                  clef service create &lt;name&gt; --namespaces &lt;ns&gt;
                </div>
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
                  setRevealedKeys({});
                  setConfirmEnv(null);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelected(si.name);
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
                  {Object.keys(si.environments).map((envName) => (
                    <EnvBadge key={envName} env={envName} small />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Detail view
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title={selectedIdentity?.name ?? selected}
        subtitle={selectedIdentity?.description}
        actions={
          <button
            data-testid="back-button"
            onClick={() => {
              setSelected(null);
              setRevealedKeys({});
              setConfirmEnv(null);
              setError("");
            }}
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
        }
      />
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
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
                const cacheKey = `${selectedIdentity.name}:${env.name}`;
                const revealed = revealedKeys[cacheKey];
                const isLoading = loading === cacheKey;
                const isProtected = envInfo.protected ?? false;

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
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
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

                    {envInfo.type === "kms" && envInfo.kms && (
                      <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textMuted }}>
                        <div>
                          Provider:{" "}
                          <span style={{ color: theme.text }}>{envInfo.kms.provider}</span>
                        </div>
                        <div style={{ marginTop: 4 }}>
                          Key ID: <span style={{ color: theme.text }}>{envInfo.kms.keyId}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            color: theme.textDim,
                            fontFamily: theme.sans,
                          }}
                        >
                          No age private key — decryption via KMS at runtime.
                        </div>
                      </div>
                    )}

                    {envInfo.type === "age" && (
                      <>
                        <div
                          style={{
                            fontFamily: theme.mono,
                            fontSize: 11,
                            color: theme.textMuted,
                            marginBottom: 10,
                          }}
                        >
                          Public key:{" "}
                          <span style={{ color: theme.text }}>
                            {envInfo.publicKey
                              ? `${envInfo.publicKey.slice(0, 12)}...${envInfo.publicKey.slice(-6)}`
                              : "unknown"}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            fontFamily: theme.mono,
                            fontSize: 11,
                          }}
                        >
                          <span style={{ color: theme.textMuted }}>Private key:</span>
                          <span
                            style={{
                              flex: 1,
                              color: revealed ? theme.text : theme.textDim,
                              wordBreak: "break-all",
                            }}
                          >
                            {revealed
                              ? revealed
                              : envInfo.hasKey
                                ? "\u2022".repeat(20)
                                : "not stored"}
                          </span>

                          {envInfo.hasKey && (
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              {revealed && <CopyButton text={revealed} />}
                              <button
                                data-testid={`reveal-${env.name}`}
                                onClick={() =>
                                  revealKey(selectedIdentity.name, env.name, isProtected)
                                }
                                disabled={isLoading}
                                style={{
                                  background: "none",
                                  border: `1px solid ${theme.borderLight}`,
                                  borderRadius: 4,
                                  cursor: isLoading ? "wait" : "pointer",
                                  color: revealed ? theme.accent : theme.textDim,
                                  fontFamily: theme.mono,
                                  fontSize: 10,
                                  padding: "2px 8px",
                                  transition: "all 0.15s",
                                }}
                              >
                                {isLoading ? "..." : revealed ? "hide" : "reveal"}
                              </button>
                            </div>
                          )}
                        </div>

                        {isProtected && confirmEnv === env.name && !revealed && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: "10px 14px",
                              background: theme.redDim,
                              border: `1px solid ${theme.red}44`,
                              borderRadius: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <span
                              style={{
                                fontFamily: theme.sans,
                                fontSize: 12,
                                color: theme.red,
                                flex: 1,
                              }}
                            >
                              Protected environment. Confirm to reveal key.
                            </span>
                            <button
                              data-testid={`confirm-${env.name}`}
                              onClick={() =>
                                revealKey(selectedIdentity.name, env.name, isProtected)
                              }
                              style={{
                                background: theme.redDim,
                                border: `1px solid ${theme.red}66`,
                                borderRadius: 4,
                                cursor: "pointer",
                                color: theme.red,
                                fontFamily: theme.sans,
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "4px 12px",
                              }}
                            >
                              Confirm
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </>
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
        marginBottom: 6,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
