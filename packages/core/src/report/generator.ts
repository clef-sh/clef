import * as path from "path";
import {
  ClefManifest,
  ClefReport,
  CLEF_REPORT_SCHEMA_VERSION,
  MatrixCell,
  ReportCellMetadata,
  ReportManifestStructure,
  ReportMatrixCell,
  ReportPolicy,
  ReportRecipientSummary,
  ReportRepoIdentity,
  SubprocessRunner,
} from "../types";
import { ManifestParser } from "../manifest/parser";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { LintRunner } from "../lint/runner";
import { checkDependency } from "../dependencies/checker";
import { ReportSanitizer } from "./sanitizer";
import { readSopsKeyNames } from "../sops/keys";
import type { CellRef, Lintable, SecretSource } from "../source/types";

/**
 * Orchestrates all data-gathering for a `clef report` invocation.
 * Matrix key counts are read from SOPS YAML directly (no decryption).
 * Policy issues are gathered via LintRunner then sanitized.
 */
export class ReportGenerator {
  constructor(
    private readonly runner: SubprocessRunner,
    private readonly source: SecretSource & Lintable,
    private readonly matrixManager: MatrixManager,
    private readonly schemaValidator: SchemaValidator,
  ) {}

  /**
   * Generate a full {@link ClefReport} for the given repository root.
   * Each section gathers data independently — partial failures return empty
   * values rather than aborting the entire report.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @param clefVersion - The running CLI version string.
   * @param options - Optional namespace/environment filters.
   */
  async generate(
    repoRoot: string,
    clefVersion: string,
    options?: { namespaceFilter?: string[]; environmentFilter?: string[] },
  ): Promise<ClefReport> {
    let manifest: ClefManifest | null = null;
    try {
      const parser = new ManifestParser();
      manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
    } catch {
      // Manifest parse failure — return minimal report
      const emptyManifest: ReportManifestStructure = {
        manifestVersion: 0,
        filePattern: "",
        environments: [],
        namespaces: [],
        defaultBackend: "",
      };
      return {
        schemaVersion: CLEF_REPORT_SCHEMA_VERSION,
        repoIdentity: await this.buildRepoIdentity(repoRoot, clefVersion),
        manifest: emptyManifest,
        matrix: [],
        policy: { issueCount: { error: 0, warning: 0, info: 0 }, issues: [] },
        recipients: {},
      };
    }

    const [repoIdentity, matrixCells, policy] = await Promise.all([
      this.buildRepoIdentity(repoRoot, clefVersion),
      this.buildMatrixCells(manifest, repoRoot, options),
      this.buildPolicy(manifest, repoRoot),
    ]);

    return {
      schemaVersion: CLEF_REPORT_SCHEMA_VERSION,
      repoIdentity,
      manifest: this.buildManifestStructure(manifest),
      matrix: matrixCells,
      policy,
      recipients: this.buildRecipients(matrixCells),
    };
  }

  private async buildRepoIdentity(
    repoRoot: string,
    clefVersion: string,
  ): Promise<ReportRepoIdentity> {
    let repoOrigin = "";
    let commitSha = "";
    let branch = "";
    let commitTimestamp = "";
    let sopsVersion: string | null = null;

    try {
      const r = await this.runner.run("git", ["remote", "get-url", "origin"], { cwd: repoRoot });
      if (r.exitCode === 0) repoOrigin = this.normalizeRepoOrigin(r.stdout.trim());
    } catch {
      /* ignore */
    }

    try {
      const r = await this.runner.run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
      if (r.exitCode === 0) commitSha = r.stdout.trim();
    } catch {
      /* ignore */
    }

    try {
      const r = await this.runner.run("git", ["branch", "--show-current"], { cwd: repoRoot });
      if (r.exitCode === 0) branch = r.stdout.trim();
    } catch {
      /* ignore */
    }

    try {
      const r = await this.runner.run("git", ["log", "-1", "--format=%cI"], { cwd: repoRoot });
      if (r.exitCode === 0) commitTimestamp = r.stdout.trim();
    } catch {
      /* ignore */
    }

    try {
      const dep = await checkDependency("sops", this.runner);
      sopsVersion = dep?.installed ?? null;
    } catch {
      /* ignore */
    }

    return {
      repoOrigin,
      commitSha,
      branch,
      commitTimestamp,
      reportGeneratedAt: new Date().toISOString(),
      clefVersion,
      sopsVersion,
    };
  }

