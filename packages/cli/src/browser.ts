import type { SubprocessRunner } from "@clef-sh/core";

/**
 * Open a URL in the user's default browser.
 * Returns false if the platform is unsupported or no display is available.
 */
export async function openBrowser(url: string, runner: SubprocessRunner): Promise<boolean> {
  if (isHeadless()) return false;

  let command: string;
  switch (process.platform) {
    case "darwin":
      command = "open";
      break;
    case "linux":
      command = "xdg-open";
      break;
    case "win32":
      command = "start";
      break;
    default:
      return false;
  }

  try {
    await runner.run(command, [url]);
    return true;
  } catch {
    return false;
  }
}

export function isHeadless(): boolean {
  if (process.env.CI) return true;
  if (process.env.SSH_TTY) return true;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}
