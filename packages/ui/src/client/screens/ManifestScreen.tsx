import React, { useState, useCallback } from "react";
import { theme } from "../theme";
import { apiFetch } from "../api";
import { TopBar } from "../components/TopBar";
import { Button } from "../components/Button";
import type { ClefManifest, ClefNamespace, ClefEnvironment } from "@clef-sh/core";

interface ManifestScreenProps {
  manifest: ClefManifest | null;
  reloadManifest: () => void;
}

type ModalState =
  | { kind: "none" }
  | { kind: "addNamespace" }
  | { kind: "editNamespace"; ns: ClefNamespace }
  | { kind: "removeNamespace"; ns: ClefNamespace }
  | { kind: "addEnvironment" }
  | { kind: "editEnvironment"; env: ClefEnvironment }
  | { kind: "removeEnvironment"; env: ClefEnvironment };

/**
 * The Manifest screen is the home for namespace and environment configuration.
 * It mirrors the StructureManager surface from packages/core/src/structure: add,
 * edit, and remove for both axes, with the same validation and refusal rules.
 *
 * The matrix view shows the matrix DATA (cells, statuses, drift); this screen
 * shows the matrix STRUCTURE (which envs/namespaces exist and their config).
 */
export function ManifestScreen({ manifest, reloadManifest }: ManifestScreenProps) {
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    setModal({ kind: "none" });
    setError(null);
  }, []);

  if (!manifest) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <TopBar title="Manifest" subtitle="Loading..." />
      </div>
    );
  }

  const namespaces = manifest.namespaces;
  const environments = manifest.environments;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Manifest"
        subtitle={`${namespaces.length} namespaces \u00B7 ${environments.length} environments`}
      />

      <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
        {/* Namespaces section */}
        <Section
          title="Namespaces"
          actionLabel="+ Namespace"
          onAction={() => setModal({ kind: "addNamespace" })}
          actionTestId="add-namespace-btn"
        >
          {namespaces.length === 0 ? (
            <EmptyState message="No namespaces declared yet." />
          ) : (
            <EntityList>
              {namespaces.map((ns) => (
                <EntityRow
                  key={ns.name}
                  testId={`namespace-row-${ns.name}`}
                  name={ns.name}
                  description={ns.description}
                  badges={ns.schema ? [{ label: `schema: ${ns.schema}`, color: theme.purple }] : []}
                  onEdit={() => setModal({ kind: "editNamespace", ns })}
                  onDelete={() => setModal({ kind: "removeNamespace", ns })}
                />
              ))}
            </EntityList>
          )}
        </Section>

        {/* Environments section */}
        <div style={{ marginTop: 36 }}>
          <Section
            title="Environments"
            actionLabel="+ Environment"
            onAction={() => setModal({ kind: "addEnvironment" })}
            actionTestId="add-environment-btn"
          >
            {environments.length === 0 ? (
              <EmptyState message="No environments declared yet." />
            ) : (
              <EntityList>
                {environments.map((env) => (
                  <EntityRow
                    key={env.name}
                    testId={`environment-row-${env.name}`}
                    name={env.name}
                    description={env.description}
                    badges={env.protected ? [{ label: "protected", color: theme.red }] : []}
                    onEdit={() => setModal({ kind: "editEnvironment", env })}
                    onDelete={() => setModal({ kind: "removeEnvironment", env })}
                  />
                ))}
              </EntityList>
            )}
          </Section>
        </div>
      </div>

      {/* Modals */}
      {modal.kind === "addNamespace" && (
        <AddNamespaceModal
          onClose={closeModal}
          onSubmit={async (data) => {
            const res = await apiFetch("/api/namespaces", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to add namespace");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          existingNames={namespaces.map((n) => n.name)}
          error={error}
          setError={setError}
        />
      )}

      {modal.kind === "editNamespace" && (
        <EditNamespaceModal
          ns={modal.ns}
          existingNames={namespaces.map((n) => n.name)}
          onClose={closeModal}
          onSubmit={async (data) => {
            const res = await apiFetch(`/api/namespaces/${encodeURIComponent(modal.ns.name)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to edit namespace");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          error={error}
          setError={setError}
        />
      )}

      {modal.kind === "removeNamespace" && (
        <ConfirmRemoveModal
          title="Delete namespace"
          subjectKind="namespace"
          subjectName={modal.ns.name}
          impactDescription={`This will delete every encrypted cell file under '${modal.ns.name}/' across all environments and remove '${modal.ns.name}' from any service identity that references it.`}
          onClose={closeModal}
          onConfirm={async () => {
            const res = await apiFetch(`/api/namespaces/${encodeURIComponent(modal.ns.name)}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to remove namespace");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          error={error}
        />
      )}

      {modal.kind === "addEnvironment" && (
        <AddEnvironmentModal
          existingNames={environments.map((e) => e.name)}
          onClose={closeModal}
          onSubmit={async (data) => {
            const res = await apiFetch("/api/environments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to add environment");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          error={error}
          setError={setError}
        />
      )}

      {modal.kind === "editEnvironment" && (
        <EditEnvironmentModal
          env={modal.env}
          existingNames={environments.map((e) => e.name)}
          onClose={closeModal}
          onSubmit={async (data) => {
            const res = await apiFetch(`/api/environments/${encodeURIComponent(modal.env.name)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to edit environment");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          error={error}
          setError={setError}
        />
      )}

      {modal.kind === "removeEnvironment" && (
        <ConfirmRemoveModal
          title="Delete environment"
          subjectKind="environment"
          subjectName={modal.env.name}
          impactDescription={
            modal.env.protected
              ? `'${modal.env.name}' is a protected environment and will be refused. Run "Edit" first and unprotect it before removing.`
              : `This will delete every encrypted cell file for '${modal.env.name}' across all namespaces and remove the '${modal.env.name}' entry from every service identity.`
          }
          onClose={closeModal}
          onConfirm={async () => {
            const res = await apiFetch(`/api/environments/${encodeURIComponent(modal.env.name)}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const body = await res.json();
              setError(body.error ?? "Failed to remove environment");
              return false;
            }
            reloadManifest();
            closeModal();
            return true;
          }}
          error={error}
        />
      )}
    </div>
  );
}

// ── Layout primitives ────────────────────────────────────────────────────

function Section(props: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  actionTestId: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            fontFamily: theme.sans,
            fontSize: 14,
            fontWeight: 600,
            color: theme.text,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {props.title}
        </h2>
        <Button variant="primary" onClick={props.onAction} data-testid={props.actionTestId}>
          {props.actionLabel}
        </Button>
      </div>
      {props.children}
    </div>
  );
}

function EntityList(props: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: theme.surface,
        overflow: "hidden",
      }}
    >
      {props.children}
    </div>
  );
}

function EntityRow(props: {
  testId: string;
  name: string;
  description: string;
  badges: { label: string; color: string }[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={props.testId}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: `1px solid ${theme.border}`,
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 13,
            fontWeight: 600,
            color: theme.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {props.name}
          {props.badges.map((b) => (
            <span
              key={b.label}
              style={{
                fontFamily: theme.sans,
                fontSize: 10,
                fontWeight: 500,
                color: b.color,
                background: `${b.color}14`,
                border: `1px solid ${b.color}33`,
                borderRadius: 10,
                padding: "1px 8px",
              }}
            >
              {b.label}
            </span>
          ))}
        </div>
        {props.description && (
          <div
            style={{
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.textMuted,
              marginTop: 2,
            }}
          >
            {props.description}
          </div>
        )}
      </div>
      <Button onClick={props.onEdit} data-testid={`${props.testId}-edit`}>
        Edit
      </Button>
      <Button onClick={props.onDelete} data-testid={`${props.testId}-delete`}>
        Delete
      </Button>
    </div>
  );
}

function EmptyState(props: { message: string }) {
  return (
    <div
      style={{
        padding: 24,
        border: `1px dashed ${theme.border}`,
        borderRadius: 8,
        textAlign: "center",
        fontFamily: theme.sans,
        fontSize: 12,
        color: theme.textMuted,
      }}
    >
      {props.message}
    </div>
  );
}

// ── Modal primitives ─────────────────────────────────────────────────────

function ModalShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Stop propagation on inner click so clicking the dialog body doesn't dismiss
  return (
    <div
      data-testid="manifest-modal"
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          padding: 24,
          width: 480,
          maxWidth: "90vw",
        }}
      >
        <h3
          style={{
            fontFamily: theme.sans,
            fontSize: 16,
            fontWeight: 600,
            color: theme.text,
            margin: "0 0 16px",
          }}
        >
          {props.title}
        </h3>
        {props.children}
      </div>
    </div>
  );
}

