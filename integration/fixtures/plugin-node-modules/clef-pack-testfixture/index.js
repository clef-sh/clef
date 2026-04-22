// Minimal PackBackend implementation for integration testing.
//
// Verifies that the CLI can discover and invoke a third-party plugin
// installed under the `clef-pack-<id>` naming convention. Writes a
// marker file so the test can assert the plugin actually ran (rather
// than silently falling back to json-envelope).
//
// The fixture intentionally does NOT encrypt anything — the test is
// about the plugin contract (import + invoke), not crypto semantics.
const fs = require("fs");

const backend = {
  id: "testfixture",
  description: "integration-test fixture plugin",
  validateOptions(raw) {
    if (!raw.outputPath) {
      throw new Error("testfixture requires --output");
    }
  },
  async pack(req) {
    const outputPath = req.backendOptions.outputPath;
    const payload = {
      marker: "hello-from-testfixture-plugin",
      identity: req.identity,
      environment: req.environment,
      ttl: req.ttl ?? null,
      backendOptions: req.backendOptions,
    };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    return {
      outputPath,
      namespaceCount: 0,
      keyCount: 0,
      keys: [],
      artifactSize: Buffer.byteLength(JSON.stringify(payload), "utf-8"),
      revision: "fixture-rev-1",
      backend: "testfixture",
      details: { marker: "plugin-ran" },
    };
  },
};

module.exports = backend;
module.exports.default = backend;
