import { createPublicKey, verify } from "node:crypto";

/**
 * Releases are signed: SHA256SUMS.sig is an Ed25519 signature of SHA256SUMS, made in CI with the
 * project's private key (GitHub secret TUTORAI_RELEASE_SIGNING_KEY). The self-updater accepts an
 * update only with a valid signature, so a release published with a stolen GitHub token alone
 * can't push code to every student. Create the key pair with `node apps/local/scripts/release-key.mjs`
 * and paste the public key here.
 *
 * Empty = signing not set up yet: the self-updater stays off (fails closed); students update by
 * running the install line again.
 */
export const RELEASE_PUBLIC_KEY = "";

export function verifySums(sums: string, signatureB64: string, publicKeyB64 = RELEASE_PUBLIC_KEY): boolean {
  if (!publicKeyB64) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(sums, "utf8"), key, Buffer.from(signatureB64.trim(), "base64"));
  } catch {
    return false;
  }
}
