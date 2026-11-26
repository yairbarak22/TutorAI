import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Updater, assetName, newer, parseSums } from "../src/update/index.ts";
import { tempEnv } from "./helpers.ts";

function release(binary: Uint8Array, sum: string, tag = "v0.2.0", sig?: string) {
  const name = assetName();
  const fetchFn = (async (url: string) => {
    if (url.endsWith("/releases/latest"))
      return new Response(
        JSON.stringify({
          tag_name: tag,
          assets: [
            { name, browser_download_url: "https://github.com/dl/bin" },
            { name: "SHA256SUMS", browser_download_url: "https://github.com/dl/sums" },
            ...(sig ? [{ name: "SHA256SUMS.sig", browser_download_url: "https://github.com/dl/sig" }] : []),
          ],
        }),
      );
    if (url.endsWith("/sums")) return new Response(sumsText(sum, name));
    if (url.endsWith("/sig") && sig) return new Response(sig);
    if (url.endsWith("/bin")) return new Response(binary as BodyInit);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return fetchFn;
}

const sumsText = (sum: string, name: string, version = "0.2.0") =>
  `${sum}  ${name}\n0000000000000000000000000000000000000000000000000000000000000000  other\nversion: ${version}\n`;

describe("signed releases", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const data = new TextEncoder().encode("signed binary");
  const sum = createHash("sha256").update(data).digest("hex");
  const goodSig = sign(null, Buffer.from(sumsText(sum, assetName())), privateKey).toString("base64");

  it("accepts an update whose SHA256SUMS carries a valid signature", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    const u = new Updater({ current: "0.1.0", binary: bin, publicKey: pub, fetchFn: release(data, sum, "v0.2.0", goodSig), relaunch: async () => {} });
    await u.check();
    expect((await u.status()).staged).toBe(true);
  });

  it("rejects an old signed release re-published under a newer tag (rollback)", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    // A genuinely signed 0.1.0 SHA256SUMS, served as release v0.3.0.
    const oldSigned = sign(null, Buffer.from(sumsText(sum, assetName(), "0.1.0")), privateKey).toString("base64");
    const fetchFn = (async (url: string) => {
      if (url.endsWith("/releases/latest"))
        return new Response(JSON.stringify({ tag_name: "v0.3.0", assets: [
          { name: assetName(), browser_download_url: "https://github.com/dl/bin" },
          { name: "SHA256SUMS", browser_download_url: "https://github.com/dl/sums" },
          { name: "SHA256SUMS.sig", browser_download_url: "https://github.com/dl/sig" },
        ] }));
      if (url.endsWith("/sums")) return new Response(sumsText(sum, assetName(), "0.1.0"));
      if (url.endsWith("/sig")) return new Response(oldSigned);
      return new Response(data as BodyInit);
    }) as typeof fetch;
    const u = new Updater({ current: "0.2.5", binary: bin, publicKey: pub, fetchFn, relaunch: async () => {} });
    await expect(u.check()).rejects.toThrow(/version/);
    expect(existsSync(`${bin}.new`)).toBe(false);
  });

  it("rejects a missing or forged signature even when the checksum matches", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = sign(null, Buffer.from(sumsText(sum, assetName())), other).toString("base64");
    for (const sig of [undefined, forged]) {
      const u = new Updater({ current: "0.1.0", binary: bin, publicKey: pub, fetchFn: release(data, sum, "v0.2.0", sig), relaunch: async () => {} });
      await expect(u.check()).rejects.toThrow(/signature/);
      expect(existsSync(`${bin}.new`)).toBe(false);
    }
  });
});

describe("self-update", () => {
  it("compares versions and reads checksum files", () => {
    expect(newer("0.2.0", "0.1.9")).toBe(true);
    expect(newer("v0.1.0", "0.1.0")).toBe(false);
    expect(newer("1.0.0", "0.9.9")).toBe(true);
    expect(parseSums("ab".repeat(32) + "  tutorai-macos-arm64\n").get("tutorai-macos-arm64")).toBe("ab".repeat(32));
  });

  it("stages a verified binary and swaps it in on restart", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    const data = new TextEncoder().encode("new binary");
    const sum = createHash("sha256").update(data).digest("hex");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const sig = sign(null, Buffer.from(sumsText(sum, assetName())), privateKey).toString("base64");
    let relaunched = "";
    const u = new Updater({
      current: "0.1.0",
      binary: bin,
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      fetchFn: release(data, sum, "v0.2.0", sig),
      relaunch: async (b) => void (relaunched = b),
    });
    await u.check();
    expect((await u.status()).staged).toBe(true);
    expect(readFileSync(`${bin}.new`, "utf8")).toBe("new binary");
    await u.restart();
    expect(readFileSync(bin, "utf8")).toBe("new binary");
    expect(relaunched).toBe(bin);
  });

  it("refuses a binary whose checksum doesn't match, and any update when the build has no release key", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const fake = "f".repeat(64);
    const sig = sign(null, Buffer.from(sumsText(fake, assetName())), privateKey).toString("base64");
    const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const u = new Updater({ current: "0.1.0", binary: bin, publicKey: pub, fetchFn: release(new TextEncoder().encode("tampered"), fake, "v0.2.0", sig), relaunch: async () => {} });
    await expect(u.check()).rejects.toThrow(/checksum/);
    const unsigned = new Updater({ current: "0.1.0", binary: bin, publicKey: "", fetchFn: release(new TextEncoder().encode("x"), fake), relaunch: async () => {} });
    await expect(unsigned.check()).rejects.toThrow(/no release signing key/);
    expect(existsSync(`${bin}.new`)).toBe(false);
    expect((await u.status()).staged).toBe(false);
  });

  it("does nothing when already up to date or running from source", async () => {
    const e = tempEnv();
    const bin = join(e.root, "tutorai");
    writeFileSync(bin, "old");
    const u = new Updater({ current: "0.2.0", binary: bin, fetchFn: release(new Uint8Array(), ""), relaunch: async () => {} });
    await u.check();
    expect((await u.status()).staged).toBe(false);
    const src = new Updater({ current: "0.0.1", binary: null, fetchFn: release(new Uint8Array(), ""), relaunch: async () => {} });
    await src.check();
    expect((await src.status()).latest).toBeNull();
  });
});
