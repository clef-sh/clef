import * as fs from "fs";
import * as path from "path";
import { ClefManifest, MatrixCell } from "../types";
import type { CellRef, SecretSource } from "../source/types";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";
import { TransactionManager } from "../tx";

export interface NamespaceEditOptions {
  /** New name for the namespace. Renames cell files on disk and SI references. */
  rename?: string;
  /** Replace the namespace's description. Manifest-only update. */
  description?: string;
  /** Replace the namespace's schema path. Manifest-only update. */
  schema?: string;
}

export interface EnvironmentEditOptions {
  /** New name for the environment. Renames cell files on disk and SI references. */
  rename?: string;
  /** Replace the environment's description. Manifest-only update. */
  description?: string;
  /** Mark the environment as protected. Manifest-only update. */
  protected?: boolean;
}

export interface AddNamespaceOptions {
  /** Human-readable description for the new namespace. */
  description?: string;
  /** Optional schema file path for the new namespace. */
  schema?: string;
}

export interface AddEnvironmentOptions {
  /** Human-readable description for the new environment. */
  description?: string;
  /** Mark the new environment as protected from the start. */
  protected?: boolean;
}

/**
 * Manages namespace and environment CRUD on the manifest. Covers add, remove,
 * and edit operations. Renames cascade through service identity references;
 * removes refuse if they would orphan an SI (force the user to clean up SIs
 * first) or break the manifest (last namespace, last environment, protected
 * environment).
 *
 * Every mutation runs inside TransactionManager so cell-file ops + the
 * manifest update + SI cascade updates land as one git commit, or roll back
 * via `git reset --hard` on failure.
 *
 * @example
 * ```ts
 * const tx = new TransactionManager(new GitIntegration(runner));
 * const structure = new StructureManager(matrixManager, sopsClient, tx);
 * await structure.addNamespace("billing", {}, manifest, repoRoot);
 * ```
 */
export class StructureManager {
  constructor(
    private readonly matrixManager: MatrixManager,
    /**
     * Factory rather than a single source instance because adding a
     * namespace or environment can extend the manifest, and the scaffold
     * pass needs to write cells under the post-mutation manifest. Same
     * pattern as ResetManager and BackendMigrator.
     */
    private readonly buildSource: (manifest: ClefManifest) => SecretSource,
    private readonly tx: TransactionManager,
  ) {}

  // ── add ──────────────────────────────────────────────────────────────────

