/**
 * Read the composed source's capability descriptor from
 * `GET /api/capabilities` and return a `{ data, loading, error }` shape
 * for components that gate UI on trait support (e.g. hiding the
 * "Migrate backend" button when `migrate` is false).
 *
 * The endpoint mirrors `describeCapabilities(source)` from
 * `@clef-sh/core` — every field is a boolean. New traits added on the
 * core side surface here automatically as long as the field is present
 * in `SourceCapabilities`.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export interface SourceCapabilitiesView {
  lint: boolean;
  rotate: boolean;
  recipients: boolean;
  merge: boolean;
  migrate: boolean;
  bulk: boolean;
  structural: boolean;
}

export interface CapabilitiesState {
  data: SourceCapabilitiesView | null;
  loading: boolean;
  error: string | null;
}

export function useCapabilities(): CapabilitiesState {
  const [state, setState] = useState<CapabilitiesState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/capabilities");
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState({ data: null, loading: false, error: body.error ?? `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as SourceCapabilitiesView;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load capabilities",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
