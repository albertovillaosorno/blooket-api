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
//   - Library lifecycle and recoverable skills and quiz drafts.
// - Must-Not:
//   - Let AI overwrite original text, rename assets, or publish drafts.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Library lifecycle and recoverable skills and quiz drafts.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir, rm, lstat } from "node:fs/promises";
import { join, extname } from "node:path";
import {
  decodeLibraryCommand,
  type LibraryCommandName,
} from "../../../ir/library-commands/contract/commands.ts";
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import {
  object,
  exact,
  text,
  topics,
  decodeEditRecipe,
  type LibraryMetadata,
} from "../../../media/library-metadata/domain/metadata.ts";
import { renderEditedImageRendition } from
  "../../../media/image-renditions/adapter-outbound/edit.ts";
import { decodeSourceImage } from
  "../../../media/image-decoding/adapter-outbound/sharp-image.ts";
import {
  initializeLibrary,
  listLibrary,
  saveMetadata,
  safeLibraryPath,
  withLibraryLock,
} from "../../../platforms/user-library/adapter-outbound/files.ts";
import {
  loadPreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import { decodeProjectDocument } from
  "../../../projects/project-documents/domain/project.ts";
import {
  commandSuccess,
  commandFailure,
} from "../../command-execution/application/result.ts";

export async function executeLibraryCommand(
  command: CommandEnvelope,
  dataRoot?: string,
) {
  try {
    const payload = decodeLibraryCommand(
      command.command as LibraryCommandName,
      command.payload,
    );
    if (payload.kind === "profile") {
      const source = await readFile(
        new URL("../../../../docs/agents/user/AGENTS.md", import.meta.url),
        "utf8",
      );
      if (Buffer.byteLength(source, "utf8") > 64_000)
        throw new Error("profile-too-large");
      return commandSuccess(command.operationId, { text: source });
    }
    const root = dataRoot ?? userDataRoot();
    const preferences = await loadPreferences(root);
    await initializeLibrary(preferences.mediaRoot);
    if (command.command.startsWith("library.")) {
      const records = await withLibraryLock(preferences.mediaRoot, () =>
        listLibrary(preferences.mediaRoot),
      );
      if (payload.kind === "list" || payload.kind === "search") {
        const query = payload.query.toLocaleLowerCase();
        const matches = records
          .filter((record) =>
            JSON.stringify([
              record.id,
              record.original,
              record.topics,
              record.generatedEnglish,
            ])
              .toLocaleLowerCase()
              .includes(query),
          )
          .sort((a, b) => (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
        if (payload.kind === "list") {
          if (
            matches.length > 100 ||
            Buffer.byteLength(JSON.stringify(matches)) > 750_000
          )
            throw new Error("use-paginated-library-search");
          return commandSuccess(command.operationId, matches);
        }
        const remaining = matches.filter(
          (item) => payload.after === null || item.id > payload.after,
        );
        const page: LibraryMetadata[] = [];
        let bytes = 0;
        for (const item of remaining) {
          const size = Buffer.byteLength(JSON.stringify(item));
          if (page.length >= payload.limit || bytes + size > 750_000) break;
          page.push(item);
          bytes += size;
        }
        if (remaining.length > 0 && page.length === 0)
          throw new Error("media-metadata-response-too-large");
        return commandSuccess(command.operationId, {
          records: page,
          nextCursor: remaining.length > page.length ? page.at(-1)!.id : null,
          total: matches.length,
        });
      }
      if (payload.kind !== "get" && payload.kind !== "enrich")
        throw new Error("invalid-command");
      if (payload.kind === "get") {
        const record = records.find((item) => item.id === payload.id);
        if (!record) throw new Error("media-not-found");
        return commandSuccess(command.operationId, record);
      }
      return await withLibraryLock(preferences.mediaRoot, async () => {
        const record = (await listLibrary(preferences.mediaRoot)).find(
          (item) => item.id === payload.id,
        );
        if (!record) throw new Error("media-not-found");
        if (record.revision !== payload.revision)
          throw new Error("revision-conflict");
        const updated = {
          ...record,
          revision: record.revision + 1,
          topics: payload.topics,
          generatedEnglish: {
            name: payload.name,
            description: payload.description,
            generatedBy: "ai" as const,
            sourceRevision: record.original.revision,
            verified: false as const,
          },
        };
        await saveMetadata(preferences.mediaRoot, updated);
        return commandSuccess(command.operationId, updated);
      });
    }
    const folder = command.command.startsWith("skills.") ? "skills" : "drafts";
    const directory = join(root, folder);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (payload.kind === "list") {
      return commandSuccess(
        command.operationId,
        (await readdir(directory))
          .filter((file) =>
            file.endsWith(folder === "skills" ? ".md" : ".json"),
          )
          .map((file) => file.slice(0, file.lastIndexOf("."))),
      );
    }
    if (
      payload.kind !== "get" &&
      payload.kind !== "skill-put" &&
      payload.kind !== "draft-put"
    )
      throw new Error("invalid-command");
    const path = await safeLibraryPath(
      root,
      folder + "/" + payload.id + (folder === "skills" ? ".md" : ".json"),
    );
    if (payload.kind === "get") {
      if ((await lstat(path)).size > 1_000_000)
        throw new Error("document-too-large");
      const source = await readFile(path, "utf8");
      let document: unknown;
      if (folder === "drafts") {
        const decoded = decodeProjectDocument(JSON.parse(source));
        if (!decoded.ok) throw new Error("invalid-saved-draft");
        document = decoded.value;
      }
      return commandSuccess(command.operationId, {
        id: payload.id,
        revision: hash(source),
        ...(folder === "skills" ? { text: source } : { document }),
      });
    }
    const lock = await tryAcquireFileLock(path + ".lock");
    if (!lock.ok) throw new Error("document-busy");
    try {
      let old: string | undefined;
      try {
        old = await readFile(path, "utf8");
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
      if ((old === undefined ? null : hash(old)) !== payload.expectedRevision)
        throw new Error("revision-conflict");
      let source: string;
      if (payload.kind === "draft-put") {
        const decoded = decodeProjectDocument(payload.document);
        if (!decoded.ok)
          return commandFailure(command.operationId, decoded.issues);
        source = JSON.stringify(decoded.value, null, 2) + "\n";
      } else source = payload.text;
      await writeAtomicFile(path, source, { backupPath: path + ".previous" });
      return commandSuccess(command.operationId, {
        id: payload.id,
        revision: hash(source),
        saved: true,
        published: false,
      });
    } finally {
      await lock.lock.release();
    }
  } catch (error) {
    return commandFailure(command.operationId, [
      {
        path: "$.payload",
        code: safeCode(error),
        message: "The operation could not be completed.",
      },
    ]);
  }
}
export async function importLibraryImage(
  root: string,
  input: unknown,
): Promise<LibraryMetadata> {
  const request = object(input);
  exact(request, [
    "filename",
    "name",
    "description",
    "language",
    "topics",
    "base64",
  ]);
  if (
    !text(request["filename"], 240) ||
    !/^[^/\\\x00-\x1f]+\.(png|jpe?g|gif|webp)$/iu.test(request["filename"]) ||
    request["filename"].startsWith(".") ||
    !text(request["name"], 200) ||
    !text(request["description"], 10_000) ||
    !text(request["language"], 35) ||
    !text(request["base64"], 35_000_000)
  )
    throw new Error("invalid-import");
  topics(request["topics"]);
  const bytes = Buffer.from(request["base64"], "base64");
  if (
    bytes.length > 25_000_000 ||
    bytes.toString("base64") !== request["base64"]
  )
    throw new Error("invalid-source-bytes");
  const decoded = await decodeSourceImage(bytes, 40_000_000);
  if (!decoded.ok) throw new Error(decoded.code);
  const extension = extname(request["filename"]).toLowerCase();
  const actual = decoded.value.format.format;
  if (
    actual === "jpeg"
      ? ![".jpg", ".jpeg"].includes(extension)
      : extension !== "." + actual
  )
    throw new Error("filename-format-mismatch");
  const preferences = await loadPreferences(root);
  const library = preferences.mediaRoot;
  await initializeLibrary(library);
  return await withLibraryLock(library, async () => {
    const asset = "photos/" + request["filename"];
    const path = await safeLibraryPath(library, asset, true);
    if ((await writeDurableFileIfAbsent(path, bytes)) !== "created")
      throw new Error("filename-already-exists");
    try {
      const metadata: LibraryMetadata = {
        schemaVersion: 1,
        id: randomUUID(),
        asset,
        revision: 1,
        original: {
          revision: 1,
          name: request["name"] as string,
          description: request["description"] as string,
          language: request["language"] as string,
        },
        topics: request["topics"] as string[],
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
      };
      await saveMetadata(library, metadata, true);
      return metadata;
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  });
}
export async function editLibraryImage(
  root: string,
  input: unknown,
): Promise<LibraryMetadata> {
  const request = object(input);
  exact(request, ["id", "revision", "edit", "original", "topics"]);
  const recipe = decodeEditRecipe(request["edit"]);
  topics(request["topics"]);
  const original = object(request["original"]);
  exact(original, ["name", "description", "language"]);
  if (
    !text(original["name"], 200) ||
    !text(original["description"], 10_000) ||
    !text(original["language"], 35)
  )
    throw new Error("invalid-original-metadata");
  const library = (await loadPreferences(root)).mediaRoot;
  return await withLibraryLock(library, async () => {
    const record = (await listLibrary(library)).find(
      (item) => item.id === request["id"],
    );
    if (!record) throw new Error("media-not-found");
    if (record.revision !== request["revision"])
      throw new Error("revision-conflict");
    const changed =
      original["name"] !== record.original.name ||
      original["description"] !== record.original.description ||
      original["language"] !== record.original.language;
    const next: LibraryMetadata = {
      ...record,
      revision: record.revision + 1,
      edit: recipe,
      topics: request["topics"] as string[],
      prepared: null,
      original: {
        name: original["name"] as string,
        description: original["description"] as string,
        language: original["language"] as string,
        revision: record.original.revision + (changed ? 1 : 0),
      },
    };
    await saveMetadata(library, next);
    return next;
  });
}
export async function prepareLibraryImage(
  root: string,
  id: string,
): Promise<LibraryMetadata> {
  const library = (await loadPreferences(root)).mediaRoot;
  return await withLibraryLock(library, async () => {
    const record = (await listLibrary(library)).find((item) => item.id === id);
    if (!record) throw new Error("media-not-found");
    const originalPath = await safeLibraryPath(library, record.asset);
    if ((await lstat(originalPath)).size > 25_000_000)
      throw new Error("source-too-large");
    const rendered = await renderEditedImageRendition(
      await readFile(originalPath),
      {
        name: record.original.name,
        description: record.original.description,
        regions: [],
        transform: record.edit,
      },
      record.edit,
      {
        maxInputPixels: 40_000_000,
        maxOutputPixels: 80_000_000,
        maxOutputBytes: 2_499_999,
      },
      {
        blurSigma: 20,
        gifFps: record.edit.gifFps,
        background: record.edit.background,
        compression: record.edit.compression,
      },
    );
    if (!rendered.ok) throw new Error(rendered.code);
    const file =
      "renditions/" + id + "/" + record.revision + "." + rendered.value.format;
    await writeAtomicFile(
      await safeLibraryPath(library, file, true),
      rendered.value.bytes,
    );
    const next = {
      ...record,
      prepared: {
        file,
        bytes: rendered.value.bytes.length,
        recipeRevision: record.revision,
      },
    };
    await saveMetadata(library, next);
    return next;
  });
}
export function safeCode(error: unknown): string {
  return error instanceof Error && /^[a-z][a-z0-9-]{1,60}$/u.test(error.message)
    ? error.message
    : "operation-failed";
}
function hash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
