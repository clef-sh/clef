import React from "react";

type CardTone = "default" | "error";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  interactive?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = "default", interactive = false, className, children, ...rest },
  ref,
) {
  const base = "bg-ink-850 border rounded-card";
  const borderTone = tone === "error" ? "border-stop-500/40" : "border-edge";
  const interactiveClasses = interactive
    ? "transition-shadow transition-colors hover:border-edge-strong hover:shadow-soft-drop"
    : "";
  return (
    <div
      ref={ref}
      className={joinClasses(base, borderTone, interactiveClasses, className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

function CardHeader({ title, subtitle, actions, className, ...rest }: CardHeaderProps) {
  return (
    <div
      className={joinClasses(
        "flex items-center justify-between px-4 py-3 border-b border-edge",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0">
        <div className="font-sans text-[13px] font-bold text-bone">{title}</div>
        {subtitle ? (
          <div className="font-mono text-[10px] text-ash-dim mt-0.5">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function CardBody({ className, children, ...rest }: CardBodyProps) {
  return (
    <div className={joinClasses("p-4", className)} {...rest}>
      {children}
    </div>
  );
}

type CardCompound = typeof CardRoot & {
  Header: typeof CardHeader;
  Body: typeof CardBody;
};

const Card = CardRoot as CardCompound;
Card.Header = CardHeader;
Card.Body = CardBody;

export { Card };
