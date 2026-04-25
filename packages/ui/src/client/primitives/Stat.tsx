import React from "react";

export type StatTone = "default" | "go" | "warn" | "stop" | "gold";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  tone?: StatTone;
  icon?: React.ReactNode;
  className?: string;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const TONE_BAR: Record<StatTone, string> = {
  default: "bg-ash-deep",
  go: "bg-go-500",
  warn: "bg-warn-500",
  stop: "bg-stop-500",
  gold: "bg-gold-500",
};

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, tone = "default", icon, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-tone={tone}
      className={joinClasses(
        "bg-ink-850 border border-edge rounded-card p-4 relative overflow-hidden",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={joinClasses("absolute inset-y-0 left-0 w-[3px]", TONE_BAR[tone])}
      />
      <div className="flex items-start justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ash-dim">
          {label}
        </div>
        {icon ? <div className="text-ash-dim">{icon}</div> : null}
      </div>
      <div className="font-mono text-[28px] text-bone mt-2">{value}</div>
    </div>
  );
});
