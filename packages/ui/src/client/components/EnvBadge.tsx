import React from "react";
import { theme, ENV_COLORS } from "../theme";

interface EnvBadgeProps {
  env: string;
  small?: boolean;
}

export function EnvBadge({ env, small }: EnvBadgeProps) {
  const c = ENV_COLORS[env] ?? {
    color: theme.textMuted,
    bg: "transparent",
    label: env.toUpperCase().slice(0, 3),
  };
  return (
    <span
      style={{
        fontFamily: theme.mono,
        fontSize: small ? "9px" : "10px",
        fontWeight: 700,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.color}33`,
        borderRadius: "3px",
        padding: small ? "1px 5px" : "2px 7px",
        letterSpacing: "0.08em",
      }}
    >
      {c.label}
    </span>
  );
}
