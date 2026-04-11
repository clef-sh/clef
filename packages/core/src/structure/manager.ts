import * as fs from "fs";
import * as path from "path";
import { ClefManifest, MatrixCell } from "../types";
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

/**
 * Manages namespace and environment CRUD on the manifest. Phase 1a covers
 * "edit" operations (description, protected flag, rename); Phase 1b will add
 * "add" and "remove".
 *
 * Every mutation runs inside TransactionManager so cell-file renames + the
 * manifest update + SI cascade updates land as one git commit, or roll back
 * via `git reset --hard` on failure.
 *
 * @example
 * ```ts
 * const tx = new TransactionManager(new GitIntegration(runner));
 * const structure = new StructureManager(matrixManager, tx);
 * await structure.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);
 * ```
 */
export class StructureManager {
  constructor(
    private readonly matrixManager: MatrixManager,
    private readonly tx: TransactionManager,
  ) {}

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
