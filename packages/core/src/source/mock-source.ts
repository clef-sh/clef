/**
 * In-memory test fixture used by CLI command tests and any future
 * consumer that needs to exercise source-shaped code paths without a
 * real git+SOPS substrate. Production code must NOT depend on this
 * file — it is exported under `@clef-sh/core` solely so workspace
 * tests can import it.
 *
 * Capability dialing: pass `capabilities: { lint: false, ... }` to
 * construct a source missing specific traits, so tests can assert
 * `SourceCapabilityUnsupportedError` paths (Phase 5+).
 */
import type {
  AddNamespaceOptions,
  AddEnvironmentOptions,
  AddRecipientRequest,
  Bulk,
  CellPendingMetadata,
  CellRef,
  CellData,
  Lintable,
  MergeAware,
  Migratable,
  RecipientDriftResult,
  RecipientManaged,
  RemoveRecipientRequest,
  Rotatable,
  RotateOptions,
  SecretSource,
  Structural,
} from "./types";
import { defaultBulk } from "./default-bulk";
import type { ClefManifest, SopsMetadata } from "../types";
import type { Recipient, RecipientsResult } from "../recipients";
import type { MigrationOptions, MigrationResult, MigrationTarget } from "../migration/backend";
import type { MergeResult } from "../merge/driver";

interface MockCapabilityToggles {
  lint?: boolean;
  rotate?: boolean;
  recipients?: boolean;
  merge?: boolean;
  migrate?: boolean;
  bulk?: boolean;
  structural?: boolean;
}

interface MockSecretSourceOptions {
  id?: string;
  description?: string;
  /** Pre-populated cell values keyed by `${namespace}/${environment}`. */
  cells?: Record<string, Record<string, string>>;
  /** Default recipients populated into every read cell's metadata. */
  recipients?: string[];
  /** Capability toggles (default: all true). */
  capabilities?: MockCapabilityToggles;
}

function cellKey(cell: CellRef): string {
  return `${cell.namespace}/${cell.environment}`;
}

function defaultMetadata(recipients: string[]): SopsMetadata {
  return {
    backend: "age",
    recipients,
    lastModified: new Date(0),
    lastModifiedPresent: false,
    version: "mock",
  };
}

function emptyPending(): CellPendingMetadata {
  return { version: 1, pending: [], rotations: [] };
}

/**
 * In-memory `SecretSource` implementing every trait by default. Toggle
 * capabilities off via the `capabilities` constructor option to
 * simulate a source that does not support a given feature.
 *
 * The `_disabled*` private fields exist because TypeScript type guards
 * detect trait support by method presence. To "disable" a capability
 * the corresponding methods are simply not defined on the instance —
 * the public class definition declares them, but the constructor
 * deletes them when toggled off.
 */
export class MockSecretSource implements SecretSource {
  readonly id: string;
  readonly description: string;
  private readonly cells = new Map<string, Record<string, string>>();
  private readonly pending = new Map<string, CellPendingMetadata>();
  private readonly recipients: string[];

  constructor(options: MockSecretSourceOptions = {}) {
    this.id = options.id ?? "mock";
    this.description = options.description ?? "In-memory test source";
    this.recipients = options.recipients ?? ["age1mockrecipient"];
    if (options.cells) {
      for (const [k, v] of Object.entries(options.cells)) this.cells.set(k, { ...v });
    }
    const cap = {
      lint: true,
      rotate: true,
      recipients: true,
      merge: true,
      migrate: true,
      bulk: true,
      structural: true,
      ...options.capabilities,
    };
    // Assigning `undefined` as an own property shadows the prototype
    // method so `typeof source.foo === "function"` returns false at the
    // type-guard layer. `delete this.foo` does NOT work here because
    // class methods live on the prototype, not the instance.
    const off = (name: string): void => {
      (this as unknown as Record<string, unknown>)[name] = undefined;
    };
    if (!cap.lint) {
      off("validateEncryption");
      off("checkRecipientDrift");
    }
    if (!cap.rotate) off("rotate");
    if (!cap.recipients) {
      off("listRecipients");
      off("addRecipient");
      off("removeRecipient");
    }
    if (!cap.merge) {
      off("mergeCells");
      off("installMergeDriver");
      off("uninstallMergeDriver");
      off("installHooks");
      off("uninstallHooks");
    }
    if (!cap.migrate) off("migrateBackend");
    if (!cap.bulk) {
      off("bulkSet");
      off("bulkDelete");
      off("copyValue");
    }
    if (!cap.structural) {
      off("addNamespace");
      off("removeNamespace");
      off("renameNamespace");
      off("addEnvironment");
      off("removeEnvironment");
      off("renameEnvironment");
    }
  }

