#!/usr/bin/env node
// CJS shim — uses dynamic import() to load the ESM bundle.
// This file stays CJS so it works as a plain `node` script without
// requiring Node to treat the whole package as "type: module".
import("../dist/index.mjs").catch((err) => {
  process.stderr.write((err.stack ?? err.message) + "\n");
  process.exit(1);
});
