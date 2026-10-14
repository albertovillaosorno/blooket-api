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
//   - Repository-local release manifest command composition.
// - Must-Not:
//   - Print key material, choose trust roots, publish, tag, or install updates.
// - Allows:
//   - Inputs: One bounded output name and explicit local signing environment.
//   - Outputs: Public production status or sanitized configuration failures.
//   - Side effects: Git observations and owned public manifest creation.
// - Split-When:
//   - Another CI signing authority needs independent configuration.
// - Merge-When:
//   - Distribution assembly directly owns final release signing.
// - Summary:
//   - Produces metadata only from clean committed package identity.
// - Description:
//   - Signing inputs never enter arguments, output or teacher-facing tools.
// - Usage:
//   - Invoke after exact-source final package validation in trusted release CI.
// - Defaults:
//   - Missing publisher configuration or uncommitted source refuses signing.
//
import { execFile } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PRODUCT_VERSION } from
  "../../../ir/product-version/contract/version.ts";
import { distributionDirectory } from "../adapter-outbound/build.ts";
import { createSignedReleaseManifest } from
  "../adapter-outbound/update-manifest.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const execute = promisify(execFile);
let failure = "invalid-output-name";
try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("invalid-output");
  const directory = distributionDirectory(repo, args[0]);
  failure = "publisher-configuration-unavailable";
  // Only an explicitly configured local/CI environment carries these inputs.
  // No .env file is loaded, and no input value is echoed on any error path.
  const privatePem = process.env["BLOOKET_UPDATE_SIGNING_KEY"];
  const publicSource = process.env["BLOOKET_UPDATE_PUBLISHER_KEYS"];
  if (typeof privatePem !== "string" || privatePem.length > 8_192 ||
      typeof publicSource !== "string" || publicSource.length > 16_384)
    throw new Error("missing-publisher");
  const publicPems: unknown = JSON.parse(publicSource);
  if (!Array.isArray(publicPems) || publicPems.length < 1 ||
      publicPems.length > 8 || publicPems.some(value =>
        typeof value !== "string" || value.length > 2_048 ||
        !value.startsWith("-----BEGIN PUBLIC KEY-----\n")))
    throw new Error("invalid-publisher");
  const privateKey = createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("invalid-signing-algorithm");
  const trustedKeys = publicPems.map(value => {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519" ||
        key.export({ format: "pem", type: "spki" }).toString() !== value)
      throw new Error("invalid-publisher");
    return key;
  });
  failure = "source-identity-unavailable";
  // Git observations need no publisher secrets in their child environment.
  const options = { cwd: repo, timeout: 5_000, maxBuffer: 65_536,
    env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
      LANG: process.env["LANG"] } };
  const dirty = await execute("git", ["status", "--porcelain=v1",
    "--untracked-files=all"], options);
  if (dirty.stdout) throw new Error("uncommitted-source");
  const commit = (await execute("git", ["rev-parse", "HEAD"], options))
    .stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("invalid-source");
  failure = "manifest-production-failed";
  const result = await createSignedReleaseManifest({ directory,
    version: PRODUCT_VERSION, sourceCommit: commit, privateKey, trustedKeys });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status !== "signed") process.exitCode = 1;
} catch {
  process.stderr.write("Release manifest unavailable: " + failure + ".\n");
  process.exitCode = 1;
}