  private normalizeRepoOrigin(rawUrl: string): string {
    const sshMatch = rawUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
    const httpsMatch = rawUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
    return rawUrl.replace(/\.git$/, "");
  }

  private buildManifestStructure(manifest: ClefManifest): ReportManifestStructure {
    return {
      manifestVersion: manifest.version,
      filePattern: manifest.file_pattern,
      environments: manifest.environments.map((e) => ({
        name: e.name,
        protected: e.protected ?? false,
      })),
      namespaces: manifest.namespaces.map((ns) => ({
        name: ns.name,
        hasSchema: !!ns.schema,
        owners: ns.owners ?? [],
      })),
      defaultBackend: manifest.sops.default_backend,
    };
  }

  private async buildMatrixCells(
    manifest: ClefManifest,
    repoRoot: string,
    options?: { namespaceFilter?: string[]; environmentFilter?: string[] },
  ): Promise<ReportMatrixCell[]> {
    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot);
    const cells = allCells.filter((cell) => {
      const nsOk =
        !options?.namespaceFilter?.length || options.namespaceFilter.includes(cell.namespace);
      const envOk =
        !options?.environmentFilter?.length || options.environmentFilter.includes(cell.environment);
      return nsOk && envOk;
    });

    const result: ReportMatrixCell[] = [];

    for (const cell of cells) {
      result.push(await this.buildCell(cell));
    }

    return result;
  }

  private async buildCell(cell: MatrixCell): Promise<ReportMatrixCell> {
    if (!cell.exists) {
      return {
        namespace: cell.namespace,
        environment: cell.environment,
        filePath: cell.filePath,
        exists: false,
        keyCount: 0,
        pendingCount: 0,
        metadata: null,
      };
    }

    const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };
    const keyCount = this.readKeyCount(cell.filePath);

    let pendingCount = 0;
    try {
      const meta = await this.source.getPendingMetadata(ref);
      pendingCount = meta.pending.length;
    } catch {
      /* ignore */
    }

    let metadata: ReportCellMetadata | null = null;
    try {
      const sopsMetadata = await this.source.getCellMetadata(ref);
      metadata = {
        backend: sopsMetadata.backend,
        recipients: sopsMetadata.recipients,
        lastModified: sopsMetadata.lastModified?.toISOString() ?? null,
      };
    } catch {
      /* ignore */
    }

    return {
      namespace: cell.namespace,
      environment: cell.environment,
      filePath: cell.filePath,
      exists: true,
      keyCount,
      pendingCount,
      metadata,
    };
  }

  private readKeyCount(filePath: string): number {
    return readSopsKeyNames(filePath)?.length ?? 0;
  }

  private async buildPolicy(manifest: ClefManifest, repoRoot: string): Promise<ReportPolicy> {
    try {
      const lintRunner = new LintRunner(this.matrixManager, this.schemaValidator, this.source);
      const lintResult = await lintRunner.run(manifest, repoRoot);
      return new ReportSanitizer().sanitize(lintResult.issues);
    } catch {
      return { issueCount: { error: 0, warning: 0, info: 0 }, issues: [] };
    }
  }

  private buildRecipients(cells: ReportMatrixCell[]): Record<string, ReportRecipientSummary> {
    const recipientMap = new Map<
      string,
      { type: string; environments: Set<string>; fileCount: number }
    >();

    for (const cell of cells) {
      if (!cell.metadata) continue;
      for (const recipient of cell.metadata.recipients) {
        const type = this.inferRecipientType(recipient);
        const existing = recipientMap.get(recipient);
        if (existing) {
          existing.environments.add(cell.environment);
          existing.fileCount++;
        } else {
          recipientMap.set(recipient, {
            type,
            environments: new Set([cell.environment]),
            fileCount: 1,
          });
        }
      }
    }

    const result: Record<string, ReportRecipientSummary> = {};
    for (const [recipient, data] of recipientMap.entries()) {
      result[recipient] = {
        type: data.type,
        environments: Array.from(data.environments),
        fileCount: data.fileCount,
      };
    }
    return result;
  }

  private inferRecipientType(recipient: string): string {
    if (recipient.startsWith("age1")) return "age";
    if (recipient.startsWith("arn:aws:kms:")) return "awskms";
    if (recipient.includes("projects/") && recipient.includes("cryptoKeys/")) return "gcpkms";
    return "pgp";
  }
}
