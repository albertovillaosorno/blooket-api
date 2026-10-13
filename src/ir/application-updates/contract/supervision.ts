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
//   - Exact private launcher/supervisor and managed drainage notices.
// - Must-Not:
//   - Grant installation authority or authenticate an arbitrary process.
// - Allows:
//   - Inputs: Unknown private IPC envelopes.
//   - Outputs: Captured primitives and still-untrusted runtime payloads.
//   - Side effects: None.
// - Split-When:
//   - Supervision requires another protocol version.
// - Merge-When:
//   - All private lifecycle envelopes share identical contracts.
// - Summary:
//   - Keeps private lifecycle notices separate from installation evidence.
// - Description:
//   - The receiver verifies its actual child and separately decodes runtime.
// - Usage:
//   - Use only on the process's existing owned child IPC connection.
// - Defaults:
//   - Unknown, inherited, accessor and extra fields are refused.
//
import { exactOwnData } from "../../runtime-decoding/domain/exact-object.ts";

export function decodeServiceSupervisorReady(value: unknown): {
  readonly pid: number; readonly runtime: unknown;
} | undefined {
  const fields = exactOwnData(value, ["kind", "version", "pid", "runtime"]);
  if (!fields || fields["kind"] !== "service-supervisor-ready" ||
      fields["version"] !== 1 || typeof fields["pid"] !== "number" ||
      !Number.isSafeInteger(fields["pid"]) || fields["pid"] < 1)
    return undefined;
  return { pid: fields["pid"], runtime: fields["runtime"] };
}

export function decodeServiceDrainNotice(value: unknown): {
  readonly pid: number; readonly instance: string;
  readonly status: "drained" | "unavailable";
} | undefined {
  const fields = exactOwnData(value,
    ["kind", "version", "pid", "instance", "status"]);
  if (!fields || fields["kind"] !== "service-drain-complete" ||
      fields["version"] !== 1 || typeof fields["pid"] !== "number" ||
      !Number.isSafeInteger(fields["pid"]) || fields["pid"] < 1 ||
      typeof fields["instance"] !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
        .test(fields["instance"]) ||
      (fields["status"] !== "drained" && fields["status"] !== "unavailable"))
    return undefined;
  return { pid: fields["pid"], instance: fields["instance"],
    status: fields["status"] };
}
