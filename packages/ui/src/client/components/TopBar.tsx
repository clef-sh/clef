import React from "react";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * @deprecated Prefer the `<Toolbar>` primitive from `../primitives`. This
 * thin wrapper exists for back-compat — every screen has migrated to
 * `<Toolbar>`, but `TopBar` is still part of the public `@clef-sh/ui`
 * client-lib export, so external consumers of the package may rely on it.
 */
export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <div className="flex h-[54px] shrink-0 items-center gap-4 border-b border-edge px-6">
      <div className="flex-1">
        <div className="font-sans text-[14px] font-semibold text-bone">{title}</div>
        {subtitle && <div className="mt-px font-mono text-[10px] text-ash">{subtitle}</div>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}
