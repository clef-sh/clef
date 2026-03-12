import React from "react";
import { theme } from "../theme";

interface StatusDotProps {
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  ok: theme.green,
  missing_keys: theme.red,
  schema_warn: theme.yellow,
  sops_error: theme.red,
};

export function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? theme.textMuted;
  return (
    <span
      data-testid="status-dot"
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}88`,
      }}
    />
  );
}
