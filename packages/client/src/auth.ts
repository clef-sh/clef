import { ClefClientError } from "./types";

/**
 * Resolve a service token from an explicit value or CLEF_SERVICE_TOKEN env var.
 */
export function resolveToken(explicit?: string): string {
  if (explicit) return explicit;

  if (typeof process !== "undefined" && process.env?.CLEF_SERVICE_TOKEN) {
    return process.env.CLEF_SERVICE_TOKEN;
  }

  throw new ClefClientError(
    "No service token configured",
    undefined,
    "Set CLEF_SERVICE_TOKEN or pass token in options.",
  );
}

/**
 * Resolve the serve endpoint from an explicit value or CLEF_ENDPOINT env var.
 */
export function resolveEndpoint(explicit?: string): string {
  if (explicit) return explicit;

  if (typeof process !== "undefined" && process.env?.CLEF_ENDPOINT) {
    return process.env.CLEF_ENDPOINT;
  }

  return "http://127.0.0.1:7779";
}
