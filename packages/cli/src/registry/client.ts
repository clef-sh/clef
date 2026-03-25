export const DEFAULT_REGISTRY = "https://raw.githubusercontent.com/clef-sh/clef/main/brokers";

export interface RegistryBroker {
  name: string;
  version: string;
  description: string;
  author: string;
  provider: string;
  tier: number;
  path: string;
  outputKeys: string[];
}

export interface RegistryIndex {
  version: number;
  generatedAt: string;
  brokers: RegistryBroker[];
}

/**
 * Fetch the broker registry index.
 */
export async function fetchIndex(registryUrl: string = DEFAULT_REGISTRY): Promise<RegistryIndex> {
  const url = `${registryUrl}/index.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry index from ${url} (${res.status})`);
  }
  return (await res.json()) as RegistryIndex;
}

/**
 * Fetch a single file from a broker directory.
 */
export async function fetchBrokerFile(
  registryUrl: string,
  brokerPath: string,
  filename: string,
): Promise<string> {
  const url = `${registryUrl}/${brokerPath}/${filename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filename} from ${url} (${res.status})`);
  }
  return res.text();
}

/**
 * Find a broker by name in the index.
 */
export function findBroker(index: RegistryIndex, name: string): RegistryBroker | undefined {
  return index.brokers.find((b) => b.name === name);
}
