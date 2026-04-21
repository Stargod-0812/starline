class Starline < Formula
  desc "Claude Code + Codex cost & quota statusline"
  homepage "https://github.com/liaoruoxing/starline"
  url "https://github.com/liaoruoxing/starline/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "REPLACE_WITH_TARBALL_SHA256_ON_RELEASE"
  license "MIT"
  head "https://github.com/liaoruoxing/starline.git", branch: "main"

  depends_on "jq"
  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"starline").write <<~EOS
      #!/usr/bin/env bash
      exec "#{libexec}/bin/starline" "$@"
    EOS
    chmod 0755, bin/"starline"
  end

  def caveats
    <<~EOS
      starline installed. To wire it into Claude Code, run:
        starline install

      To verify your environment and see what starline resolves on your box:
        starline doctor

      To uninstall from Claude Code (this keeps the formula installed):
        starline uninstall
    EOS
  end

  test do
    assert_match(/\d+\.\d+\.\d+/, shell_output("#{bin}/starline version"))
    output = shell_output("#{bin}/starline help")
    assert_match "Claude Code + Codex", output
  end
end
