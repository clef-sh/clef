/**
 * Generate index.json from all broker.yaml files.
 * Run: node brokers/generate-index.mjs
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const providers = fs.readdirSync(__dirname).filter((entry) => {
  const fullPath = path.join(__dirname, entry);
  return fs.statSync(fullPath).isDirectory() && !entry.startsWith(".");
});

const brokers = [];

for (const provider of providers) {
  const providerDir = path.join(__dirname, provider);
  const entries = fs.readdirSync(providerDir).filter((entry) => {
    return fs.statSync(path.join(providerDir, entry)).isDirectory();
  });

  for (const entry of entries) {
    const manifestPath = path.join(providerDir, entry, "broker.yaml");
    if (!fs.existsSync(manifestPath)) continue;

    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = parseYaml(raw);

    brokers.push({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      provider: manifest.provider,
      tier: Number(manifest.tier),
      path: `${provider}/${entry}`,
      outputKeys: manifest.output?.keys ?? [],
    });
  }
}

brokers.sort((a, b) => a.name.localeCompare(b.name));

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  brokers,
};

const outputPath = path.join(__dirname, "index.json");
fs.writeFileSync(outputPath, JSON.stringify(index, null, 2) + "\n");

console.log(`Generated index.json with ${brokers.length} brokers`);
