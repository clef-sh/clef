import * as path from "path";
import { ClefManifest } from "../types";
import { SopsClient } from "../sops/client";
import { parse, ImportFormat } from "./parsers";
export type { ImportFormat, ParsedImport } from "./parsers";

export interface ImportOptions {
  format?: ImportFormat;
  prefix?: string;
  keys?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
  stdin?: boolean;
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
  warnings: string[];
  dryRun: boolean;
}

export class ImportRunner {
  constructor(private readonly sopsClient: SopsClient) {}

  async import(
    target: string,
    sourcePath: string | null,
    content: string,
    manifest: ClefManifest,
    repoRoot: string,
    options: ImportOptions,
  ): Promise<ImportResult> {
    const [ns, env] = target.split("/");
    const filePath = path.join(
      repoRoot,
      manifest.file_pattern.replace("{namespace}", ns).replace("{environment}", env),
    );

    // Parse content
    const parsed = parse(content, options.format ?? "auto", sourcePath ?? "");

    // Build candidate key/value pairs
    let candidates = Object.entries(parsed.pairs);

    // Apply prefix filter
    if (options.prefix) {
      const prefix = options.prefix;
      candidates = candidates.filter(([key]) => key.startsWith(prefix));
    }

    // Apply keys filter
    if (options.keys && options.keys.length > 0) {
      const keySet = new Set(options.keys);
      candidates = candidates.filter(([key]) => keySet.has(key));
    }

    const imported: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];
    const warnings = [...parsed.warnings];

    if (options.dryRun) {
      // Dry run: check existing keys but never call encrypt
      let existingKeys = new Set<string>();
      try {
        const decrypted = await this.sopsClient.decrypt(filePath);
        existingKeys = new Set(Object.keys(decrypted.values));
      } catch {
        // File may not exist or be inaccessible — treat as empty
        existingKeys = new Set<string>();
      }

      for (const [key] of candidates) {
        if (existingKeys.has(key) && !options.overwrite) {
          skipped.push(key);
        } else {
          imported.push(key);
        }
      }

      return { imported, skipped, failed, warnings, dryRun: true };
    }

    // Real import
    const decrypted = await this.sopsClient.decrypt(filePath);
    let currentValues: Record<string, string> = { ...decrypted.values };
    const existingKeys = new Set(Object.keys(decrypted.values));

    for (const [key, value] of candidates) {
      if (existingKeys.has(key) && !options.overwrite) {
        skipped.push(key);
        continue;
      }

      try {
        const newValues = { ...currentValues, [key]: value };
        await this.sopsClient.encrypt(filePath, newValues, manifest);
        currentValues = newValues;
        imported.push(key);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Encryption failed";
        failed.push({ key, error: message });
        // Do NOT update currentValues, do NOT rollback previous encrypts. Continue with rest.
      }
    }

    return { imported, skipped, failed, warnings, dryRun: false };
  }
}
