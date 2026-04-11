import React, { useState, useEffect, useCallback } from "react";
import { theme } from "./theme";
import { apiFetch } from "./api";
import { Sidebar, ViewName } from "./components/Sidebar";
import { MatrixView } from "./screens/MatrixView";
import { NamespaceEditor } from "./screens/NamespaceEditor";
import { DiffView } from "./screens/DiffView";
import { LintView } from "./screens/LintView";
import { ScanScreen } from "./screens/ScanScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { ManifestScreen } from "./screens/ManifestScreen";
import { RecipientsScreen } from "./screens/RecipientsScreen";
import { ServiceIdentitiesScreen } from "./screens/ServiceIdentitiesScreen";
import { BackendScreen } from "./screens/BackendScreen";
import { GitLogView } from "./screens/GitLogView";
import type { ClefManifest, MatrixStatus, GitStatus, LintResult } from "@clef-sh/core";

export default function App() {
  const [view, setView] = useState<ViewName>("matrix");
  const [activeNs, setActiveNs] = useState("");
  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<ClefManifest | null>(null);
  const [matrixStatuses, setMatrixStatuses] = useState<MatrixStatus[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [lintErrorCount, setLintErrorCount] = useState(0);
  const [scanIssueCount, setScanIssueCount] = useState(0);

  const loadManifest = useCallback(async () => {
    try {
      const res = await apiFetch("/api/manifest");
      if (res.ok) {
        const data: ClefManifest = await res.json();
        setManifest(data);
        setActiveNs((prev) => (prev ? prev : (data.namespaces[0]?.name ?? "")));
      }
    } catch {
      // Will retry on next navigation
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatrix = useCallback(async () => {
    try {
      const res = await apiFetch("/api/matrix");
      if (res.ok) {
        setMatrixStatuses(await res.json());
      }
    } catch {
      // Silently fail
    }
  }, []);

  const loadGitStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/git/status");
      if (res.ok) {
        setGitStatus(await res.json());
      }
    } catch {
      // Silently fail
    }
  }, []);

  const loadLintCount = useCallback(async () => {
    try {
      const res = await apiFetch("/api/lint");
      if (res.ok) {
        const data: LintResult = await res.json();
        setLintErrorCount(data.issues.filter((i) => i.severity === "error").length);
      }
    } catch {
      // Silently fail
    }
  }, []);

  const loadScanCount = useCallback(async () => {
    try {
      const res = await apiFetch("/api/scan/status");
      if (res.ok) {
        const data = await res.json();
        if (data.lastRun) {
          const count =
            (data.lastRun.matches?.length ?? 0) +
            (data.lastRun.unencryptedMatrixFiles?.length ?? 0);
          setScanIssueCount(count);
        }
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    loadManifest();
    loadMatrix();
    loadGitStatus();
    loadLintCount();
    loadScanCount();
  }, [loadManifest, loadMatrix, loadGitStatus, loadLintCount, loadScanCount]);

  // Refresh data on every view change — manifest and matrix are cheap (no decryption)
  useEffect(() => {
    loadManifest();
    loadMatrix();
  }, [view, loadManifest, loadMatrix]);

  const handleCommit = async (message: string) => {
    try {
      await apiFetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      await Promise.all([loadGitStatus(), loadMatrix()]);
    } catch {
      // Error handling in production would show a toast
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: theme.bg,
          color: theme.textMuted,
          fontFamily: theme.sans,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 24,
              color: theme.accent,
              marginBottom: 12,
            }}
          >
            {"\u266A"}
          </div>
          <div style={{ fontSize: 13 }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: theme.bg,
        color: theme.text,
        fontFamily: theme.sans,
        overflow: "hidden",
      }}
    >
      <Sidebar
        activeView={view}
        setView={setView}
        activeNs={activeNs}
        setNs={setActiveNs}
        manifest={manifest}
        matrixStatuses={matrixStatuses}
        gitStatus={gitStatus}
        lintErrorCount={lintErrorCount}
        scanIssueCount={scanIssueCount}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {view === "matrix" && (
          <MatrixView
            setView={setView}
            setNs={setActiveNs}
            manifest={manifest}
            matrixStatuses={matrixStatuses}
          />
        )}
        {view === "editor" && (
          <NamespaceEditor ns={activeNs} manifest={manifest} onCommit={handleCommit} />
        )}
        {view === "diff" && <DiffView manifest={manifest} />}
        {view === "lint" && <LintView setView={setView} setNs={setActiveNs} />}
        {view === "scan" && <ScanScreen />}
        {view === "import" && <ImportScreen manifest={manifest} setView={setView} />}
        {view === "recipients" && <RecipientsScreen manifest={manifest} setView={setView} />}
        {view === "identities" && <ServiceIdentitiesScreen manifest={manifest} />}
        {view === "backend" && (
          <BackendScreen manifest={manifest} setView={setView} reloadManifest={loadManifest} />
        )}
        {view === "cloud" && null}
        {view === "history" && <GitLogView manifest={manifest} />}
        {view === "manifest" && (
          <ManifestScreen manifest={manifest} reloadManifest={loadManifest} />
        )}
      </div>
    </div>
  );
}
