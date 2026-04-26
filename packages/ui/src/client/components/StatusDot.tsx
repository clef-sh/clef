import React from "react";

interface StatusDotProps {
  status: string;
}

// Tailwind class sets per status. The shadow is a `shadow-[...]` arbitrary
// value because Tailwind's preset shadow scale doesn't include
// "soft glow at 53% opacity"; that's the canonical halo this component shows.
const STATUS_CLASSES: Record<string, string> = {
  ok: "bg-go-500 shadow-[0_0_6px_rgb(52_211_153_/_0.53)]",
  missing_keys: "bg-stop-500 shadow-[0_0_6px_rgb(248_113_113_/_0.53)]",
  schema_warn: "bg-warn-500 shadow-[0_0_6px_rgb(251_191_36_/_0.53)]",
  sops_error: "bg-stop-500 shadow-[0_0_6px_rgb(248_113_113_/_0.53)]",
};

export function StatusDot({ status }: StatusDotProps) {
  const tone = STATUS_CLASSES[status] ?? "bg-ash shadow-[0_0_6px_rgb(155_163_183_/_0.53)]";
  return (
    <span
      data-testid="status-dot"
      className={`inline-block h-[7px] w-[7px] rounded-full ${tone}`}
    />
  );
}
