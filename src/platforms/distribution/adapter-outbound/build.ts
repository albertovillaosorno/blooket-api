// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE-MIT
//
// Boundary-Contract:
// - Owns:
//   - Isolated native distribution assembly from trusted sources.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  chmod,
  realpath,
  lstat,
  open,
  link,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve, basename } from "node:path";
import { buildBrowserExtension } from "./extension.ts";
import { buildMacIcon } from "./icons.ts";

import {
  PRODUCT_VERSION,
  appleBuildVersion,
} from "../../../ir/product-version/contract/version.ts";

export const TARGETS = ["linux-x64", "darwin-arm64"] as const;
export type DistributionTarget = (typeof TARGETS)[number];
const NODE_VERSION = "24.21.0";
const CLOUDFLARED_VERSION = "2026.10.0";
export const MAC_LOGIN_AGENT_LABEL =
  "com.albertovilla.blooket-api.background" as const;
export const MAC_LOGIN_AGENT_PLIST = MAC_LOGIN_AGENT_LABEL + ".plist";
export const MAC_LOGIN_AGENT_EXECUTABLE = "Blooket API Background" as const;
export function macLoginAgentPlist(): string {
  const bundleProgram =
    "Contents/Resources/ServiceManagement/" + MAC_LOGIN_AGENT_EXECUTABLE;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LOGIN_AGENT_LABEL}</string>
  <key>BundleProgram</key>
  <string>${bundleProgram}</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}
