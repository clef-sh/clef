import React from "react";

export type BadgeTone = "default" | "go" | "warn" | "stop" | "gold" | "blue" | "purple";

export type BadgeVariant = "solid" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  className?: string;
  children?: React.ReactNode;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function toneClasses(tone: BadgeTone, variant: BadgeVariant): string {
  // For each tone we return the class string for the chosen variant.
  switch (tone) {
    case "go":
      return variant === "solid"
        ? "bg-go-500/15 text-go-500 border border-transparent"
        : "border border-go-500/40 text-go-500";
    case "warn":
      return variant === "solid"
        ? "bg-warn-500/15 text-warn-500 border border-transparent"
        : "border border-warn-500/40 text-warn-500";
    case "stop":
      return variant === "solid"
        ? "bg-stop-500/15 text-stop-500 border border-transparent"
        : "border border-stop-500/40 text-stop-500";
    case "gold":
      return variant === "solid"
        ? "bg-gold-500/15 text-gold-500 border border-transparent"
        : "border border-gold-500/40 text-gold-500";
    case "blue":
      return variant === "solid"
        ? "bg-blue-400/15 text-blue-400 border border-transparent"
        : "border border-blue-400/40 text-blue-400";
    case "purple":
      return variant === "solid"
        ? "bg-purple-400/15 text-purple-400 border border-transparent"
        : "border border-purple-400/40 text-purple-400";
    case "default":
    default:
      return variant === "solid"
        ? "bg-edge text-ash border border-transparent"
        : "border border-edge text-ash-dim";
  }
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "default", variant = "outline", className, children, ...rest },
  ref,
) {
  const base =
    "inline-flex items-center font-mono text-[9px] font-bold uppercase tracking-[0.08em] rounded-sm px-1.5 py-0.5";
  return (
    <span ref={ref} className={joinClasses(base, toneClasses(tone, variant), className)} {...rest}>
      {children}
    </span>
  );
});
