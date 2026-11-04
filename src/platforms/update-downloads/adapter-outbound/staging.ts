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
//   - Durability synchronization of owned update staging directories.
// - Must-Not:
//   - Publish archives, fetch releases, or authorize installation.
// - Allows:
//   - Inputs: Path to a freshly created update staging directory.
//   - Outputs: Successful directory sync or filesystem rejection.
//   - Side effects: Read-only descriptor open and durability sync.
// - Split-When:
//   - Update staging adopts a different transactional storage boundary.
// - Merge-When:
//   - Signed and GitHub download staging share durability requirements.
// - Summary:
//   - Syncs the staging directory before returning an archive path.
// - Description:
//   - Rejects a replaced non-directory path instead of blocking on it.
// - Usage:
//   - Call after renaming a verified partial archive into place.
// - Defaults:
//   - Invalid staging paths are rejected rather than published.
//
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export async function syncStagedDirectory(path: string): Promise<void> {
  // Require a real directory before opening: a FIFO must never wait for a
  // writer, and a symlink must not redirect durability into another tree.
  const folder = await open(path, constants.O_RDONLY | constants.O_DIRECTORY |
    constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { await folder.sync(); }
  finally { await folder.close(); }
}
