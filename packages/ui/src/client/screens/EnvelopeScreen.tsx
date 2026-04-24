import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
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

const REVEAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — matches NamespaceEditor

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Envelope Debugger"
        subtitle={"paste a packed artifact — inspect, verify, decrypt"}
        actions={
          rawSnapshot ? (
            <Button onClick={() => setShowRawJson((s) => !s)}>
              {showRawJson ? "Hide raw JSON" : "View raw JSON"}
            </Button>
          ) : undefined
        }
      />

      <div
        style={{
          flex: 1,
          padding: "18px 24px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
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
            style={{
              fontFamily: theme.mono,
              fontSize: 11,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: 14,
              color: theme.textMuted,
              maxHeight: 320,
              overflowY: "auto",
            }}
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

  return (
    <Card title="Paste" subtitle="paste a packed envelope JSON">
      <textarea
        data-testid="envelope-paste-textarea"
        value={rawJson}
        onChange={(e) => setRawJson(e.target.value)}
        placeholder={'{ "version": 1, "identity": "...", ... }'}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 120,
          maxHeight: 280,
          resize: "vertical",
          fontFamily: theme.mono,
          fontSize: 12,
          background: theme.bg,
          color: theme.text,
          border: `1px solid ${theme.borderLight}`,
          borderRadius: 6,
          padding: 10,
          outline: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        <span
          style={{
            fontFamily: theme.mono,
            fontSize: 11,
            color:
              parseState.state === "invalid"
                ? theme.red
                : parseState.state === "valid"
                  ? theme.green
                  : theme.textMuted,
          }}
          data-testid="paste-status"
        >
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
      <span key="ch" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
      <span key="sig" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        <span key="ex" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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

  return (
    <Card title="Verify" subtitle={subtitle}>
      {signaturePresent && (
        <textarea
          data-testid="envelope-signer-key"
          value={signerKey}
          onChange={(e) => setSignerKey(e.target.value)}
          placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 72,
            maxHeight: 160,
            resize: "vertical",
            fontFamily: theme.mono,
            fontSize: 11,
            background: theme.bg,
            color: theme.text,
            border: `1px solid ${theme.borderLight}`,
            borderRadius: 6,
            padding: 8,
            marginBottom: 10,
            outline: "none",
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button variant="primary" onClick={onVerify} disabled={loading}>
          {loading ? "Verifying…" : "Run verify"}
        </Button>
      </div>
      {result?.error && <ErrorRow code={result.error.code} message={result.error.message} />}
      {result && !result.error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
            style={{
              marginTop: 6,
              padding: "8px 12px",
              borderRadius: 6,
              background:
                result.overall === "pass"
                  ? theme.greenDim
                  : result.overall === "fail"
                    ? theme.redDim
                    : theme.border,
              color:
                result.overall === "pass"
                  ? theme.green
                  : result.overall === "fail"
                    ? theme.red
                    : theme.textMuted,
              fontFamily: theme.sans,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
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
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 6,
            background: theme.yellowDim,
            border: `1px solid ${theme.yellow}44`,
            color: theme.yellow,
            fontFamily: theme.sans,
            fontSize: 12,
            lineHeight: 1.5,
          }}
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
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 6,
                background: theme.yellowDim,
                border: `1px solid ${theme.yellow}44`,
                color: theme.yellow,
                fontFamily: theme.sans,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span>
                {"⚠ "} {revealWarningText(singleKeyRevealed)}
              </span>
              <span style={{ fontFamily: theme.mono, fontSize: 11 }} data-testid="reveal-countdown">
                auto-clears in {countdown}
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {result.keys.map((k) => {
              const revealed = Object.prototype.hasOwnProperty.call(revealedKeys, k);
              return (
                <div
                  key={k}
                  data-testid={`decrypt-row-${k}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 12,
                      color: theme.text,
                      flex: "0 0 200px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {k}
                  </span>
                  <span
                    style={{
                      fontFamily: theme.mono,
                      fontSize: 12,
                      color: revealed ? theme.text : theme.textDim,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    data-testid={`decrypt-value-${k}`}
                  >
                    {revealed ? revealedKeys[k] : "●".repeat(10)}
                  </span>
                  <button
                    data-testid={`reveal-toggle-${k}`}
                    onClick={() => (revealed ? onHideOne(k) : onRevealOne(k))}
                    style={{
                      background: "transparent",
                      border: `1px solid ${theme.borderLight}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      color: theme.textMuted,
                      fontFamily: theme.mono,
                      fontSize: 11,
                      padding: "2px 8px",
                    }}
                  >
                    {revealed ? "hide" : "reveal"}
                  </button>
                  {revealed && <CopyButton text={revealedKeys[k]} />}
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Button onClick={onDecryptKeys} disabled={loading}>
              {"↻"} Re-fetch keys
            </Button>
            <div style={{ display: "flex", gap: 8 }}>
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
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${tone === "error" ? theme.red + "44" : theme.border}`,
        borderRadius: 8,
        padding: 16,
      }}
      data-testid={`envelope-card-${title.toLowerCase()}`}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: theme.text }}>
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 10,
              color: theme.textMuted,
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          fontFamily: theme.mono,
          fontSize: 11,
          color: theme.textMuted,
          flex: "0 0 140px",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{value}</span>
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
      ? theme.green
      : status === "fail"
        ? theme.red
        : status === "warn"
          ? theme.yellow
          : theme.textMuted;
  const icon = status === "pass" ? "✓" : status === "fail" ? "✕" : "·";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
      }}
      data-testid={`verify-row-${label.replace(/\s+/g, "-")}`}
    >
      <span style={{ color: toneColor, fontFamily: theme.mono, fontWeight: 700, width: 12 }}>
        {icon}
      </span>
      <span
        style={{
          fontFamily: theme.sans,
          fontSize: 12,
          color: theme.text,
          flex: "0 0 140px",
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textMuted, flex: 1 }}>
        {detail}
      </span>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "fail" | "warn" | "muted"; label: string }) {
  const color =
    tone === "ok"
      ? theme.green
      : tone === "fail"
        ? theme.red
        : tone === "warn"
          ? theme.yellow
          : theme.textMuted;
  const bg =
    tone === "ok"
      ? theme.greenDim
      : tone === "fail"
        ? theme.redDim
        : tone === "warn"
          ? theme.yellowDim
          : `${theme.textMuted}20`;
  return (
    <span
      style={{
        fontFamily: theme.mono,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: bg,
        border: `1px solid ${color}44`,
        borderRadius: 3,
        padding: "1px 6px",
      }}
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
      data-testid="envelope-error"
      style={{
        padding: "10px 12px",
        background: theme.redDim,
        border: `1px solid ${theme.red}44`,
        borderRadius: 6,
        fontFamily: theme.mono,
        fontSize: 11,
        color: theme.red,
      }}
    >
      <div>
        <strong>{code}</strong> {"—"} {message}
      </div>
      {hint && (
        <div
          data-testid="envelope-error-hint"
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${theme.red}33`,
            color: theme.text,
            fontFamily: theme.sans,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ marginBottom: 8 }}>{hint.title}</div>
          <pre
            style={{
              margin: 0,
              padding: "8px 10px",
              background: theme.bg,
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              color: theme.accent,
              fontFamily: theme.mono,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
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
  return (
    <span style={{ fontFamily: theme.mono, fontSize: 12, color: theme.text }}>{children}</span>
  );
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