  /**
   * Add a new namespace to the manifest and scaffold an empty encrypted cell
   * for every existing environment. Refuses if the name already exists, the
   * identifier is invalid, or any of the target cell files are already on
   * disk.
   */
  async addNamespace(
    name: string,
    opts: AddNamespaceOptions,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    if (manifest.namespaces.some((n) => n.name === name)) {
      throw new Error(`Namespace '${name}' already exists.`);
    }
    this.assertValidIdentifier("namespace", name);

    // Compute the cells we'll scaffold (one per existing env). Refuse if any
    // target file already exists on disk so we never clobber data.
    const newCellPaths = manifest.environments.map((env) => ({
      environment: env.name,
      filePath: path.join(
        repoRoot,
        manifest.file_pattern.replace("{namespace}", name).replace("{environment}", env.name),
      ),
    }));
    for (const cell of newCellPaths) {
      if (fs.existsSync(cell.filePath)) {
        throw new Error(
          `Cannot add namespace '${name}': file '${path.relative(repoRoot, cell.filePath)}' already exists.`,
        );
      }
    }

    // The manifest parser requires a non-empty description string. If the
    // caller didn't provide one, fall back to the namespace name itself —
    // it's better than placeholder text and the user can edit it later.
    const description = opts.description?.trim() || name;

    // Build the in-memory manifest with the new namespace appended so the
    // scaffolding sees it. (Backend resolution doesn't depend on namespace,
    // but it's the principled thing to do.)
    const updatedManifest: ClefManifest = {
      ...manifest,
      namespaces: [
        ...manifest.namespaces,
        {
          name,
          description,
          ...(opts.schema ? { schema: opts.schema } : {}),
        },
      ],
    };

    await this.tx.run(repoRoot, {
      description: `clef namespace add ${name}`,
      paths: [
        ...newCellPaths.map((c) => path.relative(repoRoot, c.filePath)),
        CLEF_MANIFEST_FILENAME,
      ],
      mutate: async () => {
        const source = this.buildSource(updatedManifest);
        for (const cell of newCellPaths) {
          const ref: CellRef = { namespace: name, environment: cell.environment };
          await source.scaffoldCell(ref, updatedManifest);
        }

        const doc = readManifestYaml(repoRoot);
        const namespaces = doc.namespaces as Array<Record<string, unknown>>;
        const entry: Record<string, unknown> = {
          name,
          description,
        };
        if (opts.schema) entry.schema = opts.schema;
        namespaces.push(entry);
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  /**
   * Add a new environment to the manifest and scaffold an empty encrypted
   * cell for every existing namespace. Refuses if the name already exists,
   * the identifier is invalid, or any of the target cell files are already
   * on disk.
   *
   * Does NOT cascade to service identities — existing SIs will not have a
   * config for the new env. Lint will surface that gap; users explicitly
   * close it via `clef service update --add-env` (Phase 1c).
   */
  async addEnvironment(
    name: string,
    opts: AddEnvironmentOptions,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    if (manifest.environments.some((e) => e.name === name)) {
      throw new Error(`Environment '${name}' already exists.`);
    }
    this.assertValidIdentifier("environment", name);

    const newCellPaths = manifest.namespaces.map((ns) => ({
      namespace: ns.name,
      filePath: path.join(
        repoRoot,
        manifest.file_pattern.replace("{namespace}", ns.name).replace("{environment}", name),
      ),
    }));
    for (const cell of newCellPaths) {
      if (fs.existsSync(cell.filePath)) {
        throw new Error(
          `Cannot add environment '${name}': file '${path.relative(repoRoot, cell.filePath)}' already exists.`,
        );
      }
    }

    // The parser requires a non-empty description string. Fall back to the
    // env name if none provided — better than placeholder text, editable later.
    const description = opts.description?.trim() || name;

    const updatedManifest: ClefManifest = {
      ...manifest,
      environments: [
        ...manifest.environments,
        {
          name,
          description,
          ...(opts.protected ? { protected: true } : {}),
        },
      ],
    };

    await this.tx.run(repoRoot, {
      description: `clef env add ${name}`,
      paths: [
        ...newCellPaths.map((c) => path.relative(repoRoot, c.filePath)),
        CLEF_MANIFEST_FILENAME,
      ],
      mutate: async () => {
        const source = this.buildSource(updatedManifest);
        for (const cell of newCellPaths) {
          const ref: CellRef = { namespace: cell.namespace, environment: name };
          await source.scaffoldCell(ref, updatedManifest);
        }

        const doc = readManifestYaml(repoRoot);
        const environments = doc.environments as Array<Record<string, unknown>>;
        const entry: Record<string, unknown> = {
          name,
          description,
        };
        if (opts.protected) entry.protected = true;
        environments.push(entry);
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  // ── remove ───────────────────────────────────────────────────────────────

  /**
   * Remove a namespace from the manifest and delete every cell file under
   * it. Cascades through service identities by removing the namespace from
   * each SI's `namespaces[]` array. Refuses if removing it would leave any
   * SI with zero scope (the user must delete those SIs first or add other
   * namespaces to them) or if it would leave the manifest with zero
   * namespaces.
   */
  async removeNamespace(name: string, manifest: ClefManifest, repoRoot: string): Promise<void> {
    const ns = manifest.namespaces.find((n) => n.name === name);
    if (!ns) {
      throw new Error(
        `Namespace '${name}' not found. Available: ${manifest.namespaces.map((n) => n.name).join(", ")}`,
      );
    }
    if (manifest.namespaces.length === 1) {
      throw new Error(
        `Cannot remove the last namespace from the manifest. The matrix needs at least one namespace.`,
      );
    }

    // Refuse if any SI would be left with zero scope. Force the user to
    // either delete the SI first or expand its scope to other namespaces.
    const orphanedSis = (manifest.service_identities ?? []).filter(
      (si) => si.namespaces.length === 1 && si.namespaces[0] === name,
    );
    if (orphanedSis.length > 0) {
      throw new Error(
        `Cannot remove namespace '${name}': it is the only scope of service identit${orphanedSis.length === 1 ? "y" : "ies"} ${orphanedSis.map((s) => `'${s.name}'`).join(", ")}. ` +
          `Delete those service identit${orphanedSis.length === 1 ? "y" : "ies"} first, or add other namespaces to their scope.`,
      );
    }

    const cellsToDelete = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && c.namespace === name);

    await this.tx.run(repoRoot, {
      description: `clef namespace remove ${name}`,
      paths: this.deletePaths(repoRoot, cellsToDelete),
      mutate: async () => {
        for (const cell of cellsToDelete) {
          fs.unlinkSync(cell.filePath);
          this.unlinkMetaSibling(cell.filePath);
        }

        const doc = readManifestYaml(repoRoot);
        const namespaces = doc.namespaces as Array<Record<string, unknown>>;
        doc.namespaces = namespaces.filter((n) => (n as { name: string }).name !== name);

        // Cascade through service identities — drop the removed namespace
        // from every SI's namespaces[] array.
        const sis = doc.service_identities as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(sis)) {
          for (const si of sis) {
            const siNs = si.namespaces as string[] | undefined;
            if (Array.isArray(siNs)) {
              si.namespaces = siNs.filter((n) => n !== name);
            }
          }
        }
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  /**
   * Remove an environment from the manifest and delete every cell file for
   * it across all namespaces. Cascades through service identities by
   * removing the env entry from each SI's `environments{}` map. Refuses on
   * protected environments (force the user to `clef env edit --unprotect`
   * first), if it would leave the manifest with zero environments, or if
   * the env doesn't exist.
   */
  async removeEnvironment(name: string, manifest: ClefManifest, repoRoot: string): Promise<void> {
    const env = manifest.environments.find((e) => e.name === name);
    if (!env) {
      throw new Error(
        `Environment '${name}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
      );
    }
    if (env.protected) {
      throw new Error(
        `Environment '${name}' is protected. Cannot remove a protected environment. ` +
          `Run 'clef env edit ${name} --unprotect' first.`,
      );
    }
    if (manifest.environments.length === 1) {
      throw new Error(
        `Cannot remove the last environment from the manifest. The matrix needs at least one environment.`,
      );
    }

    const cellsToDelete = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && c.environment === name);

    await this.tx.run(repoRoot, {
      description: `clef env remove ${name}`,
      paths: this.deletePaths(repoRoot, cellsToDelete),
      mutate: async () => {
        for (const cell of cellsToDelete) {
          fs.unlinkSync(cell.filePath);
          this.unlinkMetaSibling(cell.filePath);
        }

        const doc = readManifestYaml(repoRoot);
        const environments = doc.environments as Array<Record<string, unknown>>;
        doc.environments = environments.filter((e) => (e as { name: string }).name !== name);

        // Cascade through service identities — drop the env entry from
        // every SI's environments{} map.
        const sis = doc.service_identities as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(sis)) {
          for (const si of sis) {
            const envs = si.environments as Record<string, unknown> | undefined;
            if (envs && Object.prototype.hasOwnProperty.call(envs, name)) {
              delete envs[name];
            }
          }
        }
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  // ── edit ─────────────────────────────────────────────────────────────────

  /**
   * Edit a namespace's manifest entry, optionally renaming the namespace
   * (which also renames cell files on disk and updates every service
   * identity that references it).
   */
  async editNamespace(
    name: string,
    opts: NamespaceEditOptions,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    const ns = manifest.namespaces.find((n) => n.name === name);
    if (!ns) {
      throw new Error(
        `Namespace '${name}' not found. Available: ${manifest.namespaces.map((n) => n.name).join(", ")}`,
      );
    }

    // Refuse rename collisions before opening the transaction
    if (opts.rename && opts.rename !== name) {
      if (manifest.namespaces.some((n) => n.name === opts.rename)) {
        throw new Error(`Namespace '${opts.rename}' already exists.`);
      }
      this.assertValidIdentifier("namespace", opts.rename);
    }

    // Compute the file ops we need to perform. Renames produce both an
    // old-path and a new-path entry so the transaction can stage the new
    // files and roll back any creations on failure.
    const isRename = opts.rename !== undefined && opts.rename !== name;
    const renamePairs = isRename
      ? this.collectRenamePairs(manifest, repoRoot, name, opts.rename!, "namespace")
      : [];

    // Refuse rename if any target file already exists — this would clobber data
    if (isRename) {
      for (const pair of renamePairs) {
        if (fs.existsSync(pair.to)) {
          throw new Error(
            `Rename target '${path.relative(repoRoot, pair.to)}' already exists. ` +
              `Move or remove it first.`,
          );
        }
      }
    }

    const description = this.describeEdit("namespace", name, opts);

    await this.tx.run(repoRoot, {
      description,
      paths: this.txPaths(repoRoot, renamePairs),
      mutate: async () => {
        if (isRename) {
          this.applyRenames(renamePairs);
        }

        const doc = readManifestYaml(repoRoot);
        this.applyNamespaceManifestEdit(doc, name, opts);
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  /**
   * Edit an environment's manifest entry, optionally renaming the env
   * (which also renames cell files across every namespace and updates
   * every service identity's environments map key).
   */
  async editEnvironment(
    name: string,
    opts: EnvironmentEditOptions,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    const env = manifest.environments.find((e) => e.name === name);
    if (!env) {
      throw new Error(
        `Environment '${name}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
      );
    }

    if (opts.rename && opts.rename !== name) {
      if (manifest.environments.some((e) => e.name === opts.rename)) {
        throw new Error(`Environment '${opts.rename}' already exists.`);
      }
      this.assertValidIdentifier("environment", opts.rename);
    }

    const isRename = opts.rename !== undefined && opts.rename !== name;
    const renamePairs = isRename
      ? this.collectRenamePairs(manifest, repoRoot, name, opts.rename!, "environment")
      : [];

    if (isRename) {
      for (const pair of renamePairs) {
        if (fs.existsSync(pair.to)) {
          throw new Error(
            `Rename target '${path.relative(repoRoot, pair.to)}' already exists. ` +
              `Move or remove it first.`,
          );
        }
      }
    }

    const description = this.describeEdit("env", name, opts);

    await this.tx.run(repoRoot, {
      description,
      paths: this.txPaths(repoRoot, renamePairs),
      mutate: async () => {
        if (isRename) {
          this.applyRenames(renamePairs);
        }

        const doc = readManifestYaml(repoRoot);
        this.applyEnvironmentManifestEdit(doc, name, opts);
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * For a rename, return every (oldPath, newPath) pair that needs to move on
   * disk. Includes the encrypted cell files AND their sibling .clef-meta.yaml
   * pending-metadata files. Filters to existing cells only — empty cells
   * (no file on disk) need no rename.
   */
  private collectRenamePairs(
    manifest: ClefManifest,
    repoRoot: string,
    oldName: string,
    newName: string,
    axis: "namespace" | "environment",
  ): Array<{ from: string; to: string }> {
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter(
        (c) =>
          c.exists && (axis === "namespace" ? c.namespace === oldName : c.environment === oldName),
      );

    const pairs: Array<{ from: string; to: string }> = [];
    for (const cell of cells) {
      const newCellPath = this.swapAxisInCellPath(repoRoot, manifest, cell, axis, newName);
      pairs.push({ from: cell.filePath, to: newCellPath });

      // Sibling .clef-meta.yaml file (only include if it actually exists)
      const oldMeta = cell.filePath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml");
      if (fs.existsSync(oldMeta)) {
        const newMeta = newCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml");
        pairs.push({ from: oldMeta, to: newMeta });
      }
    }
    return pairs;
  }

  /**
   * Build the new file path by substituting the renamed axis (namespace or
   * environment) into the manifest's file_pattern. Reuses MatrixManager's
   * resolution logic instead of doing string surgery on the existing path.
   */
  private swapAxisInCellPath(
    repoRoot: string,
    manifest: ClefManifest,
    cell: MatrixCell,
    axis: "namespace" | "environment",
    newName: string,
  ): string {
    const ns = axis === "namespace" ? newName : cell.namespace;
    const env = axis === "environment" ? newName : cell.environment;
    return path.join(
      repoRoot,
      manifest.file_pattern.replace("{namespace}", ns).replace("{environment}", env),
    );
  }

  /**
   * Compute the repo-relative paths a transaction needs to know about.
   * Includes both ends of every rename plus the manifest itself.
   */
  private txPaths(repoRoot: string, renamePairs: Array<{ from: string; to: string }>): string[] {
    const paths = new Set<string>();
    for (const pair of renamePairs) {
      paths.add(path.relative(repoRoot, pair.from));
      paths.add(path.relative(repoRoot, pair.to));
    }
    paths.add(CLEF_MANIFEST_FILENAME);
    return [...paths];
  }

  /**
   * Apply each rename in order. Creates parent directories as needed (a
   * namespace rename moves files into a brand-new directory).
   */
  private applyRenames(pairs: Array<{ from: string; to: string }>): void {
    for (const pair of pairs) {
      const targetDir = path.dirname(pair.to);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.renameSync(pair.from, pair.to);
    }
  }

  /**
   * Compute the repo-relative paths for a remove op. Includes every cell
   * file being deleted, every existing .clef-meta.yaml sibling, and the
   * manifest itself.
   */
  private deletePaths(repoRoot: string, cells: MatrixCell[]): string[] {
    const paths = new Set<string>();
    for (const cell of cells) {
      paths.add(path.relative(repoRoot, cell.filePath));
      const meta = cell.filePath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml");
      if (fs.existsSync(meta)) {
        paths.add(path.relative(repoRoot, meta));
      }
    }
    paths.add(CLEF_MANIFEST_FILENAME);
    return [...paths];
  }

  /**
   * Delete the .clef-meta.yaml sibling of a cell file if it exists. No-op
   * otherwise. Used by remove ops to keep pending-state files in sync with
   * the cells they describe.
   */
  private unlinkMetaSibling(cellPath: string): void {
    const meta = cellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml");
    if (fs.existsSync(meta)) {
      fs.unlinkSync(meta);
    }
  }

  /**
   * Mutate the manifest doc in place to apply a namespace edit. Handles
   * description/schema replacement and the rename cascade through every
   * service identity that references the namespace.
   */
  private applyNamespaceManifestEdit(
    doc: Record<string, unknown>,
    name: string,
    opts: NamespaceEditOptions,
  ): void {
    const namespaces = doc.namespaces as Array<Record<string, unknown>>;
    const ns = namespaces.find((n) => (n as Record<string, unknown>).name === name);
    if (!ns) {
      throw new Error(`Namespace '${name}' disappeared from the manifest mid-transaction.`);
    }

    if (opts.rename && opts.rename !== name) {
      ns.name = opts.rename;
      // Cascade through service identities — each SI references namespaces by string name
      const sis = doc.service_identities as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(sis)) {
        for (const si of sis) {
          const siNs = si.namespaces as string[] | undefined;
          if (Array.isArray(siNs)) {
            const idx = siNs.indexOf(name);
            if (idx !== -1) siNs[idx] = opts.rename;
          }
        }
      }
    }
    if (opts.description !== undefined) {
      ns.description = opts.description;
    }
    if (opts.schema !== undefined) {
      // Empty string clears the schema reference; any other value sets it.
      if (opts.schema === "") {
        delete ns.schema;
      } else {
        ns.schema = opts.schema;
      }
    }
  }

  /**
   * Mutate the manifest doc in place to apply an environment edit. Handles
   * description/protected updates and the rename cascade through every
   * service identity's environments map.
   */
  private applyEnvironmentManifestEdit(
    doc: Record<string, unknown>,
    name: string,
    opts: EnvironmentEditOptions,
  ): void {
    const environments = doc.environments as Array<Record<string, unknown>>;
    const env = environments.find((e) => (e as Record<string, unknown>).name === name);
    if (!env) {
      throw new Error(`Environment '${name}' disappeared from the manifest mid-transaction.`);
    }

    if (opts.rename && opts.rename !== name) {
      env.name = opts.rename;
      // Cascade through service identities. The SI's environments map is
      // keyed by env name, so we need to rename the key while preserving
      // insertion order (so the resulting YAML diff is minimal).
      const sis = doc.service_identities as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(sis)) {
        for (const si of sis) {
          const envs = si.environments as Record<string, unknown> | undefined;
          if (envs && Object.prototype.hasOwnProperty.call(envs, name)) {
            si.environments = renameKeyPreservingOrder(envs, name, opts.rename);
          }
        }
      }
    }
    if (opts.description !== undefined) {
      env.description = opts.description;
    }
    if (opts.protected !== undefined) {
      if (opts.protected) {
        env.protected = true;
      } else {
        delete env.protected;
      }
    }
  }

  /** Reject rename targets that aren't safe path segments. */
  private assertValidIdentifier(kind: "namespace" | "environment", name: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(
        `Invalid ${kind} name '${name}'. Use letters, numbers, '.', '_', or '-' only.`,
      );
    }
  }

  /** Build the human-readable commit message for an edit. */
  private describeEdit(
    kind: "namespace" | "env",
    name: string,
    opts: NamespaceEditOptions | EnvironmentEditOptions,
  ): string {
    const parts: string[] = [];
    if (opts.rename) parts.push(`rename to ${opts.rename}`);
    if ("description" in opts && opts.description !== undefined) parts.push("description");
    if ("schema" in opts && opts.schema !== undefined) parts.push("schema");
    if ("protected" in opts && opts.protected !== undefined) {
      parts.push(opts.protected ? "protect" : "unprotect");
    }
    return `clef ${kind} edit ${name}: ${parts.join(", ") || "no-op"}`;
  }
}

/**
 * Build a new object that contains the same keys as `obj`, in the same order,
 * but with the entry `oldKey` replaced by `newKey` (same value). Used for
 * env-rename cascades through SI environment maps so the YAML diff stays clean.
 */
function renameKeyPreservingOrder(
  obj: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k === oldKey ? newKey : k] = obj[k];
  }
  return out;
}
