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
//   - Explicit local migration and user-requested asset path changes.
// - Must-Not:
//   - Infer languages, discard legacy verification, or expose paths to MCP.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - ide effects: Journal and replay transfers under the selected
//     library root.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Explicit local migration and user-requested asset path changes.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { extname } from "node:path";
import { decodeMediaJsonLines } from
  "../../../media/media-index/domain/json-lines.ts";
import {
  safeRelativeImage,
  object,
  exact,
  type LibraryMetadata,
} from "../../../media/library-metadata/domain/metadata.ts";
import { decodeSourceImage } from
  "../../../media/image-decoding/adapter-outbound/sharp-image.ts";
import { loadPreferences } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  initializeLibrary,
  withLibraryLock,
  listLibrary,
  safeLibraryPath,
  metadataPath,
  commitLibraryTransaction,
  boundedBytes,
  digest,
  exists,
  type LibraryTransfer,
} from "../../../platforms/user-library/adapter-outbound/files.ts";

export async function migrateLegacyLibrary(root: string) {
  const preferences = await loadPreferences(root);
  const library = preferences.mediaRoot;
  await initializeLibrary(library);
  return await withLibraryLock(library, async () => {
    const index = await safeLibraryPath(library, "media.jsonl");
    if (!(await exists(index))) return { migrated: 0, alreadyMigrated: true };
    const indexBytes = await boundedBytes(index, 16_000_000);
    const indexDigest = digest(indexBytes);
    const archive = await safeLibraryPath(library, "media.jsonl.migrated");
    if (await exists(archive)) throw new Error("legacy-archive-conflict");
    const decoded = decodeMediaJsonLines(indexBytes.toString("utf8"));
    if (!decoded.ok) throw new Error("invalid-legacy-media-index");
    if (decoded.value.length > 10_000) throw new Error("library-record-limit");
    const current = await listLibrary(library);
    const ids = new Set(current.map((record) => record.id));
    const assets = new Set(current.map((record) => record.asset));
    const transfers: LibraryTransfer[] = [];
    let bytesTotal = 0;
    for (const record of decoded.value) {
      if (!safeRelativeImage(record.path))
        throw new Error("invalid-legacy-source-path");
      const asset = record.path.startsWith("photos/")
        ? record.path
        : "photos/" + record.path;
      if (ids.has(record.id) || assets.has(asset))
        throw new Error("metadata-identity-conflict");
      const source = await safeLibraryPath(library, record.path);
      const target = await safeLibraryPath(library, asset);
      if (source !== target && (await exists(target)))
        throw new Error("filename-already-exists");
      if (await exists(await safeLibraryPath(library, metadataPath(asset))))
        throw new Error("metadata-identity-conflict");
      const bytes = await boundedBytes(source, 25_000_000);
      bytesTotal += bytes.length;
      if (bytesTotal > 256_000_000)
        throw new Error("library-transfer-byte-limit");
      await validateImageExtension(bytes, record.path);
      const after: LibraryMetadata = {
        schemaVersion: 2,
        id: record.id,
        asset,
        revision: 1,
        original: {
          revision: 1,
          name: record.name,
          description: record.description,
          language: "",
        },
        topics: [],
        generatedEnglish: null,
        edit: {
          ...preferences.defaults,
          panX: 0,
          panY: 0,
          zoom: 1,
          contrast: 1,
          saturation: 1,
          background: { mode: "blur", color: "#ffffff" },
        },
        prepared: null,
        legacy: {
          englishVerified: record.english,
          sourceRevision: 1,
          sourcePath: record.path,
          indexDigest,
        },
      };
      transfers.push({
        source: record.path,
        digest: digest(bytes),
        bytes: bytes.length,
        before: null,
        after,
      });
      ids.add(record.id);
      assets.add(asset);
    }
    await commitLibraryTransaction(library, {
      version: 1,
      kind: "migrate",
      indexDigest,
      transfers,
    });
    return { migrated: transfers.length, alreadyMigrated: false };
  });
}
export async function renameLibraryImage(root: string, input: unknown) {
  const request = object(input);
  exact(request, ["id", "revision", "relativePath"]);
  if (
    typeof request["relativePath"] !== "string" ||
    !safeRelativeImage(request["relativePath"])
  )
    throw new Error("invalid-user-filename");
  const library = (await loadPreferences(root)).mediaRoot;
  return await withLibraryLock(library, async () => {
    const record = (await listLibrary(library)).find(
      (item) => item.id === request["id"],
    );
    if (!record) throw new Error("media-not-found");
    if (record.revision !== request["revision"])
      throw new Error("revision-conflict");
    const asset = "photos/" + request["relativePath"];
    if (record.asset === asset) return record;
    if (
      (await exists(await safeLibraryPath(library, asset))) ||
      (await exists(await safeLibraryPath(library, metadataPath(asset))))
    )
      throw new Error("filename-already-exists");
    const bytes = await boundedBytes(
      await safeLibraryPath(library, record.asset),
      25_000_000,
    );
    await validateImageExtension(bytes, asset);
    const after = {
      ...record,
      asset,
      revision: record.revision + 1,
      prepared: null,
    };
    await commitLibraryTransaction(library, {
      version: 1,
      kind: "rename",
      indexDigest: null,
      transfers: [
        {
          source: record.asset,
          digest: digest(bytes),
          bytes: bytes.length,
          before: record,
          after,
        },
      ],
    });
    return after;
  });
}
async function validateImageExtension(bytes: Uint8Array, path: string) {
  const decoded = await decodeSourceImage(bytes, 40_000_000);
  if (!decoded.ok) throw new Error(decoded.code);
  const extension = extname(path).toLowerCase();
  const actual = decoded.value.format.format;
  if (
    actual === "jpeg"
      ? ![".jpg", ".jpeg"].includes(extension)
      : extension !== "." + actual
  )
    throw new Error("filename-format-mismatch");
}
