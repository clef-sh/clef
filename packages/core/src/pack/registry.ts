import type { PackBackend, PackBackendFactory } from "./types";

/**
 * Registry of pack backends. The CLI registers `clef-native` eagerly and
 * may register additional backends discovered via optional plugin packages
 * (e.g. `@clef-sh/pack-vault`). Embedders (tests, IaC synth hooks) may
 * construct a registry directly and register only the backends they need.
 */
export class PackBackendRegistry {
  private readonly factories = new Map<string, PackBackendFactory>();

  /**
   * Register a backend factory under the given id. Throws if a backend
   * with the same id is already registered — collisions surface as a clear
   * error rather than a silent overwrite.
   */
  register(id: string, factory: PackBackendFactory): void {
    if (this.factories.has(id)) {
      throw new Error(`Pack backend "${id}" is already registered.`);
    }
    this.factories.set(id, factory);
  }

  /** Whether a backend with the given id has been registered. */
  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** Registered backend ids, in registration order. */
  list(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Resolve a backend by id. Throws if unknown. Factories may be async so
   * a plugin package can defer construction (e.g. loading a heavy SDK only
   * when the backend is actually used).
   */
  async resolve(id: string): Promise<PackBackend> {
    const factory = this.factories.get(id);
    if (!factory) {
      const available = this.list().join(", ") || "(none)";
      throw new Error(`Unknown pack backend "${id}". Available backends: ${available}`);
    }
    return await factory();
  }
}
