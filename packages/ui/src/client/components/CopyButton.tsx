import React, { useState, useCallback } from "react";
import { theme } from "../theme";

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
      style={{
        background: copied ? theme.greenDim : "none",
        border: `1px solid ${copied ? theme.green + "55" : theme.borderLight}`,
        borderRadius: 4,
        cursor: "pointer",
        color: copied ? theme.green : theme.textDim,
        fontFamily: theme.mono,
        fontSize: 10,
        padding: "2px 8px",
        transition: "all 0.15s",
      }}
    >
      {copied ? "copied!" : "copy"}
    </button>
  );
}
