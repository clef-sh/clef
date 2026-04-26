import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar, EmptyState } from "../primitives";
import type { ClefManifest, Recipient, AgeKeyValidation } from "@clef-sh/core";
import type { ViewName } from "../components/Sidebar";

interface RecipientsScreenProps {
  manifest: ClefManifest | null;
  setView: (view: ViewName) => void;
}

const KEY_INPUT_BASE =
  "w-full box-border rounded-md bg-ink-950 px-3 py-2 font-mono text-[12px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim";

const TEXT_INPUT_BASE =
  "w-full box-border rounded-md border border-edge bg-ink-950 px-3 py-2 font-sans text-[13px] text-bone outline-none focus-visible:border-gold-500 placeholder:text-ash-dim";

export function RecipientsScreen({ manifest: _manifest, setView }: RecipientsScreenProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [keyValidation, setKeyValidation] = useState<AgeKeyValidation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<Recipient | null>(null);
  const [removeStep, setRemoveStep] = useState<0 | 1 | 2>(0);
  const [acknowledgedWarning, setAcknowledgedWarning] = useState(false);

  const [removalBanner, setRemovalBanner] = useState<{
    name: string;
    targets: string[];
  } | null>(null);

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

  useEffect(() => {
    if (!addKey.trim()) {
      setKeyValidation(null);
      return;
    }
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
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
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
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

  const keyBorderClass = keyValidation
    ? keyValidation.valid
      ? "border border-go-500/40"
      : "border border-stop-500/40"
    : "border border-edge";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Recipients</Toolbar.Title>
          <Toolbar.Subtitle>clef recipients -- manage age encryption keys</Toolbar.Subtitle>
        </div>
        {!showAddForm && removeStep === 0 && (
          <Toolbar.Actions>
            <Button variant="primary" onClick={() => setShowAddForm(true)}>
              + Add recipient
            </Button>
          </Toolbar.Actions>
        )}
      </Toolbar>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[620px]">
          {error && (
            <div className="mb-4 rounded-lg border border-stop-500/30 bg-stop-500/10 px-4 py-3 font-sans text-[13px] text-stop-500">
              {error}
            </div>
          )}

          {removalBanner && (
            <div
              data-testid="rotation-banner"
              className="mb-5 rounded-lg border border-warn-500/30 bg-warn-500/10 px-4 py-3.5"
            >
              <div className="mb-2 font-sans text-[13px] font-semibold text-warn-500">
                Rotation reminder
              </div>
              <div className="mb-2.5 font-sans text-[13px] leading-relaxed text-bone">
                <strong>{removalBanner.name}</strong> has been removed and files re-encrypted.
                However, the removed key may still decrypt old versions of these files from git
                history. Rotate secret values in the following targets to complete revocation:
              </div>
              {removalBanner.targets.length > 0 && (
                <div className="mb-3 pl-3 font-mono text-[11px] text-ash">
                  {removalBanner.targets.map((t) => (
                    <div key={t} className="mb-px">
                      {t}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2.5">
                <Button variant="primary" onClick={() => setView("matrix")}>
                  Go to Matrix to rotate
                </Button>
                <Button variant="ghost" onClick={() => setRemovalBanner(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {showAddForm && (
            <div
              data-testid="add-form"
              className="mb-6 rounded-lg border border-edge bg-ink-850 p-5"
            >
              <div className="mb-4 font-sans text-[14px] font-semibold text-bone">
                Add recipient
              </div>

              <div className="mb-3.5">
                <Label>Age public key</Label>
                <input
                  type="text"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
                  data-testid="add-key-input"
                  className={`${KEY_INPUT_BASE} ${keyBorderClass}`}
                />
                {keyValidation && !keyValidation.valid && (
                  <div className="mt-1 font-sans text-[11px] text-stop-500">
                    {keyValidation.error}
                  </div>
                )}
                {keyValidation?.valid && (
                  <div className="mt-1 font-sans text-[11px] text-go-500">Valid age public key</div>
                )}
              </div>

              <div className="mb-3.5">
                <Label>Label (optional)</Label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="e.g. alice@example.com"
                  data-testid="add-label-input"
                  className={TEXT_INPUT_BASE}
                />
              </div>

              <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-500/10 px-3.5 py-2.5 font-sans text-[12px] leading-relaxed text-warn-500">
                Adding a recipient will re-encrypt {totalFiles} file
                {totalFiles !== 1 ? "s" : ""}. This may take a moment.
              </div>

              <div className="flex gap-2.5">
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

          {removeStep === 1 && removeTarget && (
            <div
              data-testid="remove-dialog"
              className="mb-6 rounded-lg border border-stop-500/30 bg-ink-850 p-5"
            >
              <div className="mb-3 font-sans text-[14px] font-semibold text-stop-500">
                Remove recipient
              </div>
              <div className="mb-4 font-sans text-[13px] leading-relaxed text-bone">
                You are about to remove{" "}
                <strong className="text-gold-500">
                  {removeTarget.label ?? removeTarget.preview}
                </strong>{" "}
                ({removeTarget.preview}). All {totalFiles} encrypted file
                {totalFiles !== 1 ? "s" : ""} will be re-encrypted without this key.
              </div>
              <div className="mb-4 rounded-md border border-stop-500/30 bg-stop-500/10 px-3.5 py-3 font-sans text-[12px] leading-relaxed text-stop-500">
                Re-encryption only removes <em>future</em> access. The removed key can still decrypt
                old versions from git history. You must rotate all secret values after removal.
              </div>
              <label className="mb-4 flex cursor-pointer items-start gap-2.5 font-sans text-[13px] text-bone">
                <input
                  type="checkbox"
                  checked={acknowledgedWarning}
                  onChange={(e) => setAcknowledgedWarning(e.target.checked)}
                  data-testid="acknowledge-checkbox"
                  className="mt-0.5 accent-stop-500"
                />
                I understand — I will rotate secrets after removal
              </label>
              <div className="flex gap-2.5">
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

          {removeStep === 2 && removeTarget && (
            <div
              data-testid="remove-confirm-dialog"
              className="mb-6 rounded-lg border border-stop-500/30 bg-ink-850 p-5"
            >
              <div className="mb-3 font-sans text-[14px] font-semibold text-stop-500">
                Confirm removal
              </div>
              <div className="mb-4 font-sans text-[13px] leading-relaxed text-bone">
                This will remove{" "}
                <strong className="text-gold-500">
                  {removeTarget.label ?? removeTarget.preview}
                </strong>{" "}
                and re-encrypt all {totalFiles} file{totalFiles !== 1 ? "s" : ""}. This cannot be
                undone.
              </div>
              <div className="flex gap-2.5">
                <Button variant="ghost" onClick={cancelRemove}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={handleRemove} disabled={loading}>
                  {loading ? "Re-encrypting..." : "Remove and re-encrypt"}
                </Button>
              </div>
            </div>
          )}

          {recipients.length === 0 && !showAddForm && (
            <EmptyState
              title="No recipients configured"
              body="Add an age public key to get started."
            />
          )}

          {recipients.length > 0 && (
            <div>
              <div className="mb-2.5 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
                Recipients ({recipients.length})
              </div>
              {recipients.map((r) => (
                <div
                  key={r.key}
                  data-testid="recipient-row"
                  className="mb-2 flex items-center gap-3.5 rounded-lg border border-edge bg-ink-850 px-4 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gold-500/30 bg-gold-500/10 text-[14px]">
                    {"🔑"}
                  </div>
                  <div className="min-w-0 flex-1">
                    {r.label && (
                      <div className="mb-0.5 font-sans text-[13px] font-semibold text-bone">
                        {r.label}
                      </div>
                    )}
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-ash">
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
              <div className="mt-3 font-mono text-[11px] text-ash-dim">
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
    <div className="mb-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.05em] text-ash">
      {children}
    </div>
  );
}
