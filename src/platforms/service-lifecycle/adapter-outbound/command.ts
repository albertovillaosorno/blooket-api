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
//   - Bounded local-service transport for canonical Blooket read commands.
// - Must-Not:
//   - Expose credentials, infer provider fields, or admit publication.
// - Allows:
//   - Inputs: Validated command inputs and explicit local ports.
//   - Outputs: Canonical read results or stable failures.
//   - Side effects: Only explicitly delegated local operations.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Bounded local-service transport for canonical Blooket read commands.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import { decodeResultEnvelope } from
  "../../../ir/wire-envelopes/contract/result-envelope.ts";
import { existingService } from "./runtime.ts";
import {
  isBlooketReadCommand,
  decodeBlooketReadCommand,
} from "../../../ir/blooket-read-commands/contract/commands.ts";

// The CLI uses local CSRF admission; no browser token enters its arguments,
// environment, stdin envelope, or result. Redirects are never followed.
export async function executeLocalBlooketRead(
  command: CommandEnvelope,
  root: string,
) {
  const failure = (code: string) => ({
    version: 1 as const,
    operationId: command.operationId,
    ok: false as const,
    issues: [
      {
        path: "$.blooket",
        code,
        message: "Open the local workspace and check its Blooket connection.",
      },
    ],
  });
  if (!isBlooketReadCommand(command.command)) return failure("unknown-command");
  const decoded = decodeBlooketReadCommand(command.command, command.payload);
  if (!decoded.ok)
    return {
      version: 1 as const,
      operationId: command.operationId,
      ok: false as const,
      issues: decoded.issues,
    };
  try {
    const runtime = await existingService(root);
    if (!runtime) return failure("blooket-browser-unavailable");
    const signal = AbortSignal.timeout(25_000);
    const bootResponse = await fetch(runtime.origin + "/api/bootstrap", {
      redirect: "error",
      signal,
    });
    if (!bootResponse.ok) return failure("blooket-browser-unavailable");
    const boot: unknown = JSON.parse(await boundedText(bootResponse));
    if (
      typeof boot !== "object" ||
      boot === null ||
      !("csrf" in boot) ||
      typeof boot.csrf !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(boot.csrf)
    )
      return failure("invalid-service-response");
    const response = await fetch(runtime.origin + "/api/command", {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Origin: runtime.origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": boot.csrf,
      },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return failure(
        response.status === 429
          ? "service-busy"
          : "blooket-browser-unavailable",
      );
    const result = decodeResultEnvelope(
      JSON.parse(await boundedText(response)),
    );
    if (!result.ok || result.value.operationId !== command.operationId)
      return failure("invalid-service-response");
    return result.value;
  } catch {
    return failure("blooket-browser-unavailable");
  }
}

async function boundedText(response: Response) {
  if (!response.body) throw new Error("empty-service-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_500_000) throw new Error("service-response-too-large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
