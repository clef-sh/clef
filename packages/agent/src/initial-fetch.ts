/* eslint-disable no-console -- startup logging */
import type { ArtifactPoller, SecretsCache, EncryptedArtifactStore } from "@clef-sh/runtime";

export const INITIAL_FETCH_RETRIES = 3;
export const INITIAL_RETRY_BASE_MS = 2_000;

/**
 * Fetch and decrypt the artifact on startup with retry + backoff.
 *
 * Retries up to {@link INITIAL_FETCH_RETRIES} times with exponential backoff.
 * On exhaustion, throws with a descriptive error including an actionable hint
 * based on the HTTP status code (403/404) or generic advice.
 */
export async function initialFetch(
  poller: ArtifactPoller,
  jitMode: boolean,
  encryptedStore: EncryptedArtifactStore | undefined,
  cache: SecretsCache,
  sourceDesc: string,
): Promise<void> {
  let lastErr: Error | undefined;

  for (let attempt = 1; attempt <= INITIAL_FETCH_RETRIES; attempt++) {
    try {
      if (jitMode) {
        await poller.fetchAndValidate();
        const artifact = encryptedStore!.get()!;
        const { values } = await poller.getDecryptor().decrypt(artifact);
        cache.swap(values, Object.keys(values), artifact.revision);
      } else {
        await poller.fetchAndDecrypt();
      }
      return; // success
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < INITIAL_FETCH_RETRIES) {
        const delayMs = INITIAL_RETRY_BASE_MS * 2 ** (attempt - 1);
        console.error(
          `[clef-agent] initial fetch failed (attempt ${attempt}/${INITIAL_FETCH_RETRIES}): ${lastErr.message}. Retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted — build a descriptive error
  const hint = lastErr?.message.includes("403")
    ? "Check that the IAM role or credentials have read access to the artifact."
    : lastErr?.message.includes("404") || lastErr?.message.includes("NoSuchKey")
      ? "The artifact does not exist yet. Has it been deployed with `clef pack`?"
      : "Check the artifact URL and network connectivity.";

  throw new Error(
    `Failed to fetch artifact from ${sourceDesc} after ${INITIAL_FETCH_RETRIES} attempts: ${lastErr?.message}. ${hint}`,
  );
}
