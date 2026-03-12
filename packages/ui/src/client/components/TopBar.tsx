import React from "react";
import { theme } from "../theme";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <div
      style={{
        height: 54,
        borderBottom: `1px solid ${theme.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: theme.sans,
            fontWeight: 600,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 10,
              color: theme.textMuted,
              marginTop: 1,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>{actions}</div>
    </div>
  );
}