function FormField(props: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontFamily: theme.sans,
          fontSize: 11,
          fontWeight: 600,
          color: theme.textMuted,
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {props.label}
      </label>
      {props.children}
      {props.hint && (
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 11,
            color: theme.textMuted,
            marginTop: 4,
          }}
        >
          {props.hint}
        </div>
      )}
    </div>
  );
}

function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      data-testid={props.testId}
      autoFocus={props.autoFocus}
      style={{
        width: "100%",
        padding: "8px 12px",
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        color: theme.text,
        fontFamily: theme.mono,
        fontSize: 13,
        boxSizing: "border-box",
      }}
    />
  );
}

function ErrorBanner(props: { message: string }) {
  return (
    <div
      data-testid="manifest-modal-error"
      style={{
        padding: "8px 12px",
        background: `${theme.red}14`,
        border: `1px solid ${theme.red}33`,
        borderRadius: 6,
        color: theme.red,
        fontFamily: theme.sans,
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {props.message}
    </div>
  );
}

function ModalActions(props: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 8,
      }}
    >
      {props.children}
    </div>
  );
}

// Validate identifiers locally for instant feedback. Mirrors the regex used
// server-side in StructureManager.assertValidIdentifier.
function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

// ── Add Namespace ────────────────────────────────────────────────────────

