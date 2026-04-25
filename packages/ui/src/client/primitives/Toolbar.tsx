import React from "react";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

const ToolbarRoot = React.forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        "flex items-center justify-between px-7 py-5 border-b border-edge bg-ink-900",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface ToolbarTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
  children?: React.ReactNode;
}

function ToolbarTitle({ className, children, ...rest }: ToolbarTitleProps) {
  return (
    <h1
      className={joinClasses(
        "text-[20px] font-semibold text-bone tracking-[-0.015em] m-0",
        className,
      )}
      {...rest}
    >
      {children}
    </h1>
  );
}

export interface ToolbarSubtitleProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function ToolbarSubtitle({ className, children, ...rest }: ToolbarSubtitleProps) {
  return (
    <div className={joinClasses("font-mono text-[11px] text-ash-dim", className)} {...rest}>
      {children}
    </div>
  );
}

export interface ToolbarActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function ToolbarActions({ className, children, ...rest }: ToolbarActionsProps) {
  return (
    <div className={joinClasses("flex gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

type ToolbarCompound = typeof ToolbarRoot & {
  Title: typeof ToolbarTitle;
  Subtitle: typeof ToolbarSubtitle;
  Actions: typeof ToolbarActions;
};

const Toolbar = ToolbarRoot as ToolbarCompound;
Toolbar.Title = ToolbarTitle;
Toolbar.Subtitle = ToolbarSubtitle;
Toolbar.Actions = ToolbarActions;

export { Toolbar };
