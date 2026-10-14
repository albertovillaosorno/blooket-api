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
//   - Placement of a verified candidate beside the retained installed app.
// - Must-Not:
//   - Authenticate publishers, exchange apps, launch, or select teacher paths.
// - Allows:
//   - Inputs: Trusted installed bundle location and an owned extraction ID.
//   - Outputs: Owned sibling paths and fresh directory identities.
//   - Side effects: Create a private sibling and promote its extracted bundle.
// - Split-When:
//   - Independent installer program snapshots need a separate lifecycle.
// - Merge-When:
//   - Extraction directly provides the admitted exchange location.
// - Summary:
//   - Keeps candidate placement separate from application replacement.
// - Description:
//   - Cleanup applies only to this call's exclusively created directory.
// - Usage:
//   - Compose beneath trusted local update preparation, never remote tools.
// - Defaults:
//   - Changed locations and unsettled writers retain recoverable state.
//
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BUNDLE_NAME, directoryIdentity, locationsAdmitted, pathAdmitted,
  sameIdentity, type DirectoryIdentity } from
  "../../bundle-exchange/adapter-outbound/identity.ts";
import { removeCreatedStage, syncDirectory } from "./files.ts";
import { promotePreparedBundle, type BundlePromotionOptions } from
  "../../bundle-exchange/adapter-outbound/promote.ts";

export interface UpdatePreparationLocation {
  readonly installationId: string;
  readonly directory: string;
  readonly installedPath: string;
  readonly candidatePath: string;
  readonly installedIdentity: DirectoryIdentity;
  unchanged(): Promise<boolean>;
  promote(stageId: string): Promise<DirectoryIdentity>;
  discard(): Promise<void>;
}
const stageIdPattern = new RegExp("^[a-f0-9]{8}-[a-f0-9]{4}-" +
  "4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", "u");

export async function createUpdatePreparationLocation(installedPath: string,
  native: Pick<BundlePromotionOptions, "helperPath" | "host" | "execute" |
    "signal"> = {}):
  Promise<UpdatePreparationLocation> {
  if (!pathAdmitted(installedPath) || basename(installedPath) !== BUNDLE_NAME ||
      dirname(installedPath) === "/")
    throw new Error("update-preparation-location");
  const parent = dirname(installedPath);
  const parentIdentity = await directoryIdentity(parent);
  const installedIdentity = await directoryIdentity(installedPath);
  if (parentIdentity.device !== installedIdentity.device)
    throw new Error("update-preparation-device");
  const installationId = randomUUID();
  const directory = join(parent, ".blooket-api.update-" + installationId);
  const candidatePath = join(directory, BUNDLE_NAME);
  if (!locationsAdmitted(installedPath, candidatePath))
    throw new Error("update-preparation-location");
  await mkdir(directory, { mode: 0o700 });
  const owned = await directoryIdentity(directory);
  const owns = async () => {
    const metadata = await lstat(directory);
    if ((metadata.mode & 0o077) !== 0 ||
        (process.getuid && metadata.uid !== process.getuid()) ||
        !sameIdentity(owned, await directoryIdentity(directory)) ||
        !sameIdentity(parentIdentity, await directoryIdentity(parent)))
      throw new Error("update-preparation-ownership");
  };
  const unchanged = async () => {
    try {
      await owns();
      return sameIdentity(installedIdentity,
        await directoryIdentity(installedPath));
    } catch { return false; }
  };
  await owns();
  await syncDirectory(parent);
  return Object.freeze({ installationId, directory, installedPath,
    candidatePath, installedIdentity: Object.freeze(installedIdentity),
    unchanged,
    promote: async (stageId: string) => {
      if (!stageIdPattern.test(stageId) || !await unchanged())
        throw new Error("update-preparation-stage");
      const unpacked = join(directory, "stage-" + stageId, "unpacked");
      const source = join(unpacked, BUNDLE_NAME);
      if (await realpath(unpacked) !== unpacked ||
          await realpath(source) !== source)
        throw new Error("update-preparation-stage");
      const identity = await directoryIdentity(source);
      // Extraction froze its wrapper. Only that generated wrapper is made
      // writable; the validated application tree retains its frozen modes.
      await chmod(unpacked, 0o700);
      await owns();
      try {
        await lstat(candidatePath);
        throw new Error("update-preparation-candidate-exists");
      } catch (error) {
        if (!(error instanceof Error && "code" in error &&
            error.code === "ENOENT")) throw error;
      }
      const promoted = await promotePreparedBundle({ ...native,
        sourcePath: source, candidatePath, sourceIdentity: identity });
      if (promoted.status !== "promoted")
        throw new Error("update-preparation-promotion");
      if (!await unchanged() ||
          !sameIdentity(identity, await directoryIdentity(candidatePath)))
        throw new Error("update-preparation-ownership");
      return Object.freeze(identity);
    },
    discard: async () => {
      await owns();
      for (const name of [".extract.lock", ".installation.lock"]) {
        try {
          await lstat(join(directory, name));
          throw new Error("update-preparation-writer-active");
        } catch (error) {
          if (!(error instanceof Error && "code" in error &&
              error.code === "ENOENT")) throw error;
        }
      }
      await owns();
      await removeCreatedStage(directory);
      await syncDirectory(parent);
    },
  });
}
