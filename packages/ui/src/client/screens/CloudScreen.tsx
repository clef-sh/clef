import React, { useState, useEffect, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import type { ClefManifest } from "@clef-sh/core";

interface CloudScreenProps {
  manifest: ClefManifest | null;
}

interface CloudStatusResponse {
  connected: boolean;
  integrationId?: string;
  keyId?: string;
  environments: string[];
  authenticated: boolean;
}

const CLOUD_DASHBOARD_URL = "https://cloud.clef.sh";

export function CloudScreen({ manifest }: CloudScreenProps) {
  const isCloud = !!manifest?.cloud?.integrationId;

  if (!isCloud) {
    return <CloudOnboarding />;
  }

  return <CloudDashboard manifest={manifest!} />;
}

function CloudOnboarding() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Cloud" subtitle="clef cloud — managed KMS for production" />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 40 }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: theme.accentDim,
                border: `1px solid ${theme.accent}33`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                color: theme.accent,
                margin: "0 auto 16px",
              }}
            >
              {"\u2601"}
            </div>
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 18,
                fontWeight: 700,
                color: theme.text,
                marginBottom: 8,
              }}
            >
              Clef Cloud
            </div>
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.textMuted,
                lineHeight: 1.6,
                maxWidth: 400,
                margin: "0 auto",
              }}
            >
              Managed KMS for production. One command, no AWS setup required. Your dev and staging
              environments stay on age — production gets real KMS encryption.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            <FeatureRow label="Managed KMS key" description="No AWS account or IAM setup" />
            <FeatureRow label="Artifact hosting" description="Pack in CI, Cloud serves secrets" />
            <FeatureRow
              label="Serve endpoint"
              description="Production workloads fetch secrets via HTTPS"
            />
            <FeatureRow
              label="Zero lock-in"
              description="Eject anytime with clef migrate-backend"
            />
          </div>

          <div
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 11,
                fontWeight: 600,
                color: theme.textMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Get started
            </div>
            <div
              style={{
                fontFamily: theme.mono,
                fontSize: 13,
                color: theme.accent,
                background: theme.accentDim,
                border: `1px solid ${theme.accent}22`,
                borderRadius: 6,
                padding: "10px 14px",
                marginBottom: 10,
              }}
            >
              clef cloud init --env production
            </div>
            <div
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
              }}
            >
              Run this in your terminal to provision a managed KMS key and migrate your production
              environment.
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <a
              href={CLOUD_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: theme.sans,
                fontSize: 12,
                color: theme.textMuted,
                textDecoration: "none",
                transition: "color 0.12s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = theme.accent;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = theme.textMuted;
              }}
            >
              Learn more at cloud.clef.sh {"\u2197"}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ label, description }: { label: string; description: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
      }}
    >
      <span style={{ color: theme.accent, fontSize: 14 }}>{"\u2713"}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: theme.text }}>
          {label}
        </div>
        <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.textMuted }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function CloudDashboard({ manifest }: { manifest: ClefManifest }) {
  const [status, setStatus] = useState<CloudStatusResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/cloud/status");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const cloudEnvs =
    manifest.environments
      .filter((e) => e.sops?.backend === "cloud" || manifest.sops.default_backend === "cloud")
      .map((e) => e.name) ?? [];

  const handleRotate = async () => {
    setRotating(true);
    setRotateError(null);
    setToken(null);
    try {
      const res = await apiFetch("/api/cloud/token/rotate", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
      } else {
        const data = await res.json();
        setRotateError(data.error ?? "Failed to rotate token");
      }
    } catch {
      setRotateError("Network error");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Cloud" subtitle="clef cloud — managed KMS for production" />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          {/* Connection status */}
          <Section label="Connection">
            <div
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: 14,
              }}
            >
              <StatusRow label="Status">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: theme.accent,
                      boxShadow: `0 0 5px ${theme.accent}`,
                    }}
                  />
                  <span style={{ color: theme.accent, fontWeight: 600 }}>Connected</span>
                </span>
              </StatusRow>
              <StatusRow label="Integration">
                <span style={{ fontFamily: theme.mono }}>{manifest.cloud?.integrationId}</span>
              </StatusRow>
              <StatusRow label="Key ID">
                <span style={{ fontFamily: theme.mono }}>{manifest.cloud?.keyId}</span>
              </StatusRow>
              <StatusRow label="Environments" last>
                <span style={{ display: "flex", gap: 4 }}>
                  {cloudEnvs.map((env) => (
                    <span
                      key={env}
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: theme.accentDim,
                        border: `1px solid ${theme.accent}33`,
                        borderRadius: 3,
                        color: theme.accent,
                      }}
                    >
                      {env}
                    </span>
                  ))}
                </span>
              </StatusRow>
              {status && !status.authenticated && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    background: theme.yellowDim,
                    border: `1px solid ${theme.yellow}44`,
                    borderRadius: 6,
                    fontFamily: theme.sans,
                    fontSize: 12,
                    color: theme.yellow,
                  }}
                >
                  Not authenticated. Run{" "}
                  <code style={{ fontFamily: theme.mono }}>clef cloud login</code> to
                  re-authenticate.
                </div>
              )}
            </div>
          </Section>

          {/* Serve token */}
          <Section label="Serve Token">
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
                  fontFamily: theme.sans,
                  fontSize: 12,
                  color: theme.textMuted,
                  marginBottom: 12,
                }}
              >
                Bearer token for production workloads to fetch secrets from the serve endpoint.
                Revealing the token rotates it — the previous token is immediately invalidated.
              </div>

              {token && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                    padding: "8px 12px",
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 11,
                      color: theme.text,
                      flex: 1,
                      wordBreak: "break-all",
                    }}
                  >
                    {token}
                  </span>
                  <CopyButton text={token} />
                </div>
              )}

              {rotateError && (
                <div
                  style={{
                    marginBottom: 12,
                    fontFamily: theme.sans,
                    fontSize: 12,
                    color: theme.red,
                  }}
                >
                  {rotateError}
                </div>
              )}

              <Button variant="primary" onClick={handleRotate} disabled={rotating}>
                {rotating ? "Rotating..." : token ? "Rotate Again" : "Reveal & Rotate"}
              </Button>
            </div>
          </Section>

          {/* Manage */}
          <Section label="Account">
            <a
              href={CLOUD_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                textDecoration: "none",
                transition: "border-color 0.12s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = theme.borderLight;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = theme.border;
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text,
                  }}
                >
                  Manage billing & upgrades
                </div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 11,
                    color: theme.textMuted,
                    marginTop: 2,
                  }}
                >
                  Subscription, remote pack, Hardpack
                </div>
              </div>
              <span style={{ fontFamily: theme.mono, fontSize: 14, color: theme.textMuted }}>
                {"\u2197"}
              </span>
            </a>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontFamily: theme.sans,
          fontSize: 11,
          fontWeight: 600,
          color: theme.textMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: last ? "none" : `1px solid ${theme.border}`,
        fontFamily: theme.sans,
        fontSize: 12,
      }}
    >
      <span style={{ color: theme.textMuted }}>{label}</span>
      <span style={{ color: theme.text }}>{children}</span>
    </div>
  );
}
