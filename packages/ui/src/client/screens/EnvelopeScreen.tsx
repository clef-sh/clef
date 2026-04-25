import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { Toolbar } from "../primitives";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import type { DecryptResult, InspectResult, SignatureStatus, VerifyResult } from "@clef-sh/core";

// Mirrors the server-side shape from packages/ui/src/server/envelope.ts.
// We inline the TS type here instead of importing because the server file
// is not an exported package entry, and the shape is small enough that a
// duplicated interface is clearer than a cross-package import.
interface EnvelopeConfig {
  ageIdentity: {
    configured: boolean;
    source: "CLEF_AGE_KEY_FILE" | "CLEF_AGE_KEY" | null;
    path: string | null;
  };
  aws: { hasCredentials: boolean; profile: string | null };
}

// Must match `formatRevealWarning` in @clef-sh/core/envelope-debug/warnings.
// We re-format client-side instead of calling the core helper because the
// warning is UI chrome, not a data contract — the test pins the literal.
function revealWarningText(singleKey?: string): string {
  if (singleKey) {
    return `value for key "${singleKey}" will be printed in this window until the reveal timer expires`;
  }
  return "all decrypted values will be printed in this window until the reveal timer expires";
}

// Short on purpose: the envelope debugger is for momentary peeks during
// triage (paste artifact, glance at value, move on), not editing — there's
// no workflow that needs the value visible for minutes at a time, and a
// long visible window is the bigger risk on a shared screen.
const REVEAL_TIMEOUT_MS = 15 * 1000;

const TEXTAREA_BASE =
  "w-full bg-ink-950 text-bone border border-edge-strong rounded-md outline-none font-mono focus-visible:border-gold-500";

