import type { Bulk, CellRef, SecretSource } from "./types";
import type { ClefManifest } from "../types";

/**
 * Wrap a `SecretSource` in a `Bulk` implementation that loops over
 * `readCell` / `writeCell` / `deleteCell`. Sources whose substrate
 * cannot batch — or that simply haven't bothered — get correct
 * behavior for free at the cost of one round-trip per cell.
 *
 * Returned object satisfies `Bulk` only; combine via spread when a
 * caller needs both the source surface and bulk methods.
 */
export function defaultBulk(source: SecretSource): Bulk {
  return {
    async bulkSet(
      namespace: string,
      key: string,
      valuesByEnv: Record<string, string>,
      _manifest: ClefManifest,
    ): Promise<void> {
      for (const [environment, value] of Object.entries(valuesByEnv)) {
        const cell: CellRef = { namespace, environment };
        const existing = (await source.cellExists(cell))
          ? (await source.readCell(cell)).values
          : {};
        await source.writeCell(cell, { ...existing, [key]: value });
      }
    },

    async bulkDelete(namespace: string, key: string, manifest: ClefManifest): Promise<void> {
      for (const env of manifest.environments) {
        const cell: CellRef = { namespace, environment: env.name };
        if (!(await source.cellExists(cell))) continue;
        const data = await source.readCell(cell);
        if (!(key in data.values)) continue;
        const next = { ...data.values };
        delete next[key];
        await source.writeCell(cell, next);
      }
    },

    async copyValue(
      key: string,
      from: CellRef,
      to: CellRef,
      _manifest: ClefManifest,
    ): Promise<void> {
      const src = await source.readCell(from);
      if (!(key in src.values)) {
        throw new Error(
          `Cannot copy: key '${key}' not present in ${from.namespace}/${from.environment}`,
        );
      }
      const dst = (await source.cellExists(to)) ? (await source.readCell(to)).values : {};
      await source.writeCell(to, { ...dst, [key]: src.values[key] });
    },
  };
}
