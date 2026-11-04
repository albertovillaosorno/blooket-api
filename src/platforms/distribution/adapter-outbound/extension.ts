// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - LicenseRef-Proprietary
// Confidential:
//   - true
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Browser-safe extension compilation and resource assembly.
// - Must-Not:
//   - Include credentials, server modules, captures, or repository caches.
// - Allows:
//   - Inputs: A trusted repository root and a fresh destination.
//   - Outputs: One unpacked extension with a compiled module worker.
//   - Side effects: Compiler execution and owned output files.
// - Split-When:
//   - Browser-specific packaging needs a separate native build.
// - Merge-When:
//   - Extensions no longer require compiled source.
// - Summary:
//   - Emits only the worker dependency closure and its static presentation.
// - Description:
//   - Uses the pinned repository compiler without a bundler dependency.
// - Usage:
//   - Assemble an unpacked browser package before native Safari conversion.
// - Defaults:
//   - Existing destinations and failed compilation are never accepted.
//
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildExtensionIcons } from "./icons.ts";

import {
  PRODUCT_VERSION,
  extensionVersion,
} from "../../../ir/product-version/contract/version.ts";

const execute = promisify(execFile);
const MAX_MANIFEST_BYTES = 65_536;

async function readExtensionManifest(path: string): Promise<string> {
  // Caller-selected input or replaced output must not block assembly on FIFO.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW |
    constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 ||
        before.size > MAX_MANIFEST_BYTES)
      throw new Error("extension-manifest-source-invalid");
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await file.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    const after = await file.stat();
    if (size !== before.size || after.size !== before.size ||
        after.dev !== before.dev || after.ino !== before.ino ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs)
      throw new Error("extension-manifest-source-invalid");
    return bytes.subarray(0, size).toString("utf8");
  } finally { await file.close(); }
}

export async function buildBrowserExtension(
  repo: string,
  destination: string,
): Promise<void> {
  // Exclusive creation makes cleanup safe: an existing directory is untouched.
  await mkdir(destination);
  try {
    await execute(
      join(repo, ".dependencies/pnpm/node_modules/.bin/tsc"),
      [
        "--ignoreConfig",
        "--rootDir",
        join(repo, "src"),
        "--outDir",
        join(destination, "src"),
        "--target",
        "ES2024",
        "--lib",
        "ES2024,DOM",
        "--module",
        "ESNext",
        "--moduleResolution",
        "bundler",
        "--rewriteRelativeImportExtensions",
        "--strict",
        "--noEmitOnError",
        "--skipLibCheck",
        join(repo, "src/service/browser-extension/adapter-inbound/worker.ts"),
      ],
      { cwd: repo, timeout: 30_000, maxBuffer: 100_000 },
    );
    const presentation = "src/ui/browser-extension/adapter-inbound";
    await mkdir(join(destination, presentation), { recursive: true });
    for (const name of ["popup.html", "popup.css", "popup.js", "workspace.js"])
      await cp(
        join(repo, presentation, name),
        join(destination, presentation, name),
      );
    const manifest = JSON.parse(await readExtensionManifest(
      join(repo, presentation, "manifest.json"),
    ));
    manifest.version = extensionVersion(PRODUCT_VERSION);
    manifest.version_name = PRODUCT_VERSION;
    await writeFile(
      join(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await buildExtensionIcons(repo, destination);
  } catch {
    await rm(destination, { recursive: true, force: true });
    throw new Error("browser-extension-build-failed");
  }
}

// Firefox MV3 uses an event-page background rather than Chrome's service
// worker. Keep the compiled page code identical and change only the manifest.
// Temporary about:debugging installs need no Mozilla account; permanent
// distribution may require Mozilla's (free) add-on signing process.
export async function buildFirefoxExtension(
  repo: string,
  destination: string,
): Promise<void> {
  await buildBrowserExtension(repo, destination);
  try {
    const path = join(destination, "manifest.json");
    const manifest = JSON.parse(await readExtensionManifest(path));
    delete manifest.minimum_chrome_version;
    manifest.background = {
      scripts: ["src/service/browser-extension/adapter-inbound/worker.js"],
      type: "module",
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: "blooket-api@albertovillaosorno.github",
        // Mozilla's MV3 data-collection declaration needs Firefox 140+;
        // the same declaration is supported on Android from 142.
        strict_min_version: "142.0",
        data_collection_permissions: { required: ["none"] },
      },
    };
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
  } catch {
    await rm(destination, { recursive: true, force: true });
    throw new Error("firefox-extension-build-failed");
  }
}
