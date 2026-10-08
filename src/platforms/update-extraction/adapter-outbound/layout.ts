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
//   - Exact physical ZIP layout and internal-link admission.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Authenticated archive facts and trusted local staging authority.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: None.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Exact physical ZIP layout and internal-link admission.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
export const BUNDLE_ROOT = "Blooket API.app";
export const MAX_ZIP_ENTRIES = 20_000;
export const MAX_EXPANDED_BYTES = 1_073_741_824;
export const MAX_ENTRY_BYTES = 536_870_912;
export interface ArchiveRecord {
  readonly path: string;
  readonly kind: "directory" | "file" | "symlink";
  readonly size: number;
  readonly executable: number;
  readonly hash?: string;
  readonly target?: string;
}
export interface ArchiveLayout {
  readonly bundle: ReadonlyMap<string, ArchiveRecord>;
  readonly metadata: ReadonlyMap<string, ArchiveRecord>;
  readonly expandedBytes: number;
}

export function archivePath(name: string, directory: boolean): string {
  if (typeof name !== "string" || name.length > 1_024 ||
      !/^[\x20-\x7e]+$/u.test(name) || name.includes("\\") ||
      name.includes(":")) throw new Error("archive-layout");
  const path = directory ? name.replace(/\/$/u, "") : name;
  const components = path.split("/");
  if (components.length > 40 || components.some(part =>
    part === "" || part === "." || part === ".." || part.trim() !== part))
    throw new Error("archive-layout");
  if (components[0] !== BUNDLE_ROOT && components[0] !== "__MACOSX")
    throw new Error("archive-layout");
  return path;
}

export function buildArchiveLayout(records: readonly ArchiveRecord[]) {
  const bundle = new Map<string, ArchiveRecord>();
  const metadata = new Map<string, ArchiveRecord>();
  const spelling = new Map<string, string>();
  const explicit = new Set<string>();
  let expandedBytes = 0;
  function add(record: ArchiveRecord, supplied: boolean) {
    const folded = record.path.toLowerCase();
    const oldSpelling = spelling.get(folded);
    if ((oldSpelling && oldSpelling !== record.path) ||
        (supplied && explicit.has(record.path)))
      throw new Error("archive-layout");
    spelling.set(folded, record.path);
    if (supplied) explicit.add(record.path);
    const map = record.path.startsWith("__MACOSX") ? metadata : bundle;
    const previous = map.get(record.path);
    if (previous && (previous.kind !== "directory" ||
        record.kind !== "directory")) throw new Error("archive-layout");
    map.set(record.path, record);
    if (spelling.size > 40_000) throw new Error("archive-limit");
  }
  if (records.length < 1 || records.length > MAX_ZIP_ENTRIES)
    throw new Error("archive-limit");
  for (const record of records) {
    if (archivePath(record.path, record.kind === "directory") !== record.path)
      throw new Error("archive-layout");
    if (!Number.isSafeInteger(record.size) || record.size < 0 ||
        record.size > MAX_ENTRY_BYTES) throw new Error("archive-limit");
    expandedBytes += record.size;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error("archive-limit");
    const parts = record.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      const map = parent.startsWith("__MACOSX") ? metadata : bundle;
      if (!map.has(parent)) add({ path: parent, kind: "directory",
        size: 0, executable: 0 }, false);
      else if (map.get(parent)!.kind !== "directory")
        throw new Error("archive-layout");
    }
    add(record, true);
  }
  for (const record of metadata.values()) {
    if (record.path === "__MACOSX") {
      if (record.kind !== "directory") throw new Error("archive-layout");
      continue;
    }
    if (record.kind === "symlink") throw new Error("archive-layout");
    const parts = record.path.slice("__MACOSX/".length).split("/");
    if (record.kind === "file") {
      const last = parts.at(-1)!;
      if (!last.startsWith("._") || last.length < 3)
        throw new Error("archive-layout");
      parts[parts.length - 1] = last.slice(2);
    }
    const counterpart = bundle.get(parts.join("/"));
    if (!counterpart || (record.kind === "directory" &&
        counterpart.kind !== "directory")) throw new Error("archive-layout");
  }
  function linkTarget(record: ArchiveRecord) {
    const target = record.target;
    if (!target || target.length > 4_096 || target.startsWith("/") ||
        !/^[\x20-\x7e]+$/u.test(target) || /[\\:]/u.test(target) ||
        target.split("/").some(part => part === "" || part.trim() !== part))
      throw new Error("archive-layout");
    return target.split("/");
  }
  for (const record of bundle.values()) {
    if (record.kind !== "symlink") continue;
    // Resolve components in filesystem order: normalize-before-link expansion
    // can turn link/../file into a different path than the native extractor.
    const resolved = record.path.split("/").slice(0, -1);
    const pending = linkTarget(record);
    let hops = 0;
    while (pending.length) {
      const part = pending.shift()!;
      if (part === ".") continue;
      if (part === "..") {
        if (resolved.length <= 1) throw new Error("archive-layout");
        resolved.pop();
        continue;
      }
      const path = [...resolved, part].join("/");
      const entry = bundle.get(path);
      if (!entry) throw new Error("archive-layout");
      if (entry.kind === "symlink") {
        if (++hops > 40) throw new Error("archive-layout");
        pending.unshift(...linkTarget(entry));
      } else {
        if (pending.length && entry.kind !== "directory")
          throw new Error("archive-layout");
        resolved.push(part);
      }
    }
    const destination = resolved.join("/");
    if (destination === BUNDLE_ROOT ||
        record.path.startsWith(destination + "/"))
      throw new Error("archive-layout");
  }
  for (const path of ["Contents/Info.plist", "Contents/MacOS/Blooket API",
    "Contents/Resources/runtime/node"]) {
    const record = bundle.get(BUNDLE_ROOT + "/" + path);
    if (record?.kind !== "file" ||
        (path !== "Contents/Info.plist" && record.executable === 0))
      throw new Error("archive-layout");
  }
  return { bundle, metadata, expandedBytes } satisfies ArchiveLayout;
}