function AddNamespaceModal(props: {
  existingNames: string[];
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; schema?: string }) => Promise<boolean>;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schema, setSchema] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const collides = props.existingNames.includes(trimmed);
  const valid = trimmed.length > 0 && isValidIdentifier(trimmed) && !collides;
  const localError = !trimmed
    ? null
    : !isValidIdentifier(trimmed)
      ? "Use letters, numbers, '.', '_', or '-' only."
      : collides
        ? `A namespace named '${trimmed}' already exists.`
        : null;

  return (
    <ModalShell title="Add namespace" onClose={props.onClose}>
      {props.error && <ErrorBanner message={props.error} />}
      <FormField label="Name" hint={localError ?? undefined}>
        <TextInput
          value={name}
          onChange={(v) => {
            setName(v);
            props.setError(null);
          }}
          placeholder="payments"
          testId="namespace-name-input"
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder="Payment processing secrets"
          testId="namespace-description-input"
        />
      </FormField>
      <FormField label="Schema (optional)" hint="Path to a YAML schema file in the repo.">
        <TextInput
          value={schema}
          onChange={setSchema}
          placeholder="schemas/payments.yaml"
          testId="namespace-schema-input"
        />
      </FormField>
      <ModalActions>
        <Button onClick={props.onClose} data-testid="namespace-add-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!valid || busy}
          data-testid="namespace-add-submit"
          onClick={async () => {
            setBusy(true);
            await props.onSubmit({
              name: trimmed,
              description: description.trim() || undefined,
              schema: schema.trim() || undefined,
            });
            setBusy(false);
          }}
        >
          {busy ? "Adding..." : "Add namespace"}
        </Button>
      </ModalActions>
    </ModalShell>
  );
}

// ── Edit Namespace ───────────────────────────────────────────────────────