const CONNECTOR_ASSETS = {
  "linux-x64": [
    "cloudflared-linux-amd64",
    "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
  ],
  "darwin-arm64": [
    "cloudflared-darwin-arm64.tgz",
    "a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70",
  ],
} as const;
interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface ReleaseArtifact {
  name: string;
  version: string;
  sha256: string;
  integrityScope: "package-manifest" | "archive";
}
async function run(program: string, args: string[], cwd?: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("distribution-command-timeout"));
    }, 120_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("distribution-command-unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("distribution-command-failed"));
    });
  });
}
async function download(url: string, maxBytes = 160_000_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body)
    throw new Error("distribution-download-failed");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("distribution-download-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function manifest(path: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  ) as PackageManifest;
}
async function copyRuntimePackages(repo: string, modules: string) {
  const records: ReleaseArtifact[] = [];
  const seen = new Set<string>();
  async function copyPackage(path: string) {
    const source = await realpath(path);
    const record = await manifest(source);
    if (seen.has(record.name)) return;
    seen.add(record.name);
    const target = join(modules, record.name);
    await cp(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) => !path.startsWith(join(source, "node_modules")),
    });
    records.push({
      name: record.name,
      version: record.version,
      sha256: sha256(await readFile(join(source, "package.json"))),
      integrityScope: "package-manifest",
    });
    for (const dependency of Object.keys(record.dependencies ?? {})) {
      const sibling = join(source, "..", dependency);
      await copyPackage(sibling);
    }
  }
  for (const name of ["sharp", "yaml", "yauzl"])
    await copyPackage(join(repo, ".dependencies/pnpm/node_modules", name));
  return records;
}
async function npmPackage(
  name: string,
  version: string,
  cache: string,
  destination: string,
) {
  const response = await download(
    "https://registry.npmjs.org/" + encodeURIComponent(name) + "/" + version,
    1_000_000,
  );
  const value = JSON.parse(response.toString("utf8")) as {
    name: string;
    version: string;
    dist: { tarball: string; integrity: string };
  };
  if (
    value.name !== name ||
    value.version !== version ||
    !value.dist.tarball.startsWith("https://registry.npmjs.org/") ||
    !value.dist.integrity.startsWith("sha512-")
  )
    throw new Error("distribution-package-invalid");
  const path = join(cache, name.replaceAll("/", "-") + "-" + version + ".tgz");
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    bytes = await download(value.dist.tarball);
  }
  const integrity =
    "sha512-" + createHash("sha512").update(bytes).digest("base64");
  if (integrity !== value.dist.integrity)
    throw new Error("distribution-package-integrity");
  await writeFile(path, bytes);
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xzf", path, "--strip-components=1", "-C", destination]);
  return {
    name,
    version,
    sha256: sha256(bytes),
    integrityScope: "archive" as const,
  };
}
export function distributionDirectory(repo: string, outputName?: string) {
  if (outputName !== undefined &&
      (typeof outputName !== "string" ||
        !/^[a-z][a-z0-9-]{0,47}$/u.test(outputName)))
    throw new Error("invalid-package-output-name");
  return join(repo, ".temp/distributions", outputName ?? "");
}
export async function createLinuxArchive(output: string, partial: string) {
  // Reserve before tar scans the root; creating it during the scan changes
  // the directory and correctly makes tar reject that unstable input.
  const reserved = await open(partial, "wx", 0o600);
  await reserved.close();
  await run("tar", ["-czf", partial,
    "--exclude=./" + basename(partial), "-C", output, "."]);
}
export async function buildDistribution(
  target: DistributionTarget, outputName?: string,
) {
  if (!TARGETS.includes(target)) throw new Error("unsupported-package-target");
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const cache = join(repo, ".temp/distribution-cache");
  const directory = distributionDirectory(repo, outputName);
  const output = join(directory, target);
  const mac = target.startsWith("darwin-");
  const destinationArchive = join(directory,
    target + (mac ? ".zip" : ".tar.gz"));
  for (const existing of [output, destinationArchive]) {
    try {
      await lstat(existing);
      throw new Error("package-output-already-exists");
    } catch (error) {
      if (!(error instanceof Error && "code" in error &&
          error.code === "ENOENT"))
        throw error;
    }
  }
  await mkdir(cache, { recursive: true });
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== resolve(directory))
    throw new Error("unsafe-package-output");
  // Exclusive ownership prevents concurrent builders from deleting each other.
  await mkdir(output);
  const partialArchive = join(output,
    mac ? ".archive.partial.zip" : ".archive.partial.tar.gz");
  const bundle = mac ? join(output, "Blooket API.app/Contents") : output;
  const resource = mac ? join(bundle, "Resources") : output;
  const app = join(resource, "app");
  const runtime = join(resource, "runtime");
  try {
    await mkdir(runtime, { recursive: true });
    await mkdir(join(resource, "extensions"), { recursive: true });
    await buildBrowserExtension(repo, join(resource, "extensions/chrome"));
    for (const file of [
      "src",
      "assets/icon",
      "docs/skills",
      "LICENSE-MIT",
      "THIRD-PARTY-NOTICES.md",
    ])
      await cp(join(repo, file), join(app, file), { recursive: true });
    await mkdir(join(app, "docs/agents"), { recursive: true });
    await cp(
      join(repo, "docs/agents/AGENTS-TEACHER.md"),
      join(app, "docs/agents/AGENTS-TEACHER.md"),
    );
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({
        name: "blooket-api-runtime",
        version: PRODUCT_VERSION,
        private: true,
        type: "module",
      }) + "\n",
    );
    const modules = join(app, ".dependencies/pnpm/node_modules");
    const artifacts = await copyRuntimePackages(repo, modules);
    const sharp = await manifest(join(modules, "sharp"));
    for (const name of [
      "@img/sharp-" + target,
      "@img/sharp-libvips-" + target,
    ]) {
      const version = sharp.optionalDependencies?.[name];
      if (!version) throw new Error("distribution-native-package-missing");
      artifacts.push(
        await npmPackage(name, version, cache, join(modules, name)),
      );
    }
    const nodeFile = "node-v" + NODE_VERSION + "-" + target + ".tar.gz";
    const nodeBase =
      "https://nodejs.org/download/release/v" + NODE_VERSION + "/";
    const sums = (await download(nodeBase + "SHASUMS256.txt", 100_000))
      .toString("utf8")
      .split("\n");
    const checksum = sums
      .find((line) => line.endsWith("  " + nodeFile))
      ?.split(" ")[0];
    if (!checksum || !/^[a-f0-9]{64}$/u.test(checksum))
      throw new Error("distribution-node-checksum-missing");
    const archive = join(cache, nodeFile);
    let nodeBytes: Buffer;
    try {
      nodeBytes = await readFile(archive);
    } catch {
      nodeBytes = await download(nodeBase + nodeFile);
    }
    if (sha256(nodeBytes) !== checksum)
      throw new Error("distribution-node-integrity");
    await writeFile(archive, nodeBytes);
    const extracted = join(cache, "node-" + target);
    await mkdir(extracted, { recursive: true });
    const prefix = "node-v" + NODE_VERSION + "-" + target;
    await run("tar", [
      "-xzf",
      archive,
      "--strip-components=1",
      "-C",
      extracted,
      prefix + "/bin/node",
      prefix + "/LICENSE",
    ]);
    await cp(join(extracted, "bin/node"), join(runtime, "node"));
    await cp(join(extracted, "LICENSE"), join(runtime, "NODE-LICENSE"));
    artifacts.push({
      name: "node",
      version: NODE_VERSION,
      sha256: checksum,
      integrityScope: "archive",
    });
    const connector = CONNECTOR_ASSETS[target];
    const connectorPath = join(cache, connector[0]);
    let connectorBytes: Buffer;
    try {
      connectorBytes = await readFile(connectorPath);
    } catch {
      connectorBytes = await download(
        "https://github.com/cloudflare/cloudflared/releases/download/" +
          CLOUDFLARED_VERSION +
          "/" +
          connector[0],
      );
    }
    if (sha256(connectorBytes) !== connector[1])
      throw new Error("distribution-connector-integrity");
    await writeFile(connectorPath, connectorBytes);
    if (mac) await run("tar", ["-xzf", connectorPath, "-C", runtime]);
    else await cp(connectorPath, join(runtime, "cloudflared"));
    await chmod(join(runtime, "node"), 0o755);
    await chmod(join(runtime, "cloudflared"), 0o755);
    await writeFile(
      join(runtime, "CLOUDFLARED-LICENSE"),
      await download(
        "https://raw.githubusercontent.com/cloudflare/cloudflared/" +
          CLOUDFLARED_VERSION +
          "/LICENSE",
        100_000,
      ),
    );
    artifacts.push({
      name: "cloudflared",
      version: CLOUDFLARED_VERSION,
      sha256: connector[1],
      integrityScope: "archive",
    });
    const sourceRevision = await readRevision(repo);
    await writeFile(
      join(resource, "distribution.json"),
      JSON.stringify(
        {
          version: 1,
          productVersion: PRODUCT_VERSION,
          target,
          sourceRevision,
          minimumMacOS: mac ? "13.5" : null,
          signed: false,
          sourceDirty: await sourceDirty(repo),
          artifacts,
        },
        null,
        2,
      ) + "\n",
    );
    if (mac) {
      await buildMacIcon(repo, join(resource, "Blooket API.icns"));
      const executable = join(bundle, "MacOS/Blooket API");
      await mkdir(dirname(executable), { recursive: true });
      await run("xcrun", [
        "swiftc",
        join(app,
          "src/service/desktop-launcher/adapter-inbound/macos-launcher.swift"),
        "-target", "arm64-apple-macos13.5",
        "-o", executable,
      ]);
      await chmod(executable, 0o755);
      const loginAgentSource = join(
        app,
        "src/platforms/service-lifecycle/adapter-outbound/login-agent.swift",
      );
      const serviceManagement = join(resource, "ServiceManagement");
      await mkdir(serviceManagement, { recursive: true });
      const loginAgentExecutable = join(
        serviceManagement,
        MAC_LOGIN_AGENT_EXECUTABLE,
      );
      await run("xcrun", [
        "swiftc",
        loginAgentSource,
        "-target",
        "arm64-apple-macos13.5",
        "-o",
        loginAgentExecutable,
      ]);
      await chmod(loginAgentExecutable, 0o755);
      const launchAgents = join(bundle, "Library/LaunchAgents");
      await mkdir(launchAgents, { recursive: true });
      await writeFile(
        join(launchAgents, MAC_LOGIN_AGENT_PLIST),
        macLoginAgentPlist(),
      );
      await writeFile(
        join(bundle, "Info.plist"),
        `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.albertovilla.blooket-api</string>
<key>CFBundleName</key><string>Blooket API</string>
<key>CFBundleExecutable</key><string>Blooket API</string>
<key>CFBundleIconFile</key><string>Blooket API.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${PRODUCT_VERSION}</string>
<key>CFBundleVersion</key><string>${appleBuildVersion(PRODUCT_VERSION)}</string>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>LSUIElement</key><true/>
</dict></plist>
`,
      );
      await run(
        "zip",
        [
          "-qr",
          partialArchive,
          "Blooket API.app",
        ],
        output,
      );
    } else {
      await createLinuxLauncher(output, cache);
      await createLinuxArchive(output, partialArchive);
    }
    const file = await open(partialArchive, "r");
    try { await file.sync(); }
    finally { await file.close(); }
    // A no-clobber publish also preserves an archive created during assembly.
    await link(partialArchive, destinationArchive);
    const parent = await open(directory, "r");
    try { await parent.sync(); }
    finally { await parent.close(); }
    await rm(partialArchive);
    return { target, output, archive: destinationArchive, sourceRevision };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
