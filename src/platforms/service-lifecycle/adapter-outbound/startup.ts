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
//   - Bounded private parent-to-child installer startup receipt.
// - Must-Not:
//   - Accept public startup authority or expose confidential ownership tokens.
// - Allows:
//   - Inputs: The process's existing private parent IPC channel.
//   - Outputs: An exact captured request or refusal.
//   - Side effects: Bounded IPC observation only.
// - Split-When:
//   - Another startup transport requires separate authority.
// - Merge-When:
//   - Private lifecycle admission is owned by a single protocol adapter.
// - Summary:
//   - Receives startup admission without consulting arguments or environment.
// - Description:
//   - The data adapter independently authenticates held installation ownership.
// - Usage:
//   - Call before any installer child loads or saves teacher data.
// - Defaults:
//   - Missing IPC, disconnect, malformed messages and deadlines refuse startup.
//
import { decodeUpdateStartupRequest, type UpdateStartupRequest } from
  "../../../ir/application-updates/contract/startup.ts";

export function receiveInstallerServiceStartup(timeoutMs = 10_000):
  Promise<UpdateStartupRequest | undefined> {
  if (!process.connected || typeof process.send !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    return Promise.resolve(undefined);
  return new Promise(resolve => {
    const finish = (request?: UpdateStartupRequest) => {
      clearTimeout(timer);
      process.removeListener("message", receive);
      process.removeListener("disconnect", disconnected);
      resolve(request);
    };
    const receive = (value: unknown) => {
      const request = decodeUpdateStartupRequest(value);
      finish(request?.ownerPid === process.ppid &&
        request.childPid === process.pid ? request : undefined);
    };
    const disconnected = () => finish();
    const timer = setTimeout(disconnected, timeoutMs);
    process.once("message", receive);
    process.once("disconnect", disconnected);
    try {
      process.send?.({ kind: "update-startup-ready", version: 1,
        pid: process.pid }, error => { if (error) finish(); });
    } catch { finish(); }
  });
}
