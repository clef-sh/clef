import React from "react";

const INPUT_BASE =
  "w-full bg-ink-950 border border-edge rounded-md px-2.5 py-1.5 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim disabled:text-ash-dim disabled:bg-ink-900";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={joinClasses(INPUT_BASE, className)} {...rest} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={joinClasses(INPUT_BASE, className)} {...rest} />;
});
