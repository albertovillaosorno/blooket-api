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
//   - Guarded silent atomic exchange of two admitted application directories.
// - Must-Not:
//   - Choose update policy, verify publishers, remove apps, or open Terminal.
// - Allows:
//   - Inputs: Trusted local paths and exact expected filesystem identities.
//   - Outputs: Observed exchange orientation or bounded failure reasons.
//   - Side effects: Native atomic directory exchange and directory syncs.
// - Split-When:
//   - Update orchestration needs semantic journal/restart authority.
// - Merge-When:
//   - Node exposes the required atomic exchange syscall directly.
// - Summary:
//   - Retains both applications and inspects outcomes after native completion.
// - Description:
//   - An uncertain process result cannot authorize a blind second exchange.
// - Usage:
//   - Hold the installation lock and quiesce writers in trusted composition.
// - Defaults:
//   - Unsupported hosts and changed identities never invoke exchange.
//
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { directoryIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";

export const execute = promisify(execFile);
export async function fixture(compile = true) {
  const root = await realpath(await mkdtemp(
    join(tmpdir(), "bundle-exchange-")));
  const installedPath = join(root, "Blooket API.app");
  const prepared = join(root, ".blooket-api.update-" + randomUUID());
  const candidatePath = join(prepared, "Blooket API.app");
  const helperPath = join(root, "bundle-exchange");
  try {
    await mkdir(installedPath, { mode: 0o700 });
    await mkdir(prepared, { mode: 0o700 });
    await mkdir(candidatePath, { mode: 0o700 });
    await writeFile(join(installedPath, "marker"), "old version");
    await writeFile(join(candidatePath, "marker"), "new version");
    if (compile) {
      const source = fileURLToPath(new URL(
        "../../../../src/platforms/bundle-exchange/adapter-outbound/native.c",
        import.meta.url));
      const mac = process.platform === "darwin";
      await execute(mac ? "xcrun" : "cc", [
        ...(mac ? ["clang", "-D_DARWIN_C_SOURCE=1"] : []),
        "-std=c17", "-Wall", "-Wextra", "-Werror", source, "-o", helperPath,
      ], { timeout: 10_000, maxBuffer: 4_096 });
    } else {
      await writeFile(helperPath, "synthetic non-executed helper");
    }
    await chmod(helperPath, 0o700);
    return { root, prepared, options: {
      installedPath, candidatePath, helperPath,
      installedIdentity: await directoryIdentity(installedPath),
      candidateIdentity: await directoryIdentity(candidatePath),
      host: { platform: "darwin", architecture: "arm64" } },
    cleanup: () => rm(root, { recursive: true }) };
  } catch (error) {
    await rm(root, { recursive: true }); throw error;
  }
}
