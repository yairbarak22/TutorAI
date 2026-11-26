// Creates the Ed25519 key pair that signs TutorAI Local releases (run once, by a maintainer).
//   node apps/local/scripts/release-key.mjs <where-to-save-the-private-key.pem>
// Then: add the private key file's content as the GitHub secret TUTORAI_RELEASE_SIGNING_KEY, keep a
// backup somewhere safe, and paste the printed public key into apps/local/src/update/signing.ts.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node apps/local/scripts/release-key.mjs <private-key.pem>");
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`${out} already exists; not overwriting it.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
console.log(`Private key saved to ${out} (keep it secret; add it as TUTORAI_RELEASE_SIGNING_KEY).`);
console.log("Public key for RELEASE_PUBLIC_KEY in apps/local/src/update/signing.ts:");
console.log(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
