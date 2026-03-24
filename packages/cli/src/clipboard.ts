import { execFileSync } from "child_process";

/**
 * Copy text to the system clipboard.
 *
 * - macOS:   pbcopy (always available)
 * - Windows: clip.exe (always available)
 * - Linux:   xclip or xsel (may not be installed)
 *
 * Returns true on success, false if clipboard is unavailable.
 */
export function copyToClipboard(text: string): boolean {
  try {
    switch (process.platform) {
      case "darwin":
        execFileSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
        return true;
      case "win32":
        execFileSync("clip", { input: text, stdio: ["pipe", "ignore", "ignore"], shell: true });
        return true;
      default: {
        // Try xclip first, fall back to xsel
        for (const cmd of ["xclip", "xsel"]) {
          try {
            const args = cmd === "xclip" ? ["-selection", "clipboard"] : ["--clipboard", "--input"];
            execFileSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
            return true;
          } catch {
            continue;
          }
        }
        return false;
      }
    }
  } catch {
    return false;
  }
}

/**
 * Return a constant masked placeholder for display.
 * Reveals nothing about the value — no prefix, no length, no entropy hints.
 * The clipboard has the real value; the screen just confirms something was copied.
 */
export function maskedPlaceholder(): string {
  return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
}
