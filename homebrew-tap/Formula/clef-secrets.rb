# This formula is maintained by the release workflow.
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
    assert_match version.to_s, shell_output("#{bin}/clef --version")
  end
end