export function EnvelopeScreen() {
  // Paste + inspect
  const [rawJson, setRawJson] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inspect, setInspect] = useState<InspectResult | null>(null);

  // Verify
  const [signerKey, setSignerKey] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  // Decrypt
  const [decrypt, setDecrypt] = useState<DecryptResult | null>(null);
  const [decryptLoading, setDecryptLoading] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [revealDeadline, setRevealDeadline] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Config
  const [config, setConfig] = useState<EnvelopeConfig | null>(null);

  // Bring up the server-side config on mount so the Decrypt card knows what
  // identity is available before the user even pastes.
  useEffect(() => {
    apiFetch("/api/envelope/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setConfig(data))
      .catch(() => setConfig(null));
  }, []);

  // Drive the countdown banner. Interval only runs while a reveal is active.
  useEffect(() => {
    if (!revealDeadline) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [revealDeadline]);

  // Clean up the auto-clear timer on unmount.
  useEffect(() => () => clearTimeout(revealTimeoutRef.current), []);

  const scheduleAutoClear = useCallback(() => {
    clearTimeout(revealTimeoutRef.current);
    const deadline = Date.now() + REVEAL_TIMEOUT_MS;
    setRevealDeadline(deadline);
    setNow(Date.now());
    revealTimeoutRef.current = setTimeout(() => {
      setRevealedKeys({});
      setRevealDeadline(null);
    }, REVEAL_TIMEOUT_MS);
  }, []);

  const resetEnvelopeState = useCallback(() => {
    clearTimeout(revealTimeoutRef.current);
    setInspect(null);
    setVerify(null);
    setDecrypt(null);
    setRevealedKeys({});
    setRevealDeadline(null);
    setSignerKey("");
  }, []);

  const handleLoad = useCallback(async () => {
    if (!rawJson.trim()) return;
    setLoading(true);
    resetEnvelopeState();
    try {
      const res = await apiFetch("/api/envelope/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawJson }),
      });
      if (!res.ok) {
        setInspect(null);
        setLoaded(false);
        return;
      }
      const data = (await res.json()) as InspectResult;
      setInspect(data);
      setLoaded(!data.error);
    } catch {
      setInspect(null);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [rawJson, resetEnvelopeState]);

  const handleVerify = useCallback(async () => {
    if (!loaded) return;
    setVerifyLoading(true);
    try {
      const res = await apiFetch("/api/envelope/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawJson, signerKey: signerKey || undefined }),
      });
      const data = (await res.json()) as VerifyResult;
      setVerify(data);
    } catch {
      setVerify(null);
    } finally {
      setVerifyLoading(false);
    }
  }, [loaded, rawJson, signerKey]);

  const handleDecryptKeys = useCallback(async () => {
    if (!loaded) return;
    setDecryptLoading(true);
    try {
      const res = await apiFetch("/api/envelope/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawJson }),
      });
      const data = (await res.json()) as DecryptResult;
      setDecrypt(data);
      setRevealedKeys({});
      setRevealDeadline(null);
    } catch {
      setDecrypt(null);
    } finally {
      setDecryptLoading(false);
    }
  }, [loaded, rawJson]);

  const handleRevealAll = useCallback(async () => {
    if (!loaded) return;
    setDecryptLoading(true);
    try {
      const res = await apiFetch("/api/envelope/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawJson, reveal: true }),
      });
      const data = (await res.json()) as DecryptResult;
      setDecrypt(data);
      if (data.values) {
        setRevealedKeys(data.values);
        scheduleAutoClear();
      }
    } catch {
      // Keep previous state — network failure shouldn't clear prior keys list.
    } finally {
      setDecryptLoading(false);
    }
  }, [loaded, rawJson, scheduleAutoClear]);

  const handleRevealOne = useCallback(
    async (key: string) => {
      if (!loaded) return;
      try {
        const res = await apiFetch("/api/envelope/decrypt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: rawJson, key }),
        });
        const data = (await res.json()) as DecryptResult;
        if (!data.error && data.values && key in data.values) {
          setRevealedKeys((prev) => ({ ...prev, [key]: data.values![key] }));
          scheduleAutoClear();
        }
      } catch {
        // Swallow — row stays hidden on failure.
      }
    },
    [loaded, rawJson, scheduleAutoClear],
  );

  const handleHideOne = useCallback((key: string) => {
    setRevealedKeys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleExportJson = useCallback(() => {
    // Client-side download — server never touches the filesystem for this.
    const blob = new Blob([JSON.stringify(revealedKeys, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "envelope-revealed.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [revealedKeys]);

  const anyRevealed = Object.keys(revealedKeys).length > 0;
  const singleKeyRevealed =
    Object.keys(revealedKeys).length === 1 ? Object.keys(revealedKeys)[0] : undefined;

  const countdownMs = revealDeadline ? Math.max(0, revealDeadline - now) : 0;
  const countdown = useMemo(() => formatCountdown(countdownMs), [countdownMs]);

  const rawSnapshot = useMemo(() => {
    const parts: Record<string, unknown> = {};
    if (inspect) parts.inspect = inspect;
    if (verify) parts.verify = verify;
    if (decrypt) parts.decrypt = decrypt;
    return Object.keys(parts).length > 0 ? JSON.stringify(parts, null, 2) : null;
  }, [inspect, verify, decrypt]);

  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Envelope Debugger</Toolbar.Title>
          <Toolbar.Subtitle>paste a packed artifact — inspect, verify, decrypt</Toolbar.Subtitle>
        </div>
        {rawSnapshot ? (
          <Toolbar.Actions>
            <Button onClick={() => setShowRawJson((s) => !s)}>
              {showRawJson ? "Hide raw JSON" : "View raw JSON"}
            </Button>
          </Toolbar.Actions>
        ) : null}
      </Toolbar>

      <div
        className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3.5"
        data-testid="envelope-screen"
      >
        <PasteArea
          rawJson={rawJson}
          setRawJson={setRawJson}
          onLoad={handleLoad}
          loading={loading}
        />

        {inspect && <InspectCard result={inspect} />}

        {loaded && inspect && !inspect.error && (
          <VerifyCard
            signerKey={signerKey}
            setSignerKey={setSignerKey}
            onVerify={handleVerify}
            loading={verifyLoading}
            result={verify}
            signaturePresent={inspect.signature.present}
          />
        )}

        {loaded && inspect && !inspect.error && (
          <DecryptCard
            config={config}
            result={decrypt}
            loading={decryptLoading}
            onDecryptKeys={handleDecryptKeys}
            onRevealAll={handleRevealAll}
            onRevealOne={handleRevealOne}
            onHideOne={handleHideOne}
            onExportJson={handleExportJson}
            revealedKeys={revealedKeys}
            anyRevealed={anyRevealed}
            singleKeyRevealed={singleKeyRevealed}
            countdown={countdown}
          />
        )}

        {showRawJson && rawSnapshot && (
          <pre
            data-testid="raw-json"
            className="font-mono text-[11px] bg-ink-850 border border-edge rounded-lg p-3.5 text-ash max-h-[320px] overflow-y-auto"
          >
            {rawSnapshot}
          </pre>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// PasteArea
// ──────────────────────────────────────────────────────────────────────

interface PasteAreaProps {
  rawJson: string;
  setRawJson: (s: string) => void;
  onLoad: () => void;
  loading: boolean;
}

function PasteArea({ rawJson, setRawJson, onLoad, loading }: PasteAreaProps) {
  // Client-side shape validation — cheap feedback before the round-trip.
  const parseState = useMemo(() => {
    if (!rawJson.trim()) return { state: "empty" as const };
    try {
      JSON.parse(rawJson);
      const bytes = new Blob([rawJson]).size;
      return { state: "valid" as const, bytes };
    } catch {
      return { state: "invalid" as const };
    }
  }, [rawJson]);

  const statusColor =
    parseState.state === "invalid"
      ? "text-stop-500"
      : parseState.state === "valid"
        ? "text-go-500"
        : "text-ash";

  return (
    <Card title="Paste" subtitle="paste a packed envelope JSON">
      <textarea
        data-testid="envelope-paste-textarea"
        value={rawJson}
        onChange={(e) => setRawJson(e.target.value)}
        placeholder={'{ "version": 1, "identity": "...", ... }'}
        spellCheck={false}
        className={`${TEXTAREA_BASE} min-h-[120px] max-h-[280px] resize-y text-[12px] p-2.5`}
      />
      <div className="flex items-center justify-between mt-2.5">
        <span className={`font-mono text-[11px] ${statusColor}`} data-testid="paste-status">
          {parseState.state === "valid"
            ? `✓ valid (${formatBytes(parseState.bytes)})`
            : parseState.state === "invalid"
              ? "✕ invalid JSON"
              : "paste to begin"}
        </span>
        <Button
          variant="primary"
          onClick={onLoad}
          disabled={parseState.state !== "valid" || loading}
        >
          {loading ? "Loading…" : "Load"}
        </Button>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// InspectCard
// ──────────────────────────────────────────────────────────────────────

interface InspectCardProps {
  result: InspectResult;
}

function InspectCard({ result }: InspectCardProps) {
  if (result.error) {
    return (
      <Card title="Inspect" tone="error">
        <ErrorRow code={result.error.code} message={result.error.message} />
      </Card>
    );
  }

  // The type union admits nulls for error cases. We've already early-returned
  // above on result.error, so the rest of the fields are present in practice
  // — null coalesce at each site to keep TS happy rather than assert.
  const hash = result.ciphertextHash ?? "";
  const envelope = result.envelope;
  const rows: [string, React.ReactNode][] = [
    ["version", <Mono key="v">{result.version === null ? "?" : String(result.version)}</Mono>],
    ["identity", <Mono key="i">{result.identity ?? "?"}</Mono>],
    ["environment", <Mono key="e">{result.environment ?? "?"}</Mono>],
    [
      "packedAt",
      <Mono key="p">
        {result.packedAt ?? "?"}
        {result.packedAtAgeMs !== null ? ` (${formatAge(result.packedAtAgeMs)})` : ""}
      </Mono>,
    ],
    ["revision", <Mono key="r">{result.revision ?? "?"}</Mono>],
    [
      "ciphertextHash",
      <span key="ch" className="flex items-center gap-2">
        <Mono>{hash ? shortHash(hash) : "?"}</Mono>
        <StatusPill
          tone={
            result.ciphertextHashVerified === true
              ? "ok"
              : result.ciphertextHashVerified === false
                ? "fail"
                : "muted"
          }
          label={
            result.ciphertextHashVerified === true
              ? "verified"
              : result.ciphertextHashVerified === false
                ? "MISMATCH"
                : "not checked"
          }
        />
        {hash && <CopyButton text={hash} />}
      </span>,
    ],
    [
      "ciphertext bytes",
      <Mono key="cb">
        {result.ciphertextBytes === null ? "?" : String(result.ciphertextBytes)}
      </Mono>,
    ],
    [
      "envelope",
      <Mono key="env">
        {envelope ? envelope.provider : "?"}
        {envelope && envelope.kms ? `  ·  ${envelope.kms.keyId}` : ""}
      </Mono>,
    ],
    [
      "signature",
      <span key="sig" className="flex items-center gap-2">
        {result.signature.present ? (
          <>
            <Mono>{result.signature.algorithm ?? "unknown"}</Mono>
            <StatusPill tone="muted" label="run verify to check" />
          </>
        ) : (
          <StatusPill tone="muted" label="absent" />
        )}
      </span>,
    ],
    [
      "expiry",
      result.expiresAt ? (
        <span key="ex" className="flex items-center gap-2">
          <Mono>{result.expiresAt}</Mono>
          <StatusPill
            tone={result.expired ? "fail" : "ok"}
            label={result.expired ? "EXPIRED" : "ok"}
          />
        </span>
      ) : (
        <Mono key="ex">none</Mono>
      ),
    ],
    [
      "revocation",
      result.revoked ? (
        <StatusPill key="rv" tone="fail" label={`REVOKED at ${result.revokedAt ?? "?"}`} />
      ) : (
        <Mono key="rv">none</Mono>
      ),
    ],
  ];

  return (
    <Card title="Inspect" subtitle="auto-populates from the pasted JSON">
      <div className="flex flex-col gap-1.5">
        {rows.map(([label, value]) => (
          <KeyValueRow key={label} label={label} value={value} />
        ))}
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// VerifyCard
// ──────────────────────────────────────────────────────────────────────

interface VerifyCardProps {
  signerKey: string;
  setSignerKey: (s: string) => void;
  onVerify: () => void;
  loading: boolean;
  result: VerifyResult | null;
  signaturePresent: boolean;
}

function VerifyCard({
  signerKey,
  setSignerKey,
  onVerify,
  loading,
  result,
  signaturePresent,
}: VerifyCardProps) {
  const subtitle = signaturePresent
    ? "paste the signer public key (PEM or base64 DER SPKI) to verify the signature"
    : "no signature on this artifact — verify only checks hash / expiry / revocation";

  const overallClasses =
    result?.overall === "pass"
      ? "bg-go-500/15 text-go-500"
      : result?.overall === "fail"
        ? "bg-stop-500/10 text-stop-500"
        : "bg-edge text-ash";

  return (
    <Card title="Verify" subtitle={subtitle}>
      {signaturePresent && (
        <textarea
          data-testid="envelope-signer-key"
          value={signerKey}
          onChange={(e) => setSignerKey(e.target.value)}
          placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
          spellCheck={false}
          className={`${TEXTAREA_BASE} min-h-[72px] max-h-[160px] resize-y text-[11px] p-2 mb-2.5`}
        />
      )}
      <div className="flex justify-end mb-2.5">
        <Button variant="primary" onClick={onVerify} disabled={loading}>
          {loading ? "Verifying…" : "Run verify"}
        </Button>
      </div>
      {result?.error && <ErrorRow code={result.error.code} message={result.error.message} />}
      {result && !result.error && (
        <div className="flex flex-col gap-1.5">
          <CheckRow
            label="ciphertext hash"
            status={result.checks.hash.status === "ok" ? "pass" : "fail"}
            detail={result.checks.hash.status}
          />
          <CheckRow
            label="signature"
            status={mapSignatureStatus(result.checks.signature.status)}
            detail={`${result.checks.signature.status}${
              result.checks.signature.algorithm ? ` (${result.checks.signature.algorithm})` : ""
            }`}
          />
          <CheckRow
            label="expiry"
            status={
              result.checks.expiry.status === "expired"
                ? "fail"
                : result.checks.expiry.status === "absent"
                  ? "muted"
                  : "pass"
            }
            detail={result.checks.expiry.expiresAt ?? "no expiry"}
          />
          <CheckRow
            label="revocation"
            status={result.checks.revocation.status === "revoked" ? "fail" : "muted"}
            detail={result.checks.revocation.revokedAt ?? "not revoked"}
          />
          <div
            className={`mt-1.5 px-3 py-2 rounded-md font-sans text-[12px] font-bold tracking-[0.05em] ${overallClasses}`}
            data-testid="verify-overall"
          >
            OVERALL: {result.overall.toUpperCase()}
          </div>
        </div>
      )}
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// DecryptCard
// ──────────────────────────────────────────────────────────────────────

interface DecryptCardProps {
  config: EnvelopeConfig | null;
  result: DecryptResult | null;
  loading: boolean;
  onDecryptKeys: () => void;
  onRevealAll: () => void;
  onRevealOne: (key: string) => void;
  onHideOne: (key: string) => void;
  onExportJson: () => void;
  revealedKeys: Record<string, string>;
  anyRevealed: boolean;
  singleKeyRevealed: string | undefined;
  countdown: string;
}

function DecryptCard({
  config,
  result,
  loading,
  onDecryptKeys,
  onRevealAll,
  onRevealOne,
  onHideOne,
  onExportJson,
  revealedKeys,
  anyRevealed,
  singleKeyRevealed,
  countdown,
}: DecryptCardProps) {
  const identityConfigured = config?.ageIdentity.configured === true;
  const identityInline = identityConfigured && config!.ageIdentity.source === "CLEF_AGE_KEY";
  const identityLabel = identityConfigured
    ? config!.ageIdentity.source === "CLEF_AGE_KEY_FILE"
      ? `$CLEF_AGE_KEY_FILE  ·  ${config!.ageIdentity.path ?? ""}`
      : "$CLEF_AGE_KEY  (inline)"
    : "no identity configured on server — relaunch clef ui with CLEF_AGE_KEY_FILE set";

  // Subtitle spells out the invariant that bit the operator the first time:
  // the envelope must be encrypted for whichever key the server is using,
  // which is usually a service identity's key, not the operator's own.
  const subtitle = identityConfigured
    ? `Decrypting with ${identityLabel}. The pasted envelope must be encrypted for this key — usually a service identity's age key, not your personal one.`
    : identityLabel;

  return (
    <Card title="Decrypt" subtitle={subtitle}>
      {identityInline && (
        <div
          data-testid="inline-key-warning"
          className="mb-3 px-3 py-2 rounded-md bg-warn-500/15 border border-warn-500/40 text-warn-500 font-sans text-[12px] leading-relaxed"
        >
          {"⚠ "} This key was passed inline via <code>$CLEF_AGE_KEY</code>, which lands the secret
          in your shell history (<code>~/.zsh_history</code>, <code>~/.bash_history</code>) and in{" "}
          <code>ps aux</code> while the process runs. Prefer pointing at a file:{" "}
          <code>CLEF_AGE_KEY_FILE=/path/to/key clef ui</code>. Rotate the current key if it may
          already have been captured.
        </div>
      )}
      {result?.error && (
        <ErrorRow
          code={result.error.code}
          message={result.error.message}
          hint={decryptErrorHint(result.error, identityConfigured)}
        />
      )}

      {!result && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={onDecryptKeys}
            disabled={loading || !identityConfigured}
            data-testid="decrypt-keys"
          >
            {loading ? "Decrypting…" : "Decrypt (keys)"}
          </Button>
        </div>
      )}

      {result && !result.error && (
        <>
          {anyRevealed && (
            <div
              data-testid="reveal-banner"
              className="mb-3 px-3 py-2.5 rounded-md bg-warn-500/15 border border-warn-500/40 text-warn-500 font-sans text-[12px] flex items-center justify-between gap-2.5"
            >
              <span>
                {"⚠ "} {revealWarningText(singleKeyRevealed)}
              </span>
              <span className="font-mono text-[11px]" data-testid="reveal-countdown">
                auto-clears in {countdown}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {result.keys.map((k) => {
              const revealed = Object.prototype.hasOwnProperty.call(revealedKeys, k);
              return (
                <div
                  key={k}
                  data-testid={`decrypt-row-${k}`}
                  className="flex items-center gap-2.5 px-2.5 py-2 bg-ink-950 border border-edge rounded-md"
                >
                  <span className="font-mono text-[12px] text-bone basis-[200px] shrink-0 grow-0 overflow-hidden text-ellipsis">
                    {k}
                  </span>
                  <span
                    className={`font-mono text-[12px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
                      revealed ? "text-bone" : "text-ash-dim"
                    }`}
                    data-testid={`decrypt-value-${k}`}
                  >
                    {revealed ? revealedKeys[k] : "●".repeat(10)}
                  </span>
                  <button
                    data-testid={`reveal-toggle-${k}`}
                    onClick={() => (revealed ? onHideOne(k) : onRevealOne(k))}
                    className="bg-transparent border border-edge-strong rounded text-ash font-mono text-[11px] px-2 py-0.5 cursor-pointer"
                  >
                    {revealed ? "hide" : "reveal"}
                  </button>
                  {revealed && <CopyButton text={revealedKeys[k]} />}
                </div>
              );
            })}
          </div>

          <div className="mt-3.5 flex justify-between gap-2">
            <Button onClick={onDecryptKeys} disabled={loading}>
              {"↻"} Re-fetch keys
            </Button>
            <div className="flex gap-2">
              {anyRevealed && (
                <Button onClick={onExportJson} data-testid="export-json">
                  Export JSON
                </Button>
              )}
              <Button
                variant="primary"
                onClick={onRevealAll}
                disabled={loading}
                data-testid="reveal-all"
              >
                Reveal all
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  subtitle?: string;
  tone?: "default" | "error";
  children: React.ReactNode;
}

function Card({ title, subtitle, tone = "default", children }: CardProps) {
  const borderClasses = tone === "error" ? "border-stop-500/40" : "border-edge";
  return (
    <div
      className={`bg-ink-850 border rounded-lg p-4 ${borderClasses}`}
      data-testid={`envelope-card-${title.toLowerCase()}`}
    >
      <div className="mb-2.5">
        <div className="font-sans text-[13px] font-bold text-bone">{title}</div>
        {subtitle && <div className="font-mono text-[10px] text-ash mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[11px] text-ash basis-[140px] shrink-0 grow-0">{label}</span>
      <span className="flex-1 min-w-0 text-[12px]">{value}</span>
    </div>
  );
}

function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "pass" | "fail" | "warn" | "muted";
  detail: string;
}) {
  const toneColor =
    status === "pass"
      ? "text-go-500"
      : status === "fail"
        ? "text-stop-500"
        : status === "warn"
          ? "text-warn-500"
          : "text-ash";
  const icon = status === "pass" ? "✓" : status === "fail" ? "✕" : "·";
  return (
    <div
      className="flex items-center gap-2.5 px-2.5 py-1.5 bg-ink-950 border border-edge rounded-md"
      data-testid={`verify-row-${label.replace(/\s+/g, "-")}`}
    >
      <span className={`font-mono font-bold w-3 ${toneColor}`}>{icon}</span>
      <span className="font-sans text-[12px] text-bone basis-[140px] shrink-0 grow-0">{label}</span>
      <span className="font-mono text-[11px] text-ash flex-1">{detail}</span>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "fail" | "warn" | "muted"; label: string }) {
  const toneClasses =
    tone === "ok"
      ? "text-go-500 bg-go-500/15 border-go-500/40"
      : tone === "fail"
        ? "text-stop-500 bg-stop-500/10 border-stop-500/40"
        : tone === "warn"
          ? "text-warn-500 bg-warn-500/15 border-warn-500/40"
          : "text-ash bg-ash/10 border-ash/30";
  return (
    <span
      className={`font-mono text-[10px] font-bold border rounded-sm px-1.5 py-px ${toneClasses}`}
    >
      {label}
    </span>
  );
}

interface ErrorHint {
  title: string;
  commands: string[];
}

function ErrorRow({ code, message, hint }: { code: string; message: string; hint?: ErrorHint }) {
  return (
    <div
      role="alert"
      data-testid="envelope-error"
      className="px-3 py-2.5 bg-stop-500/10 border border-stop-500/40 rounded-md font-mono text-[11px] text-stop-500"
    >
      <div>
        <strong>{code}</strong> {"—"} {message}
      </div>
      {hint && (
        <div
          data-testid="envelope-error-hint"
          className="mt-2.5 pt-2.5 border-t border-stop-500/30 text-bone font-sans text-[12px] leading-relaxed"
        >
          <div className="mb-2">{hint.title}</div>
          <pre className="m-0 px-2.5 py-2 bg-ink-950 border border-edge rounded text-gold-500 font-mono text-[11px] whitespace-pre-wrap break-all">
            {hint.commands.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Pick a hint block for a decrypt error. Targets the two most common
 * support questions:
 *   - "no key configured at all" (key_resolution_failed)
 *   - "server has a key but it's not the right one for this envelope"
 *     (decrypt_failed with an age-encryption "no identity matched" message)
 *
 * Detection of the second case is string-sniffing on the age library's
 * error text — brittle if the library changes its wording, but the worst
 * case is that the hint quietly doesn't render and the raw error shows.
 */
function decryptErrorHint(
  error: { code: string; message: string },
  identityConfigured: boolean,
): ErrorHint | undefined {
  if (error.code === "key_resolution_failed") {
    return {
      title:
        "No age key on the server. Stop this server (Ctrl-C) and relaunch clef ui pointing at a key file:",
      commands: [
        "CLEF_AGE_KEY_FILE=/path/to/your-key.txt clef ui",
        "# avoid CLEF_AGE_KEY='AGE-SECRET-KEY-...' — the key ends up in shell history",
      ],
    };
  }
  if (error.code === "decrypt_failed" && /no identity matched/i.test(error.message)) {
    return {
      title: identityConfigured
        ? "The server's age key isn't one of this envelope's recipients. This usually means the envelope was packed for a service identity — relaunch clef ui with that identity's key:"
        : "This envelope's recipients don't include any key on the server. Relaunch clef ui with the matching age key:",
      commands: [
        "# find the service identity's private key and launch with it",
        "CLEF_AGE_KEY_FILE=/path/to/service-identity.key clef ui",
      ],
    };
  }
  return undefined;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] text-bone">{children}</span>;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function mapSignatureStatus(status: SignatureStatus): "pass" | "fail" | "warn" | "muted" {
  switch (status) {
    case "valid":
      return "pass";
    case "invalid":
      return "fail";
    case "not_verified":
      return "warn";
    default:
      return "muted";
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function shortHash(h: string): string {
  if (h.length <= 16) return h;
  return `${h.slice(0, 8)}…${h.slice(-8)}`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
