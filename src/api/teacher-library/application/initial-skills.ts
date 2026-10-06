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
//   - First-use installation of bundled authoring guidance.
// - Must-Not:
//   - Overwrite personal skills or grant authority through skill text.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Create missing skills under the trusted user-data root.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - First-use installation of bundled authoring guidance.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { readFile } from "node:fs/promises";
import { safeLibraryPath } from
  "../../../platforms/user-library/adapter-outbound/files.ts";
import { writeDurableFileIfAbsent } from
  "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";

export async function installInitialSkills(root: string): Promise<void> {
  for (const id of [
    "master-workflow",
    "workflow-learning",
    "quiz-authoring",
    "human-validation",
    "browser-image-search",
    "image-bank-research",
    "media-analysis",
    "media-enrichment",
    "codex-repository-access",
  ]) {
    const source = await readFile(
      new URL("../../../../docs/skills/" + id + ".md", import.meta.url),
      "utf8",
    );
    if (Buffer.byteLength(source, "utf8") > 64_000)
      throw new Error("initial-skill-too-large");
    const path = await safeLibraryPath(root, "skills/" + id + ".md", true);
    await writeDurableFileIfAbsent(path, source);
  }
}
