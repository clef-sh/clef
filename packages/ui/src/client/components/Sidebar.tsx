import React from "react";
import { theme } from "../theme";
import type { ClefManifest, MatrixStatus, GitStatus as GitStatusType } from "@clef-sh/core";

export type ViewName =
  | "matrix"
  | "editor"
  | "diff"
  | "lint"
  | "scan"
  | "import"
  | "recipients"
  | "identities"
  | "backend"
  | "history"
  | "manifest";

interface SidebarProps {
  activeView: ViewName;
  setView: (view: ViewName) => void;
  activeNs: string;
  setNs: (ns: string) => void;
  manifest: ClefManifest | null;
  matrixStatuses: MatrixStatus[];
  gitStatus: GitStatusType | null;
  lintErrorCount: number;
  scanIssueCount: number;
}

export function Sidebar({
  activeView,
  setView,
  activeNs,
  setNs,
  manifest,
  matrixStatuses,
  gitStatus,
  lintErrorCount,
  scanIssueCount,
}: SidebarProps) {
  const uncommittedCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  const namespaces = manifest?.namespaces ?? [];

  return (
    <div
      style={{
        width: 220,
        minHeight: "100vh",
        background: theme.surface,
        borderRight: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "20px 20px 16px",
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            background: theme.accentDim,
            border: `1px solid ${theme.accent}44`,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.accent,
            fontSize: 15,
          }}
        >
          {"\u266A"}
        </div>
        <div>
          <div
            style={{
              fontFamily: theme.sans,
              fontWeight: 700,
              fontSize: 16,
              color: theme.text,
              letterSpacing: "-0.02em",
            }}
          >
            clef
          </div>
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 9,
              color: theme.textMuted,
              marginTop: -1,
            }}
          >
            {manifest?.sops.default_backend ?? "local"} / main
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: "12px 10px", flex: 1 }}>
        <NavItem
          icon={"\u229E"}
          label="Matrix"
          active={activeView === "matrix"}
          onClick={() => setView("matrix")}
        />
        <NavItem
          icon={"\u21C4"}
          label="Diff"
          active={activeView === "diff"}
          onClick={() => setView("diff")}
        />
        <NavItem
          icon={"\u2714"}
          label="Lint"
          active={activeView === "lint"}
          onClick={() => setView("lint")}
          badge={lintErrorCount > 0 ? String(lintErrorCount) : undefined}
          badgeColor={theme.red}
        />
        <NavItem
          icon={"\u2315"}
          label="Scan"
          active={activeView === "scan"}
          onClick={() => setView("scan")}
          badge={scanIssueCount > 0 ? String(scanIssueCount) : undefined}
          badgeColor={theme.yellow}
        />
        <NavItem
          icon={"\u2B06"}
          label="Import"
          active={activeView === "import"}
          onClick={() => setView("import")}
        />
        <NavItem
          icon={"\u2662"}
          label="Recipients"
          active={activeView === "recipients"}
          onClick={() => setView("recipients")}
        />
        <NavItem
          icon={"\u2699"}
          label="Service IDs"
          active={activeView === "identities"}
          onClick={() => setView("identities")}
          badge={
            manifest?.service_identities?.length
              ? String(manifest.service_identities.length)
              : undefined
          }
          badgeColor={theme.purple}
        />
        <NavItem
          icon={"\u21BB"}
          label="Backend"
          active={activeView === "backend"}
          onClick={() => setView("backend")}
        />
        <NavItem
          icon={"\u2630"}
          label="Manifest"
          active={activeView === "manifest"}
          onClick={() => setView("manifest")}
        />
        <NavItem
          icon={"\u23F1"}
          label="History"
          active={activeView === "history"}
          onClick={() => setView("history")}
        />

        <div style={{ marginTop: 20, marginBottom: 6, padding: "0 8px" }}>
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 10,
              fontWeight: 600,
              color: theme.textDim,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Namespaces
          </span>
        </div>

        {namespaces.map((ns) => {
          const hasIssue = matrixStatuses.some(
            (s) => s.cell.namespace === ns.name && s.issues.length > 0,
          );
          return (
            <NavItem
              key={ns.name}
              icon={
                <span
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 10,
                    color: theme.textMuted,
                  }}
                >
                  //
                </span>
              }
              label={ns.name}
              active={activeView === "editor" && activeNs === ns.name}
              onClick={() => {
                setView("editor");
                setNs(ns.name);
              }}
              badge={hasIssue ? "!" : undefined}
              badgeColor={theme.yellow}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${theme.border}` }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: theme.textMuted,
          }}
        >
          <span style={{ fontFamily: theme.mono, fontSize: 10 }}>
            {uncommittedCount} uncommitted
          </span>
        </div>
        <div style={{ marginTop: 5 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: theme.green,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: theme.green,
                boxShadow: `0 0 5px ${theme.green}`,
              }}
            />
            <span style={{ fontFamily: theme.mono, fontSize: 10 }}>
              {manifest?.sops.default_backend ?? "age"} key loaded
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}

function NavItem({ icon, label, active, onClick, badge, badgeColor }: NavItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`nav-${label.toLowerCase()}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? theme.accentDim : "transparent",
        border: active ? `1px solid ${theme.accent}22` : "1px solid transparent",
        marginBottom: 2,
        transition: "all 0.12s",
        position: "relative",
      }}
    >
      <span
        style={{
          color: active ? theme.accent : theme.textMuted,
          display: "flex",
          alignItems: "center",
          width: 14,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: theme.sans,
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? theme.accent : theme.text,
          flex: 1,
        }}
      >
        {label}
      </span>
      {badge && badgeColor && (
        <span
          style={{
            fontFamily: theme.mono,
            fontSize: 9,
            fontWeight: 700,
            color: badgeColor,
            background: `${badgeColor}20`,
            border: `1px solid ${badgeColor}44`,
            borderRadius: 3,
            padding: "1px 5px",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
