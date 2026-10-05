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
//   - Advisory TCP bind probes and automatic loopback port allocation.
// - Must-Not:
//   - Persist settings, expose non-loopback listeners, or start the API server.
// - Allows:
//   - Inputs: Validated loopback addresses and TCP ports.
//   - Outputs: Port availability facts and an OS-selected available port.
//   - Side effects: Short-lived local TCP listeners closed before return.
// - Split-When:
//   - Server socket reservation and advisory probing need separate lifecycles.
// - Merge-When:
//   - The API server itself becomes the only owner of port selection.
// - Summary:
//   - Detects configured-port collisions without inventing network policy.
// - Description:
//   - Uses the host TCP stack so Linux and macOS observe real bind conflicts.
// - Usage:
//   - Probe fixed ports before startup and request port zero for automatic
//     mode.
// - Defaults:
//   - Probe results are advisory; the final server bind remains authoritative.
//
import { createServer } from "node:net";

import type { LocalServiceSettings } from
  "../../../settings/local-service/domain/local-service-settings.ts";

export type PortProbeResult =
  | { readonly kind: "available" }
  | { readonly kind: "in-use" }
  | { readonly kind: "unavailable"; readonly code: string };

export type ConfiguredPortResolution =
  | {
      readonly ok: true;
      readonly settings: LocalServiceSettings;
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | "configured-port-in-use"
        | "configured-port-unavailable"
        | "port-allocation-failed";
    };

export async function resolveConfiguredTcpPort(
  settings: LocalServiceSettings,
): Promise<ConfiguredPortResolution> {
  const probe = await probeTcpPort(settings.bindAddress, settings.port);
  if (probe.kind === "available") {
    return { ok: true, settings, changed: false };
  }

  if (settings.portMode === "fixed") {
    return {
      ok: false,
      code: probe.kind === "in-use"
        ? "configured-port-in-use"
        : "configured-port-unavailable",
    };
  }

  try {
    const port = await chooseAutomaticTcpPort(settings.bindAddress);
    return {
      ok: true,
      settings: { ...settings, port },
      changed: port !== settings.port,
    };
  } catch {
    return { ok: false, code: "port-allocation-failed" };
  }
}

export async function probeTcpPort(
  bindAddress: string,
  port: number,
): Promise<PortProbeResult> {
  const result = await tryListen(bindAddress, port);
  if (result.kind === "listening") {
    await closeServer(result.server);
    return { kind: "available" };
  }

  if (result.code === "EADDRINUSE") {
    return { kind: "in-use" };
  }
  return { kind: "unavailable", code: result.code };
}

export async function chooseAutomaticTcpPort(
  bindAddress: string,
): Promise<number> {
  const result = await tryListen(bindAddress, 0);
  if (result.kind !== "listening") {
    throw new Error(`Unable to allocate local TCP port: ${result.code}`);
  }

  try {
    const address = result.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Unable to read allocated local TCP port.");
    }
    return address.port;
  } finally {
    await closeServer(result.server);
  }
}

type ListeningResult = {
  readonly kind: "listening";
  readonly server: ReturnType<typeof createServer>;
};

type ListenFailure = {
  readonly kind: "failed";
  readonly code: string;
};

function tryListen(
  bindAddress: string,
  port: number,
): Promise<ListeningResult | ListenFailure> {
  return new Promise((resolve) => {
    const server = createServer();
    const onError = (error: Error & { code?: string }): void => {
      server.removeListener("listening", onListening);
      resolve({ kind: "failed", code: error.code ?? "UNKNOWN" });
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve({ kind: "listening", server });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: bindAddress, port, exclusive: true });
  });
}

function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
