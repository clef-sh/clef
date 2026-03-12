import { DecryptedFile, ExecOptions, ExportOptions } from "../types";

/**
 * Prepares decrypted secrets for consumption via environment injection or shell export.
 *
 * @example
 * ```ts
 * const client = new ConsumptionClient();
 * const env = client.prepareEnvironment(decrypted, process.env, { prefix: "APP_" });
 * ```
 */
export class ConsumptionClient {
  /**
   * Merges decrypted values into a base environment, respecting --only, --prefix, and --no-override.
   * Returns a new environment record suitable for child_process.spawn.
   */
  prepareEnvironment(
    decryptedFile: DecryptedFile,
    baseEnv: Record<string, string | undefined>,
    options: ExecOptions = {},
  ): Record<string, string> {
    const result: Record<string, string> = {};

    // Copy base environment
    for (const [k, v] of Object.entries(baseEnv)) {
      if (v !== undefined) {
        result[k] = v;
      }
    }

    let entries = Object.entries(decryptedFile.values);

    // --only: filter to specified keys
    if (options.only && options.only.length > 0) {
      const allowed = new Set(options.only);
      entries = entries.filter(([key]) => allowed.has(key));
    }

    // Inject values with optional prefix
    for (const [key, value] of entries) {
      const envKey = options.prefix ? `${options.prefix}${key}` : key;

      // --no-override: skip keys that already exist in the base environment
      if (options.noOverride && envKey in result) {
        continue;
      }

      result[envKey] = value;
    }

    return result;
  }

  /**
   * Formats decrypted values for stdout output.
   * Values are single-quoted; embedded single quotes are escaped as '\''.
   */
  formatExport(
    decryptedFile: DecryptedFile,
    format: ExportOptions["format"],
    noExport: boolean,
  ): string {
    if (format !== "env") {
      throw new Error(
        `Unsupported export format '${format}'. Only 'env' is supported.\n` +
          "Clef does not support formats that encourage writing plaintext secrets to disk.\n" +
          "Use 'clef exec' to inject secrets directly into a process, or 'clef export --format env' to print shell export statements to stdout.",
      );
    }

    const lines: string[] = [];
    const prefix = noExport ? "" : "export ";

    for (const [key, value] of Object.entries(decryptedFile.values)) {
      // Single-quote the value; escape embedded single quotes as '\''
      const escaped = value.replace(/'/g, "'\\''");
      lines.push(`${prefix}${key}='${escaped}'`);
    }

    return lines.join("\n") + "\n";
  }
}
