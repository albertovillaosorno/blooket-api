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
import { join } from "node:path";
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
  decodeEditRecipe,
  normalizationStatus,
  type LibraryMetadata,
} from "../../../media/library-metadata/domain/metadata.ts";
import {
  compactImageIsolated,
  decodeImageIsolated,
  sampleImageColorsIsolated,
  renderImageIsolated,
} from "../../../platforms/native-media/adapter-outbound/process.ts";
import {
  initializeLibrary,
  listLibrary,
  saveMetadata,
  safeLibraryPath,
  withLibraryLock,
  boundedBytes,
} from "../../../platforms/user-library/adapter-outbound/files.ts";
import {
  loadPreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import { writeAtomicFile } from
  "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import { decodeProjectDocument } from
  "../../../projects/project-documents/domain/project.ts";
import { MAX_PREPARED_MEDIA_BYTES } from
  "../../../media/rendition-optimization/domain/limits.ts";
import type { ExportDefaults } from
  "../../../settings/teacher-preferences/domain/preferences.ts";
import {
  commandSuccess,
  commandFailure,
} from "../../command-execution/application/result.ts";

function hasConfiguredCanvas(
  record: LibraryMetadata,
  defaults: Pick<ExportDefaults, "width" | "height">,
): boolean {
  return (
    record.edit.width === defaults.width &&
    record.edit.height === defaults.height
  );
}

export function libraryRecordView(
  record: LibraryMetadata,
  defaults: Pick<ExportDefaults, "width" | "height">,
) {
  const currentCanvas = hasConfiguredCanvas(record, defaults);
  return {
    ...record,
    edit: {
      ...record.edit,
      width: defaults.width,
      height: defaults.height,
    },
    prepared: currentCanvas ? record.prepared : null,
    normalizationStatus: normalizationStatus(record),
  };
}

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
          return commandSuccess(
            command.operationId,
            matches.map((record) =>
              libraryRecordView(record, preferences.defaults),
            ),
          );
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
          records: page.map((record) =>
            libraryRecordView(record, preferences.defaults),
          ),
          nextCursor: remaining.length > page.length ? page.at(-1)!.id : null,
          total: matches.length,
        });
      }
      if (payload.kind !== "get" && payload.kind !== "enrich")
        throw new Error("invalid-command");
      if (payload.kind === "get") {
        const record = records.find((item) => item.id === payload.id);
        if (!record) throw new Error("media-not-found");
        return commandSuccess(
          command.operationId,
          libraryRecordView(record, preferences.defaults),
        );
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
          original: {
            ...record.original,
            language: payload.language,
          },
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
        return commandSuccess(
          command.operationId,
          libraryRecordView(updated, preferences.defaults),
        );
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
export async function sampleLibraryImageColors(
  root: string,
  input: unknown,
): Promise<{ readonly rgba: readonly number[] }> {
  const request = object(input);
  const hasId = "id" in request;
  exact(request, [hasId ? "id" : "base64"]);
  let bytes: Uint8Array;
  if (hasId) {
    if (
      !text(request["id"], 128) ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(request["id"])
    )
      throw new Error("invalid-media-id");
    const library = (await loadPreferences(root)).mediaRoot;
    const record = (await listLibrary(library)).find(
      (item) => item.id === request["id"],
    );
    if (!record) throw new Error("media-not-found");
    const path = await safeLibraryPath(library, record.asset);
    bytes = await boundedBytes(path, 25_000_000);
    if (bytes.length < 1) throw new Error("invalid-or-oversized-library-file");
  } else {
    if (!text(request["base64"], 35_000_000))
      throw new Error("invalid-source-bytes");
    bytes = Buffer.from(request["base64"] as string, "base64");
    if (
      bytes.length < 1 ||
      bytes.length > 25_000_000 ||
      Buffer.from(bytes).toString("base64") !== request["base64"]
    )
      throw new Error("invalid-source-bytes");
  }
  return { rgba: [...(await sampleImageColorsIsolated(bytes))] };
}

export async function inspectPreparationAdmission(
  root: string,
  input: unknown,
  options: { readonly signal?: AbortSignal } = {},
) {
  const request = object(input);
  const hasId = "id" in request;
  exact(request, ["edit", hasId ? "id" : "base64"]);
  const recipe = decodeEditRecipe(request["edit"]);
  const preferences = await loadPreferences(root);
  if (
    recipe.width !== preferences.defaults.width ||
    recipe.height !== preferences.defaults.height
  )
    throw new Error("canvas-settings-conflict");

  let bytes: Uint8Array;
  if (hasId) {
    if (
      !text(request["id"], 128) ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(request["id"])
    )
      throw new Error("invalid-media-id");
    bytes = await withLibraryLock(preferences.mediaRoot, async () => {
      const record = (await listLibrary(preferences.mediaRoot)).find(
        (item) => item.id === request["id"],
      );
      if (!record) throw new Error("media-not-found");
      const path = await safeLibraryPath(preferences.mediaRoot, record.asset);
      return await boundedBytes(path, 25_000_000);
    });
  } else {
    if (!text(request["base64"], 35_000_000))
      throw new Error("invalid-source-bytes");
    const source = Buffer.from(request["base64"] as string, "base64");
    if (
      source.length < 1 ||
      source.length > 25_000_000 ||
      Buffer.from(source).toString("base64") !== request["base64"]
    )
      throw new Error("invalid-source-bytes");
    const compacted = await compactImageIsolated(
      source,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    if (!compacted.ok) throw new Error(compacted.code);
    bytes = compacted.value.bytes;
  }

  const rendered = await renderImageIsolated(
    bytes,
    { ...recipe, compression: "lossless" },
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (!rendered.ok) {
    return {
      feasible: false as const,
      highQuality: false as const,
      code: rendered.sourceCode ?? rendered.code,
      effective: null,
    };
  }
  return {
    feasible: true as const,
    highQuality: rendered.value.effective.compression === "lossless",
    code: null,
    effective: rendered.value.effective,
  };
}

export async function importLibraryImage(
  root: string,
  input: unknown,
): Promise<LibraryMetadata> {
  const request = object(input);
  exact(request, ["name", "description", "base64", "edit"]);
  const recipe = decodeEditRecipe(request["edit"]);
  const preferences = await loadPreferences(root);
  if (
    recipe.width !== preferences.defaults.width ||
    recipe.height !== preferences.defaults.height
  )
    throw new Error("canvas-settings-conflict");
  if (
    !text(request["name"], 200) ||
    !text(request["description"], 10_000) ||
    !text(request["base64"], 35_000_000)
  )
    throw new Error("invalid-import");
  const bytes = Buffer.from(request["base64"], "base64");
  if (
    bytes.length > 25_000_000 ||
    bytes.toString("base64") !== request["base64"]
  )
    throw new Error("invalid-source-bytes");
  const decoded = await decodeImageIsolated(bytes, 40_000_000);
  if (!decoded.ok) throw new Error(decoded.code);
  const compacted = await compactImageIsolated(bytes);
  if (!compacted.ok) throw new Error(compacted.code);

  const library = preferences.mediaRoot;
  await initializeLibrary(library);
  return await withLibraryLock(library, async () => {
    const id = randomUUID();
    const asset = "photos/" + id + "." + compacted.value.format;
    const path = await safeLibraryPath(library, asset, true);
    await writeAtomicFile(path, compacted.value.bytes);
    try {
      const metadata: LibraryMetadata = {
        schemaVersion: 1,
        id,
        asset,
        revision: 1,
        original: {
          revision: 1,
          name: request["name"] as string,
          description: request["description"] as string,
          language: "",
        },
        topics: [],
        generatedEnglish: null,
        edit: recipe,
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
  exact(request, ["id", "revision", "edit", "original"]);
  const recipe = decodeEditRecipe(request["edit"]);
  const preferences = await loadPreferences(root);
  if (
    recipe.width !== preferences.defaults.width ||
    recipe.height !== preferences.defaults.height
  )
    throw new Error("canvas-settings-conflict");
  const original = object(request["original"]);
  exact(original, ["name", "description"]);
  if (
    !text(original["name"], 200) ||
    !text(original["description"], 10_000)
  )
    throw new Error("invalid-original-metadata");
  const library = preferences.mediaRoot;
  return await withLibraryLock(library, async () => {
    const record = (await listLibrary(library)).find(
      (item) => item.id === request["id"],
    );
    if (!record) throw new Error("media-not-found");
    if (record.revision !== request["revision"])
      throw new Error("revision-conflict");
    const changed =
      original["name"] !== record.original.name ||
      original["description"] !== record.original.description;
    const next: LibraryMetadata = {
      ...record,
      revision: record.revision + 1,
      edit: recipe,
      topics: changed ? [] : record.topics,
      prepared: null,
      original: {
        name: original["name"] as string,
        description: original["description"] as string,
        language: changed ? "" : record.original.language,
        revision: record.original.revision + (changed ? 1 : 0),
      },
    };
    await saveMetadata(library, next);
    return next;
  });
}
async function withPreparationLibraryLock<T>(
  library: string,
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (signal?.aborted) throw new Error("native-media-cancelled");
    try {
      return await withLibraryLock(library, work);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "library-busy" ||
        attempt === 199
      )
        throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("library-busy");
}

export async function prepareLibraryImage(
  root: string,
  id: string,
  expectedRevision: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<LibraryMetadata> {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1
  )
    throw new Error("invalid-prepare-revision");
  const preferences = await loadPreferences(root);
  const library = preferences.mediaRoot;
  const snapshot = await withPreparationLibraryLock(
    library,
    options.signal,
    async () => {
      const record = (await listLibrary(library)).find(
        (item) => item.id === id,
      );
      if (!record) throw new Error("media-not-found");
      if (record.revision !== expectedRevision)
        throw new Error("prepared-revision-conflict");
      if (!hasConfiguredCanvas(record, preferences.defaults))
        throw new Error("canvas-settings-conflict");
      const originalPath = await safeLibraryPath(library, record.asset);
      if ((await lstat(originalPath)).size > 25_000_000)
        throw new Error("source-too-large");
      return {
        record,
        bytes: await boundedBytes(originalPath, 25_000_000),
      };
    },
  );
  const rendered = await renderImageIsolated(
    snapshot.bytes,
    snapshot.record.edit,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (!rendered.ok) throw new Error(rendered.sourceCode ?? rendered.code);
  const extension = rendered.value.format === "jpeg" ? "jpg" : "gif";
  const file =
    "renditions/" +
    id +
    "/" +
    snapshot.record.revision +
    "." +
    extension;
  return await withPreparationLibraryLock(
    library,
    options.signal,
    async () => {
      const currentPreferences = await loadPreferences(root);
      if (
        currentPreferences.mediaRoot !== library ||
        currentPreferences.defaults.width !== preferences.defaults.width ||
        currentPreferences.defaults.height !== preferences.defaults.height
      )
        throw new Error("prepared-settings-conflict");
      const current = (await listLibrary(library)).find(
        (item) => item.id === id,
      );
      if (!current) throw new Error("media-not-found");
      if (
        current.revision !== snapshot.record.revision ||
        current.asset !== snapshot.record.asset
      )
        throw new Error("prepared-revision-conflict");
      await writeAtomicFile(
        await safeLibraryPath(library, file, true),
        rendered.value.bytes,
      );
      const next = {
        ...current,
        prepared: {
          file,
          bytes: rendered.value.bytes.length,
          recipeRevision: current.revision,
          effective: rendered.value.effective,
        },
      };
      await saveMetadata(library, next);
      return next;
    },
  );
}
export function safeCode(error: unknown): string {
  return error instanceof Error && /^[a-z][a-z0-9-]{1,60}$/u.test(error.message)
    ? error.message
    : "operation-failed";
}
function hash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function readPreparedLibraryImage(
  library: string,
  id: string,
  expectedRevision?: number,
  expectedCanvas?: Pick<ExportDefaults, "width" | "height">,
) {
  return await withLibraryLock(library, async () => {
    const record = (await listLibrary(library)).find((item) => item.id === id);
    if (!record) throw new Error("media-not-found");
    const prepared = record.prepared;
    if (prepared === null) throw new Error("media-not-prepared");
    if (
      expectedCanvas !== undefined &&
      !hasConfiguredCanvas(record, expectedCanvas)
    )
      throw new Error("prepared-settings-conflict");
    if (
      prepared.recipeRevision !== record.revision ||
      (expectedRevision !== undefined && expectedRevision !== record.revision)
    )
      throw new Error("prepared-revision-conflict");
    const prefix = "renditions/" + record.id + "/" + record.revision;
    if (![prefix + ".png", prefix + ".jpg", prefix + ".gif"].includes(
      prepared.file,
    ))
      throw new Error("prepared-media-invalid");
    const bytes = await boundedBytes(
      await safeLibraryPath(library, prepared.file),
      MAX_PREPARED_MEDIA_BYTES,
    );
    if (bytes.length !== prepared.bytes)
      throw new Error("prepared-media-invalid");
    const decoded = await decodeImageIsolated(bytes, 80_000_000);
    if (
      !decoded.ok ||
      decoded.value.frameWidth !== record.edit.width ||
      decoded.value.frameHeight !== record.edit.height ||
      !prepared.file.endsWith(
        decoded.value.format.format === "jpeg"
          ? ".jpg"
          : "." + decoded.value.format.format,
      )
    )
      throw new Error("prepared-media-invalid");
    return { bytes, file: prepared.file, revision: record.revision };
  });
}
