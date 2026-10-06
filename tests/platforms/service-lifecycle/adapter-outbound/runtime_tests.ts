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
//   - Synthetic instance discovery and origin rejection regression tests.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  decodeServiceRuntime,
  existingService,
} from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";
test("runtime discovery rejects public URLs and mismatched instances",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "service-discovery-"));
  const server = createServer((_request, response) => {
    response.end(
      JSON.stringify({
        ...record,
        instance: "11111111-1111-1111-1111-111111111111",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const record = {
    version: 1,
    pid: process.pid,
    instance: "00000000-0000-0000-0000-000000000000",
    origin: "http://127.0.0.1:" + address.port,
  };
  try {
    assert.deepEqual(decodeServiceRuntime(record), record);
    for (const origin of [
      "https://example.com",
      "http://localhost:2607",
      "http://127.0.0.1:2607/path",
      "http://user@127.0.0.1:2607",
      "http://127.0.0.1:2607?query",
    ])
      assert.throws(() => decodeServiceRuntime({ ...record, origin }));
    await writeFile(join(root, "service-runtime.json"), JSON.stringify(record));
    assert.equal(await existingService(root), undefined);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});
