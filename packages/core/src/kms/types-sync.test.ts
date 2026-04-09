import * as fs from "fs";
import * as path from "path";

describe("KMS types cross-package sync", () => {
  it("core and runtime KMS types should be identical", () => {
    const coreTypes = fs.readFileSync(path.resolve(__dirname, "types.ts"), "utf-8");
    const runtimeTypes = fs.readFileSync(
      path.resolve(__dirname, "../../../runtime/src/kms/types.ts"),
      "utf-8",
    );
    // Core has VALID_KMS_PROVIDERS which runtime does not — strip that
    // declaration (single or multi-line) before comparing.
    const coreShared = coreTypes.replace(/^export const VALID_KMS_PROVIDERS.*?;\n\n?/ms, "").trim();
    expect(coreShared).toBe(runtimeTypes.trim());
  });
});
