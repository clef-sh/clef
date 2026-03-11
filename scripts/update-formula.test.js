const { execSync } = require("child_process");
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require("fs");
const path = require("path");

const FORMULA_TEMPLATE = `# This formula is maintained by the release workflow.
# Manual edits will be overwritten on the next release.
# To update manually, use scripts/update-formula.js.

class ClefSecrets < Formula
  desc "Git-native secrets and config manager built on SOPS"
  homepage "https://clef.sh"
  version "0.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/clef-sh/clef/releases/download/v0.0.0/clef-v0.0.0-darwin-arm64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/clef-sh/clef/releases/download/v0.0.0/clef-v0.0.0-darwin-amd64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/clef-sh/clef/releases/download/v0.0.0/clef-v0.0.0-linux-arm64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/clef-sh/clef/releases/download/v0.0.0/clef-v0.0.0-linux-amd64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install "clef"
  end

  test do
    assert_match version.to_s, shell_output("\#{bin}/clef --version")
  end
end`;

describe("update-formula.js", () => {
  let tempDir;
  let formulaPath;
  const scriptPath = path.join(__dirname, "update-formula.js");

  const DARWIN_ARM64 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const DARWIN_AMD64 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const LINUX_ARM64 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const LINUX_AMD64 = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

  beforeEach(() => {
    tempDir = path.join(__dirname, ".test-formula-tmp");
    mkdirSync(tempDir, { recursive: true });
    formulaPath = path.join(tempDir, "clef-secrets.rb");
    writeFileSync(formulaPath, FORMULA_TEMPLATE);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should update version, URLs, and all four SHA256 values", () => {
    execSync(
      `node "${scriptPath}" "${formulaPath}" 1.2.3 ${DARWIN_ARM64} ${DARWIN_AMD64} ${LINUX_ARM64} ${LINUX_AMD64}`,
    );

    const updated = readFileSync(formulaPath, "utf8");

    // Version
    expect(updated).toContain('version "1.2.3"');
    expect(updated).not.toContain('version "0.0.0"');

    // URLs
    expect(updated).toContain(
      "https://github.com/clef-sh/clef/releases/download/v1.2.3/clef-v1.2.3-darwin-arm64.tar.gz",
    );
    expect(updated).toContain(
      "https://github.com/clef-sh/clef/releases/download/v1.2.3/clef-v1.2.3-darwin-amd64.tar.gz",
    );
    expect(updated).toContain(
      "https://github.com/clef-sh/clef/releases/download/v1.2.3/clef-v1.2.3-linux-arm64.tar.gz",
    );
    expect(updated).toContain(
      "https://github.com/clef-sh/clef/releases/download/v1.2.3/clef-v1.2.3-linux-amd64.tar.gz",
    );

    // SHA256 values
    expect(updated).toContain(DARWIN_ARM64);
    expect(updated).toContain(DARWIN_AMD64);
    expect(updated).toContain(LINUX_ARM64);
    expect(updated).toContain(LINUX_AMD64);

    // No old placeholders remain
    expect(updated).not.toContain(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("should preserve formula structure", () => {
    execSync(
      `node "${scriptPath}" "${formulaPath}" 2.0.0 ${DARWIN_ARM64} ${DARWIN_AMD64} ${LINUX_ARM64} ${LINUX_AMD64}`,
    );

    const updated = readFileSync(formulaPath, "utf8");

    expect(updated).toContain("class ClefSecrets < Formula");
    expect(updated).toContain("on_macos do");
    expect(updated).toContain("on_linux do");
    expect(updated).toContain("on_arm do");
    expect(updated).toContain("on_intel do");
    expect(updated).toContain("def install");
    expect(updated).toContain('bin.install "clef"');
    expect(updated).toContain("test do");
    expect(updated).toContain("# This formula is maintained by the release workflow.");
  });

  it("should not modify unrelated content", () => {
    execSync(
      `node "${scriptPath}" "${formulaPath}" 1.0.0 ${DARWIN_ARM64} ${DARWIN_AMD64} ${LINUX_ARM64} ${LINUX_AMD64}`,
    );

    const updated = readFileSync(formulaPath, "utf8");

    expect(updated).toContain('desc "Git-native secrets and config manager built on SOPS"');
    expect(updated).toContain('homepage "https://clef.sh"');
    expect(updated).toContain('license "MIT"');
  });
});
