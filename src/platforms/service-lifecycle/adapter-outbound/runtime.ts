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
//   - Validated local instance discovery for explicit launch and stop.
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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  object,
  exact,
} from "../../../media/library-metadata/domain/metadata.ts";

export interface LocalServiceRuntime {
  readonly version: 1;
  readonly pid: number;
  readonly instance: string;
  readonly origin: string;
}
export function decodeServiceRuntime(value: unknown): LocalServiceRuntime {
  const record = object(value);
  exact(record, ["version", "pid", "instance", "origin"]);
  if (
    record["version"] !== 1 ||
    typeof record["pid"] !== "number" ||
    !Number.isSafeInteger(record["pid"]) ||
    record["pid"] < 1 ||
    typeof record["instance"] !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(
      record["instance"],
    ) ||
    typeof record["origin"] !== "string"
  )
    throw new Error("invalid-service-runtime");
  const url = new URL(record["origin"]);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "127.0.0.2", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin !== record["origin"]
  )
    throw new Error("invalid-service-runtime");
  return record as unknown as LocalServiceRuntime;
}
export async function existingService(root: string) {
  try {
    const bytes = await readFile(join(root, "service-runtime.json"));
    if (bytes.length > 4096) return undefined;
    const expected = decodeServiceRuntime(JSON.parse(bytes.toString("utf8")));
    const response = await fetch(expected.origin + "/api/service-status", {
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    if (!response.ok) return undefined;
    const body = await response.text();
    if (body.length > 4096) return undefined;
    const current = decodeServiceRuntime(JSON.parse(body));
    return JSON.stringify(current) === JSON.stringify(expected)
      ? expected
      : undefined;
  } catch {
    return undefined;
  }
}
