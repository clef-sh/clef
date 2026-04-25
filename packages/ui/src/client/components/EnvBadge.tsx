import React from "react";

interface EnvBadgeProps {
  env: string;
  small?: boolean;
}

// Per-env color set. Mirrors `ENV_COLORS` from the design tokens but expressed
// as Tailwind class strings so we don't pay the inline-style cost. The unknown
// fallback ("ash") is also handled here.
const ENV_CLASSES: Record<string, { text: string; bg: string; border: string; label: string }> = {
  dev: {
    text: "text-go-500",
    bg: "bg-go-500/10",
    border: "border-go-500/20",
    label: "DEV",
  },
  staging: {
    text: "text-warn-500",
    bg: "bg-warn-500/10",
    border: "border-warn-500/20",
    label: "STG",
  },
  production: {
    text: "text-stop-500",
    bg: "bg-stop-500/10",
    border: "border-stop-500/20",
    label: "PRD",
  },
};

export function EnvBadge({ env, small }: EnvBadgeProps) {
  const c = ENV_CLASSES[env] ?? {
    text: "text-ash",
    bg: "bg-transparent",
    border: "border-ash/20",
    label: env.toUpperCase().slice(0, 3),
  };
  const sizeClasses = small ? "text-[9px] px-1.5 py-px" : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`inline-block rounded-sm border font-mono font-bold tracking-[0.08em] ${c.text} ${c.bg} ${c.border} ${sizeClasses}`}
    >
      {c.label}
    </span>
  );
}
