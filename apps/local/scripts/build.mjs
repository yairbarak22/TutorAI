// Builds TutorAI Local as one executable (Node Single Executable Application) with the web app
// embedded: web build → esbuild bundle → SEA blob (with assets) → copy of node → inject blob.
// Usage: node apps/local/scripts/build.mjs [--skip-web]
// Output: apps/local/out/tutorai-<os>-<arch>[.exe]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const repo = resolve(app, "..", "..");
const web = join(repo, "apps", "web", "dist");
const dist = join(app, "dist");
const out = join(app, "out");
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const version = process.env.TUTORAI_VERSION || pkg.version;

const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const name = `tutorai-${os}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

if (!process.argv.includes("--skip-web")) run("npm", ["run", "build", "-w", "@tutorai/web"], { cwd: repo, shell: process.platform === "win32" });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(out, { recursive: true });

// 1. Bundle the server (TypeScript, workspace packages) into one CommonJS file.
await build({
  entryPoints: [join(app, "src", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(dist, "server.cjs"),
  define: { __TUTORAI_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});

// 2. Embed every file of the built web app as an asset, plus a manifest of their paths.
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(relative(web, p).split("\\").join("/"));
  }
};
walk(web);
if (!files.includes("index.html")) throw new Error("apps/web/dist/index.html is missing; build the web app first");
writeFileSync(join(dist, "web-manifest.json"), JSON.stringify(files));
const assets = { "web-manifest.json": join(dist, "web-manifest.json") };
for (const f of files) assets[`web/${f}`] = join(web, f);
writeFileSync(
  join(dist, "sea-config.json"),
  JSON.stringify({ main: join(dist, "server.cjs"), output: join(dist, "sea.blob"), disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets }),
);
run(process.execPath, ["--experimental-sea-config", join(dist, "sea-config.json")]);

// 3. A copy of an official node binary with the blob injected. Some distributions (Homebrew)
// ship a thin node without the SEA fuse; then use the official build of the same version,
// downloaded from nodejs.org and checked against its published SHA-256.
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
async function officialNode() {
  if (process.env.TUTORAI_NODE_BINARY) return process.env.TUTORAI_NODE_BINARY;
  if (readFileSync(process.execPath).includes(FUSE)) return process.execPath;
  const v = process.version;
  const plat = { darwin: "darwin", linux: "linux", win32: "win" }[process.platform];
  const cache = join(tmpdir(), `tutorai-node-${v}-${plat}-${process.arch}`);
  const bin = process.platform === "win32" ? join(cache, "node.exe") : join(cache, "bin", "node");
  if (existsSync(bin)) return bin;
  const base = `https://nodejs.org/dist/${v}`;
  const file = process.platform === "win32" ? `win-${process.arch}/node.exe` : `node-${v}-${plat}-${process.arch}.tar.gz`;
  console.log(`Downloading the official Node ${v} (${file}) from nodejs.org…`);
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums.split("\n").find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!want) throw new Error(`no checksum for ${file}`);
  const data = Buffer.from(await (await fetch(`${base}/${file}`)).arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== want) throw new Error("Node download checksum mismatch");
  mkdirSync(cache, { recursive: true });
  if (process.platform === "win32") writeFileSync(bin, data);
  else {
    const tgz = join(cache, "node.tar.gz");
    writeFileSync(tgz, data);
    run("tar", ["-xzf", tgz, "-C", cache, "--strip-components=1", `node-${v}-${plat}-${process.arch}/bin/node`]);
  }
  return bin;
}

const target = join(out, name);
rmSync(target, { force: true });
copyFileSync(await officialNode(), target);
chmodSync(target, 0o755);
if (process.platform === "darwin") run("codesign", ["--remove-signature", target]);
const postject = join(repo, "node_modules", "postject", "dist", "cli.js");
const args = [postject, target, "NODE_SEA_BLOB", join(dist, "sea.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
run(process.execPath, args);
// Apple Silicon requires a signature; an ad-hoc one needs no Apple account.
if (process.platform === "darwin") run("codesign", ["--force", "--sign", "-", target]);

console.log(`Built ${relative(repo, target)} (${(statSync(target).size / 1048576).toFixed(0)} MB, ${files.length} web files, v${version})`);
