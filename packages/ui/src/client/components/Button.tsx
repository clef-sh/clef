import React from "react";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
  icon?: React.ReactNode;
  type?: "button" | "submit";
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-gold-500 text-ink-950 border border-transparent hover:bg-gold-400",
  ghost: "bg-transparent text-bone border border-edge-strong hover:bg-ink-800",
  danger: "bg-stop-500/15 text-stop-500 border border-stop-500/40 hover:bg-stop-500/25",
};

export function Button({
  children,
  variant = "ghost",
  onClick,
  icon,
  type = "button",
  className,
  style: _styleProp,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      {...rest}
      className={[
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-sans text-[12px] font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASSES[variant],
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {icon && <span className="flex">{icon}</span>}
      {children}
    </button>
  );
}
