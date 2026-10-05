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
//   - Host TCP tests for collision probing and automatic port allocation.
// - Must-Not:
//   - Start the product API or persist settings.
// - Allows:
//   - Inputs: Short-lived loopback TCP listeners.
//   - Outputs: Deterministic availability and allocation verdicts.
//   - Side effects: Temporary local TCP listeners closed after each test.
// - Split-When:
//   - Platform-specific socket behavior needs independent fixture suites.
// - Merge-When:
//   - Port probing moves entirely into the API listener.
// - Summary:
//   - Verifies real loopback collision detection on the current host.
// - Description:
//   - Mirrors src/platforms/tcp-ports/adapter-outbound/tcp-port.ts.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Tests never listen on non-loopback addresses.
//
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import test from "node:test";

import {
  chooseAutomaticTcpPort,
  probeTcpPort,
  resolveConfiguredTcpPort,
} from "../../../../src/platforms/tcp-ports/adapter-outbound/tcp-port.ts";

const LOOPBACK = "127.0.0.1";

test("port probe reports an occupied loopback port", async () => {
  const server = await listenOnAutomaticPort();
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    if (address === null || typeof address === "string") {
      return;
    }

    assert.deepEqual(await probeTcpPort(LOOPBACK, address.port), {
      kind: "in-use",
    });
  } finally {
    await close(server);
  }
});

test("automatic allocation asks the OS for a concrete port", async () => {
  const port = await chooseAutomaticTcpPort(LOOPBACK);

  assert.equal(Number.isSafeInteger(port), true);
  assert.equal(port >= 1 && port <= 65535, true);
  assert.deepEqual(await probeTcpPort(LOOPBACK, port), {
    kind: "available",
  });
});

function listenOnAutomaticPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function close(server: Server): Promise<void> {
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


test("fixed mode reports an occupied configured port", async () => {
  const server = await listenOnAutomaticPort();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not expose a TCP address");
    }
    const result = await resolveConfiguredTcpPort({
      schemaVersion: 2,
      bindAddress: LOOPBACK,
      port: address.port,
      portMode: "fixed",
      launchAtLogin: false,
      startMinimized: false,
      startServiceOnLaunch: true,
      theme: "system",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "configured-port-in-use",
    });
  } finally {
    await close(server);
  }
});

test("automatic mode selects a new concrete port after collision", async () => {
  const server = await listenOnAutomaticPort();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not expose a TCP address");
    }
    const result = await resolveConfiguredTcpPort({
      schemaVersion: 2,
      bindAddress: LOOPBACK,
      port: address.port,
      portMode: "automatic",
      launchAtLogin: false,
      startMinimized: false,
      startServiceOnLaunch: true,
      theme: "system",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.changed, true);
      assert.notEqual(result.settings.port, address.port);
      assert.deepEqual(await probeTcpPort(LOOPBACK, result.settings.port), {
        kind: "available",
      });
    }
  } finally {
    await close(server);
  }
});
