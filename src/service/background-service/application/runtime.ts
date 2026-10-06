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
//   - Managed service startup, shutdown, discovery, and writer ownership.
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
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startBrowserService } from
  "../../../api/browser-service/adapter-inbound/server.ts";
import { createOnlineConnection } from
  "../../online-service/application/connection.ts";
import {
  writeAtomicFile,
  removeDurableFile,
} from "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import type { OnlineConnectionController } from
  "../../../api/online-connection/contract/controller.ts";

export async function startManagedBackgroundService(
  root: string,
  secrets: HostSecretStore,
  dependencies: { online?: OnlineConnectionController } = {},
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await tryAcquireFileLock(join(root, ".service.lock"));
  if (!lock.ok) throw new Error("service-" + lock.reason);
  const online = dependencies.online ?? createOnlineConnection(root, secrets);
  const instance = randomUUID();
  let service: Awaited<ReturnType<typeof startBrowserService>> | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      let failure: unknown;
      const cleanup = async (task: () => Promise<void>) => {
        try {
          await task();
        } catch (error) {
          failure ??= error;
        }
      };
      await cleanup(() => online.stop());
      if (service) {
        await cleanup(
          () =>
            new Promise<void>((resolve, reject) => {
              service!.server.close((error) =>
                error ? reject(error) : resolve(),
              );
              service!.server.closeAllConnections();
            }),
        );
      }
      await cleanup(() =>
        removeDurableFile(join(root, "service-runtime.json")),
      );
      await cleanup(() => lock.lock.release());
      if (failure) throw failure;
    })());
  try {
    service = await startBrowserService({
      root,
      secrets,
      online,
      instance,
      stop,
    });
    await online.reload(service.port);
    const runtime = {
      version: 1 as const,
      pid: process.pid,
      instance,
      origin: service.origin,
    };
    await writeAtomicFile(
      join(root, "service-runtime.json"),
      JSON.stringify(runtime) + "\n",
    );
    return { ...runtime, stop, server: service.server };
  } catch (error) {
    await stop();
    throw error;
  }
}
