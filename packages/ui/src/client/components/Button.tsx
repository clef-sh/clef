import React from "react";
import { theme } from "../theme";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
  icon?: React.ReactNode;
  type?: "button" | "submit";
}

const VARIANT_STYLES = {
  primary: { bg: theme.accent, color: "#000", border: "none" },
  ghost: { bg: "transparent", color: theme.textMuted, border: `1px solid ${theme.border}` },
  danger: { bg: theme.redDim, color: theme.red, border: `1px solid ${theme.red}44` },
};

export function Button({
  children,
  variant = "ghost",
  onClick,
  icon,
  type = "button",
  style: _styleProp,
  ...rest
}: ButtonProps) {
  const s = VARIANT_STYLES[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      {...rest}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 6,
        cursor: "pointer",
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        border: s.border,
        transition: "all 0.12s",
      }}
    >
      {icon && <span style={{ display: "flex" }}>{icon}</span>}
      {children}
    </button>
  );
}
