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
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Ephemeral fixture keys and bounded synthetic ZIP records.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Test-owned temporary files and native extraction doubles.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { inspectUpdateArchive } from
  "../../../../src/platforms/update-extraction/adapter-outbound/inspect.ts";
import { fixture, baseEntries, type ZipEntryFixture } from "./fixtures.ts";

async function inspect(entries: ZipEntryFixture[], expected?: RegExp) {
  const item = await fixture(entries);
  try {
    const result = inspectUpdateArchive(item.options.archivePath,
      new AbortController().signal);
    if (expected) await assert.rejects(result, expected);
    else return await result;
  } finally { await item.cleanup(); }
}

test("stored and deflated payloads are hashed with executable and link facts",
  async () => {
    const entries = baseEntries().map(entry =>
      ({ ...entry, compressed: true }));
    entries.push({ name: "Blooket API.app/Contents/Resources/node-link",
      data: Buffer.from("runtime/node"), mode: 0o120777, compressed: true });
    const result = await inspect(entries);
    const file = result!.bundle.get(entries[2]!.name)!;
    assert.equal(file.executable, 0o111);
    assert.equal(file.hash?.length, 64);
    assert.equal(result!.bundle.get(entries[3]!.name)?.target, "runtime/node");
  });

test("different redundant names, sizes and CRCs cannot reach native extraction",
  async () => {
    const entries = baseEntries();
    await inspect([{ ...entries[0]!, localName: "Blooket API.app/../outside" },
      ...entries.slice(1)], /archive-layout/u);
    for (const offset of [14, 18, 22]) {
      const item = await fixture();
      try {
        const changed = Buffer.from(item.bytes);
        changed.writeUInt32LE(changed.readUInt32LE(offset) + 1, offset);
        await writeFile(item.options.archivePath, changed);
        await assert.rejects(inspectUpdateArchive(item.options.archivePath,
          new AbortController().signal), /archive-layout/u);
      } finally { await item.cleanup(); }
    }
    await inspect([{ ...entries[0]!, checksum: 1 }, ...entries.slice(1)],
      /archive-bytes/u);
  });

test("special files, permission hazards and escaping links fail before writes",
  async () => {
    for (const mode of [0o010644, 0o020644, 0o060644, 0o104755])
      await inspect([{ ...baseEntries()[0]!, mode }, ...baseEntries().slice(1)],
        /archive-layout/u);
    await inspect([...baseEntries(), {
      name: "Blooket API.app/Contents/escape", mode: 0o120777,
      data: Buffer.from("../../outside") }], /archive-layout/u);
    await inspect([...baseEntries(), { name: baseEntries()[0]!.name,
      data: Buffer.from("duplicate") }], /archive-layout/u);
  });

test("alternate Unicode path headers are rejected even with matching raw names",
  async () => {
    const extra = Buffer.alloc(4);
    extra.writeUInt16LE(0x7075, 0);
    await inspect([{ ...baseEntries()[0]!, localExtra: extra },
      ...baseEntries().slice(1)], /archive-layout/u);
  });

test("AppleDouble metadata is bounded and checked before native interpretation",
  async () => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(0x00051607, 0);
    data.writeUInt32BE(0x00020000, 4);
    const sidecar = { name: "__MACOSX/" +
      "Blooket API.app/Contents/._Info.plist", data };
    assert.ok((await inspect([...baseEntries(), sidecar]))!.metadata
      .has(sidecar.name));
    await inspect([...baseEntries(), { ...sidecar, data: Buffer.alloc(26) }],
      /archive-layout/u);
    await inspect([...baseEntries(), { ...sidecar, name: sidecar.name + "x" }],
      /archive-layout/u);
  });

test("truncated archives and already cancelled reads do not yield a layout",
  async () => {
    const item = await fixture();
    try {
      await writeFile(item.options.archivePath, item.bytes.subarray(0, 40));
      await assert.rejects(inspectUpdateArchive(item.options.archivePath,
        new AbortController().signal));
      await assert.rejects(inspectUpdateArchive(item.options.archivePath,
        AbortSignal.abort()));
    } finally { await item.cleanup(); }
  });
