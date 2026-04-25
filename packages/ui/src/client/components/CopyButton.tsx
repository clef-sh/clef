import React, { useState, useCallback } from "react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [text]);

  return (
    <button
      data-testid="copy-button"
      onClick={handleCopy}
      className={`cursor-pointer rounded-sm border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        copied
          ? "border-go-500/40 bg-go-500/10 text-go-500"
          : "border-edge-strong bg-transparent text-ash-dim hover:bg-ink-800"
      }`}
    >
      {copied ? "copied!" : "copy"}
    </button>
  );
}
