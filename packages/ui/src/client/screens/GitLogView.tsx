// packages/ui/src/client/screens/GitLogView.tsx
import React, { useState, useEffect, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import type { ClefManifest, GitCommit } from "@clef-sh/core";

interface GitLogViewProps {
  manifest: ClefManifest | null;
}

export function GitLogView({ manifest }: GitLogViewProps) {
  const namespaces = manifest?.namespaces ?? [];
  const environments = manifest?.environments ?? [];

  const [ns, setNs] = useState(namespaces[0]?.name ?? "");
  const [env, setEnv] = useState(environments[0]?.name ?? "");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectors when manifest loads
  useEffect(() => {
    if (namespaces.length > 0 && !ns) setNs(namespaces[0].name);
    if (environments.length > 0 && !env) setEnv(environments[0].name);
  }, [namespaces, environments, ns, env]);

  const loadLog = useCallback(async () => {
    if (!ns || !env) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/git/log/${ns}/${env}`);
      if (res.ok) {
        const data = await res.json();
        setCommits(data.log as GitCommit[]);
      } else {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to load history");
        setCommits([]);
      }
    } catch {
      setError("Network error — could not load history");
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [ns, env]);

  // Auto-load when selectors change
  useEffect(() => {
    loadLog();
  }, [loadLog]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="History" subtitle="Commit log per encrypted file" />

      {/* Selectors */}
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "16px 24px",
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontFamily: theme.mono,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          Namespace
          <select
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            style={{
              fontFamily: theme.mono,
              fontSize: 12,
              background: theme.surface,
              color: theme.text,
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              padding: "3px 8px",
            }}
          >
            {namespaces.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontFamily: theme.mono,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          Environment
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            style={{
              fontFamily: theme.mono,
              fontSize: 12,
              background: theme.surface,
              color: theme.text,
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              padding: "3px 8px",
            }}
          >
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        {loading && (
          <div
            style={{ padding: 24, color: theme.textMuted, fontFamily: theme.mono, fontSize: 12 }}
          >
            Loading…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, color: theme.red, fontFamily: theme.mono, fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && commits.length === 0 && (
          <div
            style={{ padding: 24, color: theme.textMuted, fontFamily: theme.mono, fontSize: 12 }}
          >
            No commits found for {ns}/{env}.
          </div>
        )}
        {!loading && !error && commits.length > 0 && (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: theme.mono,
              fontSize: 12,
              marginTop: 16,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}`, color: theme.textDim }}>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600 }}>
                  Hash
                </th>
                <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600 }}>Date</th>
                <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600 }}>Author</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 600 }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {commits.map((c) => (
                <tr key={c.hash} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                  <td style={{ padding: "8px 12px 8px 0", color: theme.accent }}>
                    {c.hash.slice(0, 7)}
                  </td>
                  <td style={{ padding: "8px 12px", color: theme.textMuted, whiteSpace: "nowrap" }}>
                    {new Date(c.date).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "8px 12px", color: theme.textMuted }}>{c.author}</td>
                  <td style={{ padding: "8px 0", color: theme.text }}>{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
