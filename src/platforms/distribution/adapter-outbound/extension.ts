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
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
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
    await cp(
      join(repo, presentation, "manifest.json"),
      join(destination, "manifest.json"),
    );
  } catch {
    await rm(destination, { recursive: true, force: true });
    throw new Error("browser-extension-build-failed");
  }
}
