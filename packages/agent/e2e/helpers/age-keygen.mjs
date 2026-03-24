/**
 * Standalone ESM helper that generates an age key pair.
 * Spawned as a subprocess by the test harness so the CJS test environment
 * never has to load the ESM-only age-encryption package directly.
 */
import { generateIdentity, identityToRecipient } from "age-encryption";

const privateKey = await generateIdentity();
const publicKey = await identityToRecipient(privateKey);
process.stdout.write(JSON.stringify({ privateKey, publicKey }));
