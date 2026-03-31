import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { CLEF_MANIFEST_FILENAME } from "./parser";

export function readManifestYaml(repoRoot: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(repoRoot, CLEF_MANIFEST_FILENAME), "utf-8");
  return YAML.parse(raw) as Record<string, unknown>;
}

export function writeManifestYaml(repoRoot: string, doc: Record<string, unknown>): void {
  fs.writeFileSync(path.join(repoRoot, CLEF_MANIFEST_FILENAME), YAML.stringify(doc), "utf-8");
}
