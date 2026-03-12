import React, { useState, useEffect, useCallback, useRef } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import type { ClefManifest, Recipient, AgeKeyValidation } from "@clef-sh/core";
import type { ViewName } from "../components/Sidebar";

interface RecipientsScreenProps {
  manifest: ClefManifest | null;
  setView: (view: ViewName) => void;
}

export function RecipientsScreen({ manifest: _manifest, setView }: RecipientsScreenProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [keyValidation, setKeyValidation] = useState<AgeKeyValidation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remove flow state
  const [removeTarget, setRemoveTarget] = useState<Recipient | null>(null);
  const [removeStep, setRemoveStep] = useState<0 | 1 | 2>(0);
  const [acknowledgedWarning, setAcknowledgedWarning] = useState(false);

  // Post-removal banner
  const [removalBanner, setRemovalBanner] = useState<{
    name: string;
    targets: string[];
  } | null>(null);

  // Debounce timer ref for key validation
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecipients = useCallback(async () => {
    try {
      const res = await apiFetch("/api/recipients");
      if (res.ok) {
        const data = await res.json();
        setRecipients(data.recipients);
        setTotalFiles(data.totalFiles);
      }
    } catch {
      // Silently fail — will show empty state
    }
  }, []);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  // Real-time key validation with debounce
  useEffect(() => {
    if (!addKey.trim()) {
      setKeyValidation(null);
      return;
    }

    if (validateTimerRef.current) {
      clearTimeout(validateTimerRef.current);
    }

    validateTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/recipients/validate?key=${encodeURIComponent(addKey.trim())}`,
        );
        if (res.ok) {
          const data: AgeKeyValidation = await res.json();
          setKeyValidation(data);
        }
      } catch {
        // Silently fail
      }
    }, 300);

    return () => {
      if (validateTimerRef.current) {
        clearTimeout(validateTimerRef.current);
      }
    };
  }, [addKey]);

  const handleAdd = async () => {
    if (!keyValidation?.valid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/recipients/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: addKey.trim(),
          label: addLabel.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to add recipient");
        return;
      }

      const data = await res.json();
      setRecipients(data.recipients);
      setShowAddForm(false);
      setAddKey("");
      setAddLabel("");
      setKeyValidation(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add recipient");
    } finally {
      setLoading(false);
    }
  };

  const startRemove = (recipient: Recipient) => {
    setRemoveTarget(recipient);
    setRemoveStep(1);
    setAcknowledgedWarning(false);
  };

  const cancelRemove = () => {
    setRemoveTarget(null);
    setRemoveStep(0);
    setAcknowledgedWarning(false);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/recipients/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: removeTarget.key }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to remove recipient");
        return;
      }

      const data = await res.json();
      setRecipients(data.recipients);

      // Show rotation reminder
      const name = removeTarget.label ?? removeTarget.preview;
      setRemovalBanner({
        name,
        targets: data.rotationReminder ?? [],
      });

      cancelRemove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove recipient");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Recipients"
        subtitle="clef recipients -- manage age encryption keys"
        actions={
          !showAddForm && removeStep === 0 ? (
            <Button variant="primary" onClick={() => setShowAddForm(true)}>
              + Add recipient
            </Button>
          ) : undefined
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          {/* Error banner */}
          {error && (
            <div
              style={{
                background: theme.redDim,
                border: `1px solid ${theme.red}44`,
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.red,
              }}
            >
              {error}
            </div>
          )}

          {/* Post-removal rotation reminder banner */}
          {removalBanner && (
            <div
              data-testid="rotation-banner"
              style={{
                background: theme.yellowDim,
                border: `1px solid ${theme.yellow}44`,
                borderRadius: 8,
                padding: "14px 18px",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  fontWeight: 600,
                  color: theme.yellow,
                  marginBottom: 8,
                }}
              >
                Rotation reminder
              </div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.text,
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                <strong>{removalBanner.name}</strong> has been removed and files re-encrypted.
                However, the removed key may still decrypt old versions of these files from git
                history. Rotate secret values in the following targets to complete revocation:
              </div>
              {removalBanner.targets.length > 0 && (
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 11,
                    color: theme.textMuted,
                    marginBottom: 12,
                    paddingLeft: 12,
                  }}
                >
                  {removalBanner.targets.map((t) => (
                    <div key={t} style={{ marginBottom: 2 }}>
                      {t}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="primary" onClick={() => setView("matrix")}>
                  Go to Matrix to rotate
                </Button>
                <Button variant="ghost" onClick={() => setRemovalBanner(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* Add form */}
          {showAddForm && (
            <div
              data-testid="add-form"
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: theme.text,
                  marginBottom: 16,
                }}
              >
                Add recipient
              </div>

              {/* Key input */}
              <div style={{ marginBottom: 14 }}>
                <Label>Age public key</Label>
                <input
                  type="text"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
                  data-testid="add-key-input"
                  style={{
                    width: "100%",
                    background: theme.bg,
                    border: `1px solid ${
                      keyValidation
                        ? keyValidation.valid
                          ? theme.green + "66"
                          : theme.red + "66"
                        : theme.border
                    }`,
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontFamily: theme.mono,
                    fontSize: 12,
                    color: theme.text,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {keyValidation && !keyValidation.valid && (
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 11,
                      color: theme.red,
                      marginTop: 4,
                    }}
                  >
                    {keyValidation.error}
                  </div>
                )}
                {keyValidation?.valid && (
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 11,
                      color: theme.green,
                      marginTop: 4,
                    }}
                  >
                    Valid age public key
                  </div>
                )}
              </div>

              {/* Label input */}
              <div style={{ marginBottom: 14 }}>
                <Label>Label (optional)</Label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="e.g. alice@example.com"
                  data-testid="add-label-input"
                  style={{
                    width: "100%",
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontFamily: theme.sans,
                    fontSize: 13,
                    color: theme.text,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Re-encryption warning */}
              <div
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  background: theme.yellowDim,
                  border: `1px solid ${theme.yellow}44`,
                  borderRadius: 6,
                  fontFamily: theme.sans,
                  fontSize: 12,
                  color: theme.yellow,
                  lineHeight: 1.5,
                }}
              >
                Adding a recipient will re-encrypt {totalFiles} file
                {totalFiles !== 1 ? "s" : ""}. This may take a moment.
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowAddForm(false);
                    setAddKey("");
                    setAddLabel("");
                    setKeyValidation(null);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleAdd}
                  disabled={loading || !keyValidation?.valid}
                >
                  {loading ? "Re-encrypting..." : "Add and re-encrypt"}
                </Button>
              </div>
            </div>
          )}

          {/* Remove flow: Step 1 — Revocation warning */}
          {removeStep === 1 && removeTarget && (
            <div
              data-testid="remove-dialog"
              style={{
                background: theme.surface,
                border: `1px solid ${theme.red}44`,
                borderRadius: 10,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: theme.red,
                  marginBottom: 12,
                }}
              >
                Remove recipient
              </div>

              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.text,
                  lineHeight: 1.6,
                  marginBottom: 16,
                }}
              >
                You are about to remove{" "}
                <strong style={{ color: theme.accent }}>
                  {removeTarget.label ?? removeTarget.preview}
                </strong>{" "}
                ({removeTarget.preview}). All {totalFiles} encrypted file
                {totalFiles !== 1 ? "s" : ""} will be re-encrypted without this key.
              </div>

              <div
                style={{
                  background: theme.redDim,
                  border: `1px solid ${theme.red}44`,
                  borderRadius: 6,
                  padding: "12px 14px",
                  marginBottom: 16,
                  fontFamily: theme.sans,
                  fontSize: 12,
                  color: theme.red,
                  lineHeight: 1.5,
                }}
              >
                Re-encryption only removes <em>future</em> access. The removed key can still decrypt
                old versions from git history. You must rotate all secret values after removal.
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  cursor: "pointer",
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.text,
                  marginBottom: 16,
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledgedWarning}
                  onChange={(e) => setAcknowledgedWarning(e.target.checked)}
                  data-testid="acknowledge-checkbox"
                  style={{ accentColor: theme.red, marginTop: 2 }}
                />
                I understand — I will rotate secrets after removal
              </label>

              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={cancelRemove}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setRemoveStep(2)}
                  disabled={!acknowledgedWarning}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Remove flow: Step 2 — Final confirmation */}
          {removeStep === 2 && removeTarget && (
            <div
              data-testid="remove-confirm-dialog"
              style={{
                background: theme.surface,
                border: `1px solid ${theme.red}44`,
                borderRadius: 10,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: theme.red,
                  marginBottom: 12,
                }}
              >
                Confirm removal
              </div>

              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.text,
                  lineHeight: 1.6,
                  marginBottom: 16,
                }}
              >
                This will remove{" "}
                <strong style={{ color: theme.accent }}>
                  {removeTarget.label ?? removeTarget.preview}
                </strong>{" "}
                and re-encrypt all {totalFiles} file{totalFiles !== 1 ? "s" : ""}. This cannot be
                undone.
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={cancelRemove}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={handleRemove} disabled={loading}>
                  {loading ? "Re-encrypting..." : "Remove and re-encrypt"}
                </Button>
              </div>
            </div>
          )}

          {/* Recipients list */}
          {recipients.length === 0 && !showAddForm && (
            <div
              style={{
                textAlign: "center",
                paddingTop: 40,
                fontFamily: theme.sans,
                fontSize: 14,
                color: theme.textMuted,
              }}
            >
              No recipients configured. Add an age public key to get started.
            </div>
          )}

          {recipients.length > 0 && (
            <div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.textMuted,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Recipients ({recipients.length})
              </div>

              {recipients.map((r) => (
                <div
                  key={r.key}
                  data-testid="recipient-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 16px",
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: theme.accentDim,
                      border: `1px solid ${theme.accent}44`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {"\uD83D\uDD11"}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {r.label && (
                      <div
                        style={{
                          fontFamily: theme.sans,
                          fontSize: 13,
                          fontWeight: 600,
                          color: theme.text,
                          marginBottom: 2,
                        }}
                      >
                        {r.label}
                      </div>
                    )}
                    <div
                      style={{
                        fontFamily: theme.mono,
                        fontSize: 11,
                        color: theme.textMuted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.preview}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => startRemove(r)}
                    disabled={removeStep !== 0 || loading}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 11,
                  color: theme.textDim,
                  marginTop: 12,
                }}
              >
                {totalFiles} encrypted file{totalFiles !== 1 ? "s" : ""} in the matrix
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: theme.sans,
        fontSize: 12,
        fontWeight: 600,
        color: theme.textMuted,
        marginBottom: 6,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
