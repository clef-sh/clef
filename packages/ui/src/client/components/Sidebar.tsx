import React from "react";
import { theme } from "../theme";
import type { ClefManifest, MatrixStatus, GitStatus as GitStatusType } from "@clef-sh/core";

export type ViewName =
  | "matrix"
  | "editor"
  | "diff"
  | "lint"
  | "scan"
  | "policy"
  | "import"
  | "recipients"
  | "identities"
  | "backend"
  | "reset"
  | "history"
  | "manifest"
  | "envelope";

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
  policyOverdueCount: number;
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
  policyOverdueCount,
}: SidebarProps) {
  const uncommittedCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  const namespaces = manifest?.namespaces ?? [];

  return (
    <div
      style={{
        width: 220,
        // Fixed viewport height (not minHeight) so the flex column can
        // actually clip overflow.  Paired with overflowY: auto on the nav
        // block below, this lets the middle section scroll when the list
        // grows or the user zooms in, while the logo and footer stay pinned.
        height: "100vh",
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
          }}
          aria-hidden="true"
        >
          <ClefGlyph size={16} />
        </div>
        <div>
          <div
            style={{
              fontFamily: theme.mono,
              fontWeight: 700,
              fontSize: 18,
              color: theme.text,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            Clef
          </div>
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 9,
              color: theme.textMuted,
              marginTop: 4,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {manifest?.sops.default_backend ?? "local"} / main
          </div>
        </div>
      </div>

      {/* Nav */}
      <div
        style={{
          padding: "12px 10px",
          flex: 1,
          // minHeight: 0 is the standard flex quirk — without it, a flex
          // child's scrollable content never shrinks below its intrinsic
          // size, so overflowY: auto would never actually clip.
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
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
          icon={"\u2696"}
          label="Policy"
          active={activeView === "policy"}
          onClick={() => setView("policy")}
          badge={policyOverdueCount > 0 ? String(policyOverdueCount) : undefined}
          badgeColor={theme.red}
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
          icon={"\u2421"}
          label="Reset"
          active={activeView === "reset"}
          onClick={() => setView("reset")}
        />
        <NavItem
          icon={"\u2630"}
          label="Manifest"
          active={activeView === "manifest"}
          onClick={() => setView("manifest")}
        />
        <NavItem
          icon={"\u2709"}
          label="Envelope"
          active={activeView === "envelope"}
          onClick={() => setView("envelope")}
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

/**
 * Treble clef glyph matching the Cloud app's brand mark. The path comes from
 * cloud/static/app/src/app/components/sidebar/sidebar.ts — shared so the three
 * surfaces render the same brand symbol.
 */
function ClefGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -0.0004 15.19 40.77"
      width={Math.round(size * 0.45)}
      height={size}
      fill={theme.accent}
      style={{ filter: `drop-shadow(0 0 8px ${theme.accent}55)` }}
    >
      <path d="m12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z" />
    </svg>
  );
}