function EditNamespaceModal(props: {
  ns: ClefNamespace;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (data: { rename?: string; description?: string; schema?: string }) => Promise<boolean>;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [rename, setRename] = useState(props.ns.name);
  const [description, setDescription] = useState(props.ns.description ?? "");
  const [schema, setSchema] = useState(props.ns.schema ?? "");
  const [busy, setBusy] = useState(false);

  const trimmedRename = rename.trim();
  const isRename = trimmedRename !== props.ns.name;
  const collides = isRename && props.existingNames.includes(trimmedRename);
  const renameValid = !isRename || (isValidIdentifier(trimmedRename) && !collides);
  const localError = !trimmedRename
    ? "Name cannot be empty."
    : !renameValid
      ? collides
        ? `A namespace named '${trimmedRename}' already exists.`
        : "Use letters, numbers, '.', '_', or '-' only."
      : null;

  // Detect any change vs the original entity
  const dirty =
    isRename || description !== (props.ns.description ?? "") || schema !== (props.ns.schema ?? "");

  return (
    <ModalShell title={`Edit namespace '${props.ns.name}'`} onClose={props.onClose}>
      {props.error && <ErrorBanner message={props.error} />}
      <FormField label="Name" hint={localError ?? undefined}>
        <TextInput
          value={rename}
          onChange={(v) => {
            setRename(v);
            props.setError(null);
          }}
          testId="namespace-rename-input"
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <TextInput
          value={description}
          onChange={setDescription}
          testId="namespace-description-input"
        />
      </FormField>
      <FormField label="Schema (optional)" hint="Empty to clear.">
        <TextInput value={schema} onChange={setSchema} testId="namespace-schema-input" />
      </FormField>
      <ModalActions>
        <Button onClick={props.onClose} data-testid="namespace-edit-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || !!localError || busy}
          data-testid="namespace-edit-submit"
          onClick={async () => {
            setBusy(true);
            const data: { rename?: string; description?: string; schema?: string } = {};
            if (isRename) data.rename = trimmedRename;
            if (description !== (props.ns.description ?? "")) data.description = description;
            if (schema !== (props.ns.schema ?? "")) data.schema = schema;
            await props.onSubmit(data);
            setBusy(false);
          }}
        >
          {busy ? "Saving..." : "Save changes"}
        </Button>
      </ModalActions>
    </ModalShell>
  );
}

// ── Add Environment ──────────────────────────────────────────────────────

function AddEnvironmentModal(props: {
  existingNames: string[];
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; protected?: boolean }) => Promise<boolean>;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isProtected, setIsProtected] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const collides = props.existingNames.includes(trimmed);
  const valid = trimmed.length > 0 && isValidIdentifier(trimmed) && !collides;
  const localError = !trimmed
    ? null
    : !isValidIdentifier(trimmed)
      ? "Use letters, numbers, '.', '_', or '-' only."
      : collides
        ? `An environment named '${trimmed}' already exists.`
        : null;

  return (
    <ModalShell title="Add environment" onClose={props.onClose}>
      {props.error && <ErrorBanner message={props.error} />}
      <FormField label="Name" hint={localError ?? undefined}>
        <TextInput
          value={name}
          onChange={(v) => {
            setName(v);
            props.setError(null);
          }}
          placeholder="staging"
          testId="environment-name-input"
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder="Pre-production"
          testId="environment-description-input"
        />
      </FormField>
      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: theme.sans,
            fontSize: 12,
            color: theme.text,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={isProtected}
            onChange={(e) => setIsProtected(e.target.checked)}
            data-testid="environment-protected-checkbox"
          />
          Mark as protected
        </label>
      </div>
      <ModalActions>
        <Button onClick={props.onClose} data-testid="environment-add-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!valid || busy}
          data-testid="environment-add-submit"
          onClick={async () => {
            setBusy(true);
            await props.onSubmit({
              name: trimmed,
              description: description.trim() || undefined,
              protected: isProtected || undefined,
            });
            setBusy(false);
          }}
        >
          {busy ? "Adding..." : "Add environment"}
        </Button>
      </ModalActions>
    </ModalShell>
  );
}

