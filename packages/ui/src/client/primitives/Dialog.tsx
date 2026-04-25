import React, { useEffect } from "react";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

function DialogRoot({ open, onClose, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="dialog-scrim"
      className="fixed inset-0 z-50 bg-[rgba(4,5,8,0.72)] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-ink-850 border border-edge rounded-card shadow-plate w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export interface DialogTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function DialogTitle({ className, children, ...rest }: DialogTitleProps) {
  return (
    <div
      className={joinClasses("font-sans text-[15px] font-semibold text-bone mb-3", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface DialogBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function DialogBody({ className, children, ...rest }: DialogBodyProps) {
  return (
    <div className={joinClasses("font-sans text-[13px] text-bone", className)} {...rest}>
      {children}
    </div>
  );
}

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function DialogFooter({ className, children, ...rest }: DialogFooterProps) {
  return (
    <div className={joinClasses("flex gap-2 justify-end mt-4", className)} {...rest}>
      {children}
    </div>
  );
}

type DialogCompound = typeof DialogRoot & {
  Title: typeof DialogTitle;
  Body: typeof DialogBody;
  Footer: typeof DialogFooter;
};

const Dialog = DialogRoot as DialogCompound;
Dialog.Title = DialogTitle;
Dialog.Body = DialogBody;
Dialog.Footer = DialogFooter;

export { Dialog };
