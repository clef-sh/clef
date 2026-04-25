// packages/ui/src/client/screens/GitLogView.tsx
import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { Toolbar, Table, EmptyState } from "../primitives";
import type { ClefManifest, GitCommit } from "@clef-sh/core";

interface GitLogViewProps {
  manifest: ClefManifest | null;
}

const SELECT_CLASSES =
  "font-mono text-[12px] bg-ink-850 text-bone border border-edge rounded-sm px-2 py-0.5 outline-none focus-visible:border-gold-500";

const SELECT_LABEL_CLASSES = "flex items-center gap-2 font-mono text-[12px] text-ash";

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
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>History</Toolbar.Title>
          <Toolbar.Subtitle>Commit log per encrypted file</Toolbar.Subtitle>
        </div>
      </Toolbar>

      {/* Selectors */}
      <div className="flex gap-3 px-6 py-4 border-b border-edge">
        <label className={SELECT_LABEL_CLASSES}>
          Namespace
          <select value={ns} onChange={(e) => setNs(e.target.value)} className={SELECT_CLASSES}>
            {namespaces.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label className={SELECT_LABEL_CLASSES}>
          Environment
          <select value={env} onChange={(e) => setEnv(e.target.value)} className={SELECT_CLASSES}>
            {environments.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading && <div className="p-6 font-mono text-[12px] text-ash">Loading…</div>}
        {!loading && error && (
          <div className="p-6 font-mono text-[12px] text-stop-500">{error}</div>
        )}
        {!loading && !error && commits.length === 0 && (
          <div className="pt-6">
            <EmptyState title="No commits found" body={`No history for ${ns}/${env}.`} />
          </div>
        )}
        {!loading && !error && commits.length > 0 && (
          <div className="mt-4">
            <Table>
              <Table.Header>
                <tr>
                  <Table.HeaderCell>Hash</Table.HeaderCell>
                  <Table.HeaderCell>Date</Table.HeaderCell>
                  <Table.HeaderCell>Author</Table.HeaderCell>
                  <Table.HeaderCell>Message</Table.HeaderCell>
                </tr>
              </Table.Header>
              <tbody>
                {commits.map((c) => (
                  <Table.Row key={c.hash}>
                    <Table.Cell className="font-mono text-gold-500">
                      {c.hash.slice(0, 7)}
                    </Table.Cell>
                    <Table.Cell className="text-ash whitespace-nowrap">
                      {new Date(c.date).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell className="text-ash">{c.author}</Table.Cell>
                    <Table.Cell>{c.message}</Table.Cell>
                  </Table.Row>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