  // ── Core SecretSource ──────────────────────────────────────────────────

  async readCell(cell: CellRef): Promise<CellData> {
    const values = this.cells.get(cellKey(cell));
    if (!values) {
      throw new Error(`Mock cell not found: ${cellKey(cell)}`);
    }
    return { values: { ...values }, metadata: defaultMetadata(this.recipients) };
  }

  async writeCell(cell: CellRef, values: Record<string, string>): Promise<void> {
    this.cells.set(cellKey(cell), { ...values });
  }

  async deleteCell(cell: CellRef): Promise<void> {
    this.cells.delete(cellKey(cell));
    this.pending.delete(cellKey(cell));
  }

  async cellExists(cell: CellRef): Promise<boolean> {
    return this.cells.has(cellKey(cell));
  }

  async listKeys(cell: CellRef): Promise<string[]> {
    const values = this.cells.get(cellKey(cell));
    return values ? Object.keys(values) : [];
  }

  async getCellMetadata(_cell: CellRef): Promise<SopsMetadata> {
    return defaultMetadata(this.recipients);
  }

  async scaffoldCell(cell: CellRef, _manifest: ClefManifest): Promise<void> {
    if (!this.cells.has(cellKey(cell))) this.cells.set(cellKey(cell), {});
  }

  async getPendingMetadata(cell: CellRef): Promise<CellPendingMetadata> {
    return this.pending.get(cellKey(cell)) ?? emptyPending();
  }

  async markPending(cell: CellRef, keys: string[], setBy: string): Promise<void> {
    const meta = this.pending.get(cellKey(cell)) ?? emptyPending();
    const now = new Date();
    for (const key of keys) {
      if (!meta.pending.find((p) => p.key === key)) {
        meta.pending.push({ key, since: now, setBy });
      }
    }
    this.pending.set(cellKey(cell), meta);
  }

  async markResolved(cell: CellRef, keys: string[]): Promise<void> {
    const meta = this.pending.get(cellKey(cell));
    if (!meta) return;
    meta.pending = meta.pending.filter((p) => !keys.includes(p.key));
    this.pending.set(cellKey(cell), meta);
  }

  async recordRotation(cell: CellRef, keys: string[], rotatedBy: string): Promise<void> {
    const meta = this.pending.get(cellKey(cell)) ?? emptyPending();
    const now = new Date();
    for (const key of keys) {
      const existing = meta.rotations.find((r) => r.key === key);
      if (existing) {
        existing.lastRotatedAt = now;
        existing.rotatedBy = rotatedBy;
        existing.rotationCount += 1;
      } else {
        meta.rotations.push({ key, lastRotatedAt: now, rotatedBy, rotationCount: 1 });
      }
    }
    this.pending.set(cellKey(cell), meta);
  }

  async removeRotation(cell: CellRef, keys: string[]): Promise<void> {
    const meta = this.pending.get(cellKey(cell));
    if (!meta) return;
    meta.rotations = meta.rotations.filter((r) => !keys.includes(r.key));
    this.pending.set(cellKey(cell), meta);
  }

  // ── Lintable ───────────────────────────────────────────────────────────

  async validateEncryption(cell: CellRef): Promise<boolean> {
    return this.cells.has(cellKey(cell));
  }

  async checkRecipientDrift(_cell: CellRef, expected: string[]): Promise<RecipientDriftResult> {
    const missing = expected.filter((r) => !this.recipients.includes(r));
    const unexpected = this.recipients.filter((r) => !expected.includes(r));
    return { missing, unexpected };
  }

  // ── Rotatable ──────────────────────────────────────────────────────────

  async rotate(_cell: CellRef, _opts: RotateOptions): Promise<void> {
    /* in-memory: no-op */
  }

  // ── RecipientManaged ───────────────────────────────────────────────────

  async listRecipients(_manifest: ClefManifest, _environment?: string): Promise<Recipient[]> {
    return this.recipients.map((key) => ({ key, preview: key.slice(0, 12) }));
  }

