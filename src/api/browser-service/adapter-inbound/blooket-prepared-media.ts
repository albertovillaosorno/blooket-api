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
//   - Composition from current teacher-library prepared files to Blooket media.
// - Must-Not:
//   - Expose vault paths, prepare images, mutate metadata, or upload remotely.
// - Allows:
//   - Inputs: User-data root and one stable media ID.
//   - Outputs: Current revision, decoded format, exact bytes, or stable
//     failure.
//   - Side effects: Read-only preferences and prepared-library reads.
// - Split-When:
//   - Publication moves to a dedicated composition service.
// - Merge-When:
//   - Browser service directly owns the Blooket publication composition.
// - Summary:
//   - Adapts validated current prepared library media into the Blooket port.
// - Description:
//   - Current canvas is required so historical renditions fail as stale.
// - Usage:
//   - Supply to persisted Blooket execution from the owning local runtime.
// - Defaults:
//   - Unknown library failures become blooket-media-unavailable.
//
import type { BlooketPreparedMediaReadPort } from
  "../../blooket-write-execution/contract/prepared-media.ts";
import { readPreparedLibraryImage } from
  "../../teacher-library/application/library.ts";
import { loadPreferences } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";

interface PreparedMediaDependencies {
  readonly loadPreferences: typeof loadPreferences;
  readonly readPrepared: typeof readPreparedLibraryImage;
}

const DEFAULT_DEPENDENCIES: PreparedMediaDependencies = {
  loadPreferences,
  readPrepared: readPreparedLibraryImage,
};

export function createBlooketPreparedMediaReadPort(
  root: string,
  dependencies: PreparedMediaDependencies = DEFAULT_DEPENDENCIES,
): BlooketPreparedMediaReadPort {
  return {
    read: async (mediaId) => {
      try {
        const preferences = await dependencies.loadPreferences(root);
        const prepared = await dependencies.readPrepared(
          preferences.mediaRoot,
          mediaId,
          undefined,
          {
            width: preferences.defaults.width,
            height: preferences.defaults.height,
          },
        );
        const format = formatForPreparedFile(prepared.file);
        if (format === null) {
          return {
            ok: false,
            code: "blooket-media-invalid",
          };
        }
        return {
          ok: true,
          value: {
            mediaId,
            revision: prepared.revision,
            format,
            bytes: prepared.bytes,
          },
        };
      } catch (error: unknown) {
        return {
          ok: false,
          code: preparedMediaFailureCode(error),
        };
      }
    },
  };
}

function formatForPreparedFile(
  file: string,
): "gif" | "jpeg" | "png" | null {
  if (file.endsWith(".gif")) return "gif";
  if (file.endsWith(".jpg")) return "jpeg";
  if (file.endsWith(".png")) return "png";
  return null;
}

function preparedMediaFailureCode(error: unknown):
  | "blooket-media-not-prepared"
  | "blooket-media-stale"
  | "blooket-media-invalid"
  | "blooket-media-unavailable" {
  if (!(error instanceof Error))
    return "blooket-media-unavailable";
  switch (error.message) {
    case "media-not-found":
    case "media-not-prepared":
      return "blooket-media-not-prepared";
    case "prepared-revision-conflict":
    case "prepared-settings-conflict":
      return "blooket-media-stale";
    case "prepared-media-invalid":
      return "blooket-media-invalid";
    default:
      return "blooket-media-unavailable";
  }
}
