// Signs a release's SHA256SUMS in CI: node apps/local/scripts/sign.mjs release/SHA256SUMS
// Reads the private key (PEM) from TUTORAI_RELEASE_SIGNING_KEY and writes SHA256SUMS.sig.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const pem = process.env.TUTORAI_RELEASE_SIGNING_KEY;
if (!file || !pem) {
  console.error("Usage: TUTORAI_RELEASE_SIGNING_KEY=<pem> node apps/local/scripts/sign.mjs <SHA256SUMS>");
  process.exit(1);
}
const sig = sign(null, readFileSync(file), createPrivateKey(pem));
writeFileSync(`${file}.sig`, sig.toString("base64") + "\n");
console.log(`Signed ${file}`);
