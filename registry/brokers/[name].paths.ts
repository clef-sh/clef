/**
 * Dynamic route data loader for broker detail pages.
 * Reads ../brokers/<provider>/<name>/ and generates one page per broker.
 *
 * README and handler source are pre-rendered to HTML at build time using
 * markdown-it (bundled with VitePress). Structured data goes in `params`
 * for the BrokerHeader Vue component.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import MarkdownIt from "markdown-it";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BrokerInput {
  name: string;
  description: string;
  secret?: boolean;
  default?: string;
}

interface BrokerOutput {
  identity?: string;
  ttl?: number;
  keys?: string[];
}

interface BrokerParams {
  name: string;
  description: string;
  provider: string;
  tier: number;
  version: string;
  author: string;
  license: string;
  inputs: BrokerInput[];
  output: BrokerOutput;
  outputKeys: string[];
  dependencies: Record<string, string>;
  permissions: string[];
}

function discoverBrokers(): Array<{
  params: { name: string; broker: BrokerParams };
  content: string;
}> {
  const brokersRoot = path.resolve(__dirname, "../../brokers");
  const results: Array<{
    params: { name: string; broker: BrokerParams };
    content: string;
  }> = [];

  if (!fs.existsSync(brokersRoot)) return results;

  const providers = fs.readdirSync(brokersRoot).filter((entry) => {
    const fullPath = path.join(brokersRoot, entry);
    return fs.statSync(fullPath).isDirectory() && !entry.startsWith(".");
  });

  for (const provider of providers) {
    const providerDir = path.join(brokersRoot, provider);
    const entries = fs.readdirSync(providerDir).filter((entry) => {
      return fs.statSync(path.join(providerDir, entry)).isDirectory();
    });

    for (const entry of entries) {
      const brokerDir = path.join(providerDir, entry);
      const manifestPath = path.join(brokerDir, "broker.yaml");
      if (!fs.existsSync(manifestPath)) continue;

      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = parseYaml(raw);

      const readmePath = path.join(brokerDir, "README.md");
      const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : "";

      const handlerTsPath = path.join(brokerDir, "handler.ts");
      const handlerJsPath = path.join(brokerDir, "handler.js");
      const handlerPath = fs.existsSync(handlerTsPath) ? handlerTsPath : handlerJsPath;
      const handler = fs.existsSync(handlerPath) ? fs.readFileSync(handlerPath, "utf-8") : "";

      const ext = handlerPath.endsWith(".js") ? "js" : "ts";

      const brokerData: BrokerParams = {
        name: manifest.name,
        description: manifest.description,
        provider: manifest.provider ?? provider,
        tier: Number(manifest.tier),
        version: manifest.version,
        author: manifest.author,
        license: manifest.license,
        inputs: manifest.inputs ?? [],
        output: manifest.output ?? {},
        outputKeys: manifest.output?.keys ?? [],
        dependencies: manifest.runtime?.dependencies ?? {},
        permissions: manifest.runtime?.permissions ?? [],
      };

      // Strip the top-level heading from README (the page has its own header)
      const readmeBody = readme.replace(/^#\s+.+\n+/, "");

      const md = new MarkdownIt({ html: true, linkify: true });
      const readmeHtml = md.render(readmeBody);
      const handlerHtml = md.render("```" + ext + "\n" + handler + "\n```");

      results.push({
        params: {
          name: manifest.name,
          broker: brokerData,
          readmeHtml,
          handlerHtml,
        },
      });
    }
  }

  return results;
}

export default {
  paths() {
    return discoverBrokers();
  },
};
