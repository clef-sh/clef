import { readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export default async function teardown() {
  const tmp = tmpdir();
  const stale = readdirSync(tmp).filter((f) => f.startsWith("clef-int-"));

  for (const dir of stale) {
    try {
      rmSync(join(tmp, dir), { recursive: true });
    } catch {
      // Best effort
    }
  }
}