async function readRevision(repo: string) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd: repo });
    let result = "";
    child.stdout.on("data", (chunk: Buffer) => {
      result += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && /^[a-f0-9]{40}\n$/u.test(result))
        resolve(result.trim());
      else reject(new Error("distribution-source-revision-unavailable"));
    });
  });
}
async function createLinuxLauncher(output: string, cache: string) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("linux-launcher-build-host-required");
  const launcher = join(cache, "launcher.cjs");
  await writeFile(
    launcher,
    `const { execFileSync } = require('node:child_process');
const { dirname, join } = require('node:path');
const root = dirname(process.execPath);
try {
  execFileSync(join(root, 'runtime/node'), [
    join(root, 'app/src/service/desktop-launcher/adapter-inbound/launcher.ts'),
    ...process.argv.slice(2),
  ], { stdio: 'inherit', env: process.env });
} catch { process.exitCode = 1; }
`,
  );
  const blob = join(cache, "launcher.blob");
  const config = join(cache, "launcher-sea.json");
  await writeFile(
    config,
    JSON.stringify({
      main: launcher,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: "none",
    }),
  );
  await run(join(output, "runtime/node"), [
    "--experimental-sea-config",
    config,
  ]);
  const executable = join(output, "blooket-api");
  await cp(join(output, "runtime/node"), executable);
  await run(
    "npx",
    [
      "--yes",
      "--cache",
      join(cache, "npm-cache"),
      "postject@1.0.0-alpha.6",
      executable,
      "NODE_SEA_BLOB",
      blob,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    cache,
  );
  await chmod(executable, 0o755);
}

async function sourceDirty(repo: string) {
  return await new Promise<boolean>((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain=v1"], { cwd: repo });
    let dirty = false;
    child.stdout.on("data", (chunk: Buffer) => {
      dirty ||= chunk.length > 0;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(dirty);
      else reject(new Error("distribution-source-status-unavailable"));
    });
  });
}
