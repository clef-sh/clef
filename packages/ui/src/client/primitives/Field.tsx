import React from "react";
import { Input, Textarea } from "./Input";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children?: React.ReactNode;
  htmlFor?: string;
}

export interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function FieldLabel({ required, className, children, ...rest }: FieldLabelProps) {
  return (
    <label
      className={joinClasses(
        "font-sans text-[11px] font-medium text-ash uppercase tracking-[0.08em]",
        className,
      )}
      {...rest}
    >
      {children}
      {required ? <span className="text-stop-500"> *</span> : null}
    </label>
  );
}

export interface FieldHintProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function FieldHint({ className, children, ...rest }: FieldHintProps) {
  return (
    <div className={joinClasses("font-sans text-[11px] text-ash-dim mt-1", className)} {...rest}>
      {children}
    </div>
  );
}

export interface FieldErrorProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

function FieldError({ className, children, ...rest }: FieldErrorProps) {
  return (
    <div
      role="alert"
      className={joinClasses("font-sans text-[11px] text-stop-500 mt-1", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

const FieldRoot = React.forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, required, className, children, htmlFor, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={joinClasses("flex flex-col gap-1.5", className)} {...rest}>
      <FieldLabel required={required} htmlFor={htmlFor}>
        {label}
      </FieldLabel>
      <div>{children}</div>
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
});

type FieldCompound = typeof FieldRoot & {
  Label: typeof FieldLabel;
  Hint: typeof FieldHint;
  Error: typeof FieldError;
};

const Field = FieldRoot as FieldCompound;
Field.Label = FieldLabel;
Field.Hint = FieldHint;
Field.Error = FieldError;

export { Field, Input, Textarea };