  async addRecipient(req: AddRecipientRequest): Promise<RecipientsResult> {
    if (!this.recipients.includes(req.key)) this.recipients.push(req.key);
    return {
      added: { key: req.key, preview: req.key.slice(0, 12), label: req.label },
      recipients: this.recipients.map((key) => ({ key, preview: key.slice(0, 12) })),
      reEncryptedFiles: [...this.cells.keys()],
      failedFiles: [],
      warnings: [],
    };
  }

  async removeRecipient(req: RemoveRecipientRequest): Promise<RecipientsResult> {
    const idx = this.recipients.indexOf(req.key);
    if (idx >= 0) this.recipients.splice(idx, 1);
    return {
      removed: { key: req.key, preview: req.key.slice(0, 12) },
      recipients: this.recipients.map((key) => ({ key, preview: key.slice(0, 12) })),
      reEncryptedFiles: [...this.cells.keys()],
      failedFiles: [],
      warnings: [],
    };
  }

  // ── MergeAware ─────────────────────────────────────────────────────────

  async mergeCells(_base: CellRef, _ours: CellRef, _theirs: CellRef): Promise<MergeResult> {
    return { clean: true, merged: {}, conflicts: [], keys: [] };
  }
  async installMergeDriver(_repoRoot: string): Promise<void> {}
  async uninstallMergeDriver(_repoRoot: string): Promise<void> {}
  async installHooks(_repoRoot: string): Promise<void> {}
  async uninstallHooks(_repoRoot: string): Promise<void> {}

  // ── Migratable ─────────────────────────────────────────────────────────

  async migrateBackend(
    _target: MigrationTarget,
    _opts: MigrationOptions,
  ): Promise<MigrationResult> {
    return {
      migratedFiles: [],
      skippedFiles: [],
      rolledBack: false,
      verifiedFiles: [],
      warnings: [],
    };
  }

  // ── Bulk ───────────────────────────────────────────────────────────────

  async bulkSet(
    namespace: string,
    key: string,
    valuesByEnv: Record<string, string>,
    manifest: ClefManifest,
  ): Promise<void> {
    await defaultBulk(this).bulkSet(namespace, key, valuesByEnv, manifest);
  }
  async bulkDelete(namespace: string, key: string, manifest: ClefManifest): Promise<void> {
    await defaultBulk(this).bulkDelete(namespace, key, manifest);
  }
  async copyValue(key: string, from: CellRef, to: CellRef, manifest: ClefManifest): Promise<void> {
    await defaultBulk(this).copyValue(key, from, to, manifest);
  }

  // ── Structural ─────────────────────────────────────────────────────────

  async addNamespace(
    _name: string,
    _opts: AddNamespaceOptions,
    _manifest: ClefManifest,
  ): Promise<void> {}
  async removeNamespace(name: string, _manifest: ClefManifest): Promise<void> {
    for (const k of [...this.cells.keys()]) {
      if (k.startsWith(`${name}/`)) this.cells.delete(k);
    }
  }
  async renameNamespace(from: string, to: string, _manifest: ClefManifest): Promise<void> {
    for (const k of [...this.cells.keys()]) {
      if (k.startsWith(`${from}/`)) {
        const renamed = `${to}/${k.slice(from.length + 1)}`;
        this.cells.set(renamed, this.cells.get(k)!);
        this.cells.delete(k);
      }
    }
  }
  async addEnvironment(
    _name: string,
    _opts: AddEnvironmentOptions,
    _manifest: ClefManifest,
  ): Promise<void> {}
  async removeEnvironment(name: string, _manifest: ClefManifest): Promise<void> {
    for (const k of [...this.cells.keys()]) {
      if (k.endsWith(`/${name}`)) this.cells.delete(k);
    }
  }
  async renameEnvironment(from: string, to: string, _manifest: ClefManifest): Promise<void> {
    for (const k of [...this.cells.keys()]) {
      if (k.endsWith(`/${from}`)) {
        const renamed = `${k.slice(0, k.length - from.length)}${to}`;
        this.cells.set(renamed, this.cells.get(k)!);
        this.cells.delete(k);
      }
    }
  }
}

// Class-level type checks: ensure MockSecretSource truly implements every trait.
// (Compile-time only — no runtime overhead.)
type _AssertImplements = MockSecretSource &
  Lintable &
  Rotatable &
  RecipientManaged &
  MergeAware &
  Migratable &
  Bulk &
  Structural;
const _typecheck: _AssertImplements | undefined = undefined;
void _typecheck;
