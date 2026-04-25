import React from "react";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, body, action, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        "flex flex-col items-center justify-center border border-dashed border-edge rounded-md p-6 text-center",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <div className="text-ash-dim mb-3 text-[32px] leading-none" aria-hidden>
          {icon}
        </div>
      ) : null}
      <div className="font-sans text-[13px] font-semibold text-bone">{title}</div>
      {body ? <div className="font-sans text-[12px] text-ash-dim mt-1">{body}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
});
