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
import {
  acquireCanonicalDataWriter, acquireCanonicalInstallerServiceWriter,
} from "../../../platforms/user-storage/adapter-outbound/writer-boundary.ts";
import type { UpdateStartupRequest } from
  "../../../ir/application-updates/contract/startup.ts";

export async function startManagedBackgroundService(
  root: string,
  secrets: HostSecretStore,
  dependencies: { online?: OnlineConnectionController;
    startup?: UpdateStartupRequest;
    onStopped?: (status: "drained" | "unavailable", instance: string) => void;
  } = {},
) {
  // Startup, discovery and managed online writers belong to this lifetime.
  // A dead service cannot silently relinquish an uncertain descendant's lease.
  // The installer must drain the old service before acquiring data exclusion;
  // candidate startup under that exclusion requires private parent authority.
  const writer = dependencies.startup
    ? await acquireCanonicalInstallerServiceWriter(root, dependencies.startup)
    : await acquireCanonicalDataWriter(root);
  if (!writer.ok) throw new Error(writer.reason === "busy"
    ? "service-update-busy" : "service-storage-unavailable");
  let lock: Awaited<ReturnType<typeof tryAcquireFileLock>>;
  try { lock = await tryAcquireFileLock(join(root, ".service.lock")); }
  catch (error) { await writer.release(); throw error; }
  if (!lock.ok) {
    await writer.release();
    throw new Error("service-" + lock.reason);
  }
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
      const draining = service
        ? cleanup(() => service!.quiesce()) : Promise.resolve();
      await cleanup(() => online.stop());
      await draining;
      await cleanup(() =>
        removeDurableFile(join(root, "service-runtime.json")),
      );
      await cleanup(() => lock.lock.release());
      // A failed shutdown may leave a native writer unobserved. Keep the data
      // lease in that case; only proven complete cleanup releases admission.
      if (!failure) await cleanup(() => writer.release());
      // An IPC notice cannot substitute for private challenge/close evidence.
      // Notification failure must not turn completed persistence into failure.
      try { dependencies.onStopped?.(failure ? "unavailable" : "drained",
        instance); } catch { /* The owner can still request private stop. */ }
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
    return { ...runtime, stop, server: service.server,
      isReady: () => stopping === undefined && service!.server.listening };
  } catch (error) {
    await stop();
    throw error;
  }
}
