import React from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  FileText,
  Hash,
  KeyRound,
  LayoutGrid,
  Mail,
  RefreshCw,
  RotateCcw,
  Scale,
  ScanSearch,
  Table2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ClefManifest, MatrixStatus, GitStatus as GitStatusType } from "@clef-sh/core";

export type ViewName =
  | "matrix"
  | "editor"
  | "schema"
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

type BadgeTone = "stop" | "warn" | "purple";

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
    // Fixed viewport height (not minHeight) so the flex column can actually
    // clip overflow. Paired with overflow-y-auto on the nav block below, this
    // lets the middle section scroll when the list grows or the user zooms in,
    // while the logo and footer stay pinned.
    <div className="flex h-screen w-[220px] shrink-0 flex-col border-r border-edge bg-ink-850">
      <div className="flex items-center gap-2.5 border-b border-edge px-5 pt-5 pb-4">
        <clef-wordmark size={28} />
        <div className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-ash">
          {manifest?.sops.default_backend ?? "local"} / main
        </div>
      </div>

      {/* min-h-0 is the standard flex quirk — without it, a flex child's
          scrollable content never shrinks below its intrinsic size, so
          overflow-y-auto would never actually clip. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        <NavItem
          icon={LayoutGrid}
          label="Matrix"
          active={activeView === "matrix"}
          onClick={() => setView("matrix")}
        />
        <NavItem
          icon={ArrowLeftRight}
          label="Diff"
          active={activeView === "diff"}
          onClick={() => setView("diff")}
        />
        <NavItem
          icon={CheckCircle2}
          label="Lint"
          active={activeView === "lint"}
          onClick={() => setView("lint")}
          badge={lintErrorCount > 0 ? String(lintErrorCount) : undefined}
          badgeTone="stop"
        />
        <NavItem
          icon={ScanSearch}
          label="Scan"
          active={activeView === "scan"}
          onClick={() => setView("scan")}
          badge={scanIssueCount > 0 ? String(scanIssueCount) : undefined}
          badgeTone="warn"
        />
        <NavItem
          icon={Table2}
          label="Schema"
          active={activeView === "schema"}
          onClick={() => setView("schema")}
        />
        <NavItem
          icon={Scale}
          label="Policy"
          active={activeView === "policy"}
          onClick={() => setView("policy")}
          badge={policyOverdueCount > 0 ? String(policyOverdueCount) : undefined}
          badgeTone="stop"
        />
        <NavItem
          icon={Upload}
          label="Import"
          active={activeView === "import"}
          onClick={() => setView("import")}
        />
        <NavItem
          icon={Users}
          label="Recipients"
          active={activeView === "recipients"}
          onClick={() => setView("recipients")}
        />
        <NavItem
          icon={KeyRound}
          label="Service IDs"
          active={activeView === "identities"}
          onClick={() => setView("identities")}
          badge={
            manifest?.service_identities?.length
              ? String(manifest.service_identities.length)
              : undefined
          }
          badgeTone="purple"
        />
        <NavItem
          icon={RefreshCw}
          label="Backend"
          active={activeView === "backend"}
          onClick={() => setView("backend")}
        />
        <NavItem
          icon={RotateCcw}
          label="Reset"
          active={activeView === "reset"}
          onClick={() => setView("reset")}
        />
        <NavItem
          icon={FileText}
          label="Manifest"
          active={activeView === "manifest"}
          onClick={() => setView("manifest")}
        />
        <NavItem
          icon={Mail}
          label="Envelope"
          active={activeView === "envelope"}
          onClick={() => setView("envelope")}
        />
        <NavItem
          icon={Clock}
          label="History"
          active={activeView === "history"}
          onClick={() => setView("history")}
        />

        <div className="mt-5 mb-1.5 px-2">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ash-deep">
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
              icon={Hash}
              label={ns.name}
              active={activeView === "editor" && activeNs === ns.name}
              onClick={() => {
                setView("editor");
                setNs(ns.name);
              }}
              badge={hasIssue ? "!" : undefined}
              badgeTone="warn"
            />
          );
        })}
      </div>

      <div className="border-t border-edge px-4 py-3">
        <div className="flex items-center gap-1.5 text-ash">
          <span className="font-mono text-[10px]">{uncommittedCount} uncommitted</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-go-500">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-go-500 shadow-[0_0_5px_var(--color-go-500)]" />
          <span className="font-mono text-[10px]">
            {manifest?.sops.default_backend ?? "age"} key loaded
          </span>
        </div>
      </div>
    </div>
  );
}

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeTone?: BadgeTone;
}

function NavItem({ icon: Icon, label, active, onClick, badge, badgeTone = "warn" }: NavItemProps) {
  // Active-state treatment is the design-review polish item: 4px gold left
  // rail + gold-500/10 fill + gold-500 text + bold weight. Inactive items get
  // a true hover state (bg-ink-800) so the row feels alive on cursor entry —
  // pre-Phase-3 every nav item was plateau-flat.
  const base =
    "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 mb-0.5 cursor-pointer transition-colors";
  const stateClasses = active
    ? "bg-gold-500/10 text-gold-500 font-semibold border-l-4 border-gold-500 pl-[6px]"
    : "border-l-4 border-transparent text-bone hover:bg-ink-800";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`nav-${label.toLowerCase()}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      className={`${base} ${stateClasses}`}
    >
      <Icon
        size={14}
        strokeWidth={1.75}
        className={active ? "text-gold-500" : "text-ash"}
        aria-hidden="true"
      />
      <span className="flex-1 font-sans text-[13px]">{label}</span>
      {badge && <NavBadge tone={badgeTone}>{badge}</NavBadge>}
    </div>
  );
}

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  stop: "text-stop-500 bg-stop-500/15 border-stop-500/40",
  warn: "text-warn-500 bg-warn-500/15 border-warn-500/40",
  purple: "text-purple-400 bg-purple-400/15 border-purple-400/40",
};

function NavBadge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-px font-mono text-[9px] font-bold ${BADGE_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