// ── Edit Environment ─────────────────────────────────────────────────────

function EditEnvironmentModal(props: {
  env: ClefEnvironment;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (data: {
    rename?: string;
    description?: string;
    protected?: boolean;
  }) => Promise<boolean>;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [rename, setRename] = useState(props.env.name);
  const [description, setDescription] = useState(props.env.description ?? "");
  const [isProtected, setIsProtected] = useState(props.env.protected === true);
  const [busy, setBusy] = useState(false);

  const trimmedRename = rename.trim();
  const isRename = trimmedRename !== props.env.name;
  const collides = isRename && props.existingNames.includes(trimmedRename);
  const renameValid = !isRename || (isValidIdentifier(trimmedRename) && !collides);
  const localError = !trimmedRename
    ? "Name cannot be empty."
    : !renameValid
      ? collides
        ? `An environment named '${trimmedRename}' already exists.`
        : "Use letters, numbers, '.', '_', or '-' only."
      : null;

  const protectedChanged = isProtected !== (props.env.protected === true);
  const dirty = isRename || description !== (props.env.description ?? "") || protectedChanged;

  return (
    <ModalShell title={`Edit environment '${props.env.name}'`} onClose={props.onClose}>
      {props.error && <ErrorBanner message={props.error} />}
      <FormField label="Name" hint={localError ?? undefined}>
        <TextInput
          value={rename}
          onChange={(v) => {
            setRename(v);
            props.setError(null);
          }}
          testId="environment-rename-input"
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <TextInput
          value={description}
          onChange={setDescription}
          testId="environment-description-input"
        />
      </FormField>
      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: theme.sans,
            fontSize: 12,
            color: theme.text,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={isProtected}
            onChange={(e) => setIsProtected(e.target.checked)}
            data-testid="environment-protected-checkbox"
          />
          Protected (write operations require confirmation)
        </label>
      </div>
      <ModalActions>
        <Button onClick={props.onClose} data-testid="environment-edit-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || !!localError || busy}
          data-testid="environment-edit-submit"
          onClick={async () => {
            setBusy(true);
            const data: { rename?: string; description?: string; protected?: boolean } = {};
            if (isRename) data.rename = trimmedRename;
            if (description !== (props.env.description ?? "")) data.description = description;
            if (protectedChanged) data.protected = isProtected;
            await props.onSubmit(data);
            setBusy(false);
          }}
        >
          {busy ? "Saving..." : "Save changes"}
        </Button>
      </ModalActions>
    </ModalShell>
  );
}

// ── Confirm Remove (shared by namespace + env) ───────────────────────────

function ConfirmRemoveModal(props: {
  title: string;
  subjectKind: "namespace" | "environment";
  subjectName: string;
  impactDescription: string;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
  error: string | null;
}) {
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typedName === props.subjectName;

  return (
    <ModalShell title={props.title} onClose={props.onClose}>
      {props.error && <ErrorBanner message={props.error} />}
      <p
        style={{
          fontFamily: theme.sans,
          fontSize: 12,
          color: theme.text,
          margin: "0 0 12px",
          lineHeight: 1.5,
        }}
      >
        {props.impactDescription}
      </p>
      <FormField label={`Type the ${props.subjectKind} name to confirm`}>
        <TextInput
          value={typedName}
          onChange={setTypedName}
          placeholder={props.subjectName}
          testId={`${props.subjectKind}-remove-confirm-input`}
          autoFocus
        />
      </FormField>
      <ModalActions>
        <Button onClick={props.onClose} data-testid={`${props.subjectKind}-remove-cancel`}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!matches || busy}
          data-testid={`${props.subjectKind}-remove-submit`}
          onClick={async () => {
            setBusy(true);
            await props.onConfirm();
            setBusy(false);
          }}
        >
          {busy ? "Deleting..." : `Delete ${props.subjectKind}`}
        </Button>
      </ModalActions>
    </ModalShell>
  );
}
