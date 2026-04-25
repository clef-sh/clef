import React, { useState, useCallback } from "react";
import { apiFetch } from "../api";
import { Button } from "../components/Button";
import { Toolbar, Dialog, Field, Input } from "../primitives";
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
      <div className="flex flex-1 flex-col">
        <Toolbar>
          <div>
            <Toolbar.Title>Manifest</Toolbar.Title>
            <Toolbar.Subtitle>Loading...</Toolbar.Subtitle>
          </div>
        </Toolbar>
      </div>
    );
  }

  const namespaces = manifest.namespaces;
  const environments = manifest.environments;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar>
        <div>
          <Toolbar.Title>Manifest</Toolbar.Title>
          <Toolbar.Subtitle>
            {`${namespaces.length} namespaces · ${environments.length} environments`}
          </Toolbar.Subtitle>
        </div>
      </Toolbar>

      <div className="flex-1 overflow-auto p-7">
        {/* Namespaces section */}
        <Section
          title="Namespaces"
          actionLabel="+ Namespace"
          onAction={() => setModal({ kind: "addNamespace" })}
          actionTestId="add-namespace-btn"
        >
          {namespaces.length === 0 ? (
            <EmptyMessage message="No namespaces declared yet." />
          ) : (
            <EntityList>
              {namespaces.map((ns) => (
                <EntityRow
                  key={ns.name}
                  testId={`namespace-row-${ns.name}`}
                  name={ns.name}
                  description={ns.description}
                  badges={ns.schema ? [{ label: `schema: ${ns.schema}`, tone: "purple" }] : []}
                  onEdit={() => setModal({ kind: "editNamespace", ns })}
                  onDelete={() => setModal({ kind: "removeNamespace", ns })}
                />
              ))}
            </EntityList>
          )}
        </Section>

        {/* Environments section */}
        <div className="mt-9">
          <Section
            title="Environments"
            actionLabel="+ Environment"
            onAction={() => setModal({ kind: "addEnvironment" })}
            actionTestId="add-environment-btn"
          >
            {environments.length === 0 ? (
              <EmptyMessage message="No environments declared yet." />
            ) : (
              <EntityList>
                {environments.map((env) => (
                  <EntityRow
                    key={env.name}
                    testId={`environment-row-${env.name}`}
                    name={env.name}
                    description={env.description}
                    badges={env.protected ? [{ label: "protected", tone: "stop" }] : []}
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
      <AddNamespaceModal
        open={modal.kind === "addNamespace"}
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

      <AddEnvironmentModal
        open={modal.kind === "addEnvironment"}
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
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="font-sans text-[14px] font-semibold text-bone tracking-[-0.01em] m-0">
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
    <div className="border border-edge rounded-lg bg-ink-850 overflow-hidden">{props.children}</div>
  );
}

type BadgeTone = "purple" | "stop";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  purple: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  stop: "text-stop-500 bg-stop-500/10 border-stop-500/20",
};

function EntityRow(props: {
  testId: string;
  name: string;
  description: string | undefined;
  badges: { label: string; tone: BadgeTone }[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={props.testId}
      className="flex items-center px-4 py-3 border-b border-edge last:border-0 gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[13px] font-semibold text-bone flex items-center gap-2">
          {props.name}
          {props.badges.map((b) => (
            <span
              key={b.label}
              className={`font-sans text-[10px] font-medium border rounded-pill px-2 py-px ${BADGE_TONE_CLASSES[b.tone]}`}
            >
              {b.label}
            </span>
          ))}
        </div>
        {props.description && (
          <div className="font-sans text-[12px] text-ash mt-0.5">{props.description}</div>
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

function EmptyMessage(props: { message: string }) {
  return (
    <div className="p-6 border border-dashed border-edge rounded-lg text-center font-sans text-[12px] text-ash">
      {props.message}
    </div>
  );
}

// ── Modal primitives ─────────────────────────────────────────────────────

function ModalHeading(props: { children: React.ReactNode }) {
  // Tests rely on an actual heading element (`getByRole("heading")`), so we
  // emit an h3 inside Dialog.Title's wrapper.
  return (
    <Dialog.Title>
      <h3 className="font-sans text-[16px] font-semibold text-bone m-0">{props.children}</h3>
    </Dialog.Title>
  );
}

function ErrorBanner(props: { message: string }) {
  return (
    <div
      data-testid="manifest-modal-error"
      className="px-3 py-2 bg-stop-500/10 border border-stop-500/20 rounded-md text-stop-500 font-sans text-[12px] mb-3"
    >
      {props.message}
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
  open: boolean;
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

  // Reset state when the dialog reopens fresh.
  React.useEffect(() => {
    if (props.open) {
      setName("");
      setDescription("");
      setSchema("");
      setBusy(false);
    }
  }, [props.open]);

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
    <Dialog open={props.open} onClose={props.onClose}>
      <ModalHeading>Add namespace</ModalHeading>
      <Dialog.Body>
        {props.error && <ErrorBanner message={props.error} />}
        <div className="flex flex-col gap-3.5">
          <Field label="Name" hint={localError ?? undefined}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                props.setError(null);
              }}
              placeholder="payments"
              data-testid="namespace-name-input"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Payment processing secrets"
              data-testid="namespace-description-input"
            />
          </Field>
          <Field label="Schema (optional)" hint="Path to a YAML schema file in the repo.">
            <Input
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              placeholder="schemas/payments.yaml"
              data-testid="namespace-schema-input"
            />
          </Field>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
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
      </Dialog.Footer>
    </Dialog>
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
    <Dialog open onClose={props.onClose}>
      <ModalHeading>{`Edit namespace '${props.ns.name}'`}</ModalHeading>
      <Dialog.Body>
        {props.error && <ErrorBanner message={props.error} />}
        <div className="flex flex-col gap-3.5">
          <Field label="Name" hint={localError ?? undefined}>
            <Input
              value={rename}
              onChange={(e) => {
                setRename(e.target.value);
                props.setError(null);
              }}
              data-testid="namespace-rename-input"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="namespace-description-input"
            />
          </Field>
          <Field label="Schema (optional)" hint="Empty to clear.">
            <Input
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              data-testid="namespace-schema-input"
            />
          </Field>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
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
      </Dialog.Footer>
    </Dialog>
  );
}

// ── Add Environment ──────────────────────────────────────────────────────

function AddEnvironmentModal(props: {
  open: boolean;
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

  React.useEffect(() => {
    if (props.open) {
      setName("");
      setDescription("");
      setIsProtected(false);
      setBusy(false);
    }
  }, [props.open]);

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
    <Dialog open={props.open} onClose={props.onClose}>
      <ModalHeading>Add environment</ModalHeading>
      <Dialog.Body>
        {props.error && <ErrorBanner message={props.error} />}
        <div className="flex flex-col gap-3.5">
          <Field label="Name" hint={localError ?? undefined}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                props.setError(null);
              }}
              placeholder="staging"
              data-testid="environment-name-input"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pre-production"
              data-testid="environment-description-input"
            />
          </Field>
          <label className="flex items-center gap-2 font-sans text-[12px] text-bone cursor-pointer">
            <input
              type="checkbox"
              checked={isProtected}
              onChange={(e) => setIsProtected(e.target.checked)}
              data-testid="environment-protected-checkbox"
            />
            Mark as protected
          </label>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
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
      </Dialog.Footer>
    </Dialog>
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
    <Dialog open onClose={props.onClose}>
      <ModalHeading>{`Edit environment '${props.env.name}'`}</ModalHeading>
      <Dialog.Body>
        {props.error && <ErrorBanner message={props.error} />}
        <div className="flex flex-col gap-3.5">
          <Field label="Name" hint={localError ?? undefined}>
            <Input
              value={rename}
              onChange={(e) => {
                setRename(e.target.value);
                props.setError(null);
              }}
              data-testid="environment-rename-input"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="environment-description-input"
            />
          </Field>
          <label className="flex items-center gap-2 font-sans text-[12px] text-bone cursor-pointer">
            <input
              type="checkbox"
              checked={isProtected}
              onChange={(e) => setIsProtected(e.target.checked)}
              data-testid="environment-protected-checkbox"
            />
            Protected (write operations require confirmation)
          </label>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
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
      </Dialog.Footer>
    </Dialog>
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
    <Dialog open onClose={props.onClose}>
      <ModalHeading>{props.title}</ModalHeading>
      <Dialog.Body>
        {props.error && <ErrorBanner message={props.error} />}
        <p className="font-sans text-[12px] text-bone m-0 mb-3 leading-relaxed">
          {props.impactDescription}
        </p>
        <Field label={`Type the ${props.subjectKind} name to confirm`}>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={props.subjectName}
            data-testid={`${props.subjectKind}-remove-confirm-input`}
            autoFocus
          />
        </Field>
      </Dialog.Body>
      <Dialog.Footer>
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
      </Dialog.Footer>
    </Dialog>
  );
}
