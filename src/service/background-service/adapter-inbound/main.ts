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
//   - Background process startup and shutdown on explicit signals.
// - Must-Not:
//   - Create hidden autostart persistence or emit secrets to stdout.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Background process startup and shutdown on explicit signals.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import {
  loadPreferences,
  savePreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import { startManagedBackgroundService } from "../application/runtime.ts";
import { withCanonicalDataWriter } from
  "../../../platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from
  "../../../ir/product-version/contract/version.ts";
import { installServiceStopResponder } from
  "../../../platforms/service-lifecycle/adapter-outbound/stop.ts";
import { installServiceHealthResponder } from
  "../../../platforms/service-lifecycle/adapter-outbound/health.ts";
import { receiveInstallerServiceStartup } from
  "../../../platforms/service-lifecycle/adapter-outbound/startup.ts";

import { createHostSecretStore } from
  "../../../platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import {
  developmentConfiguration,
  readDevelopmentEnvironment,
} from
  "../../../platforms/development-environment/adapter-outbound/environment.ts";

const root = userDataRoot();
const installing = process.argv.includes("--installer-child");
const startup = installing && process.argv.slice(2).length === 1
  ? await receiveInstallerServiceStartup() : undefined;
if (installing && !startup) {
  process.stderr.write("Installer startup authorization is unavailable.\n");
  process.exit(1);
}
let secrets = createHostSecretStore();
if (process.argv.includes("--development")) {
  try {
    await withCanonicalDataWriter(root, async () => {
      const development = await developmentConfiguration(
        await loadPreferences(root),
        await readDevelopmentEnvironment(
          fileURLToPath(new URL("../../../../.env", import.meta.url)),
        ),
        secrets,
      );
      await savePreferences(root, development.preferences);
      secrets = development.secrets;
    });
  } catch {
    process.stderr.write(
      "Development configuration is invalid. " +
        "Check variable names, local port, and the HTTPS MCP URL.\n",
    );
    process.exit(1);
  }
}
try {
  const service = await startManagedBackgroundService(root, secrets,
    startup ? { startup } : {});
  process.stdout.write(service.origin + "\n");
  const runtime = {
    version: service.version,
    pid: service.pid,
    instance: service.instance,
    origin: service.origin,
  };
  const disposeHealth = installServiceHealthResponder(
    runtime, PRODUCT_VERSION, service.isReady,
  );
  service.server.once("close", disposeHealth);
  const disposeStop = installServiceStopResponder(
    runtime, PRODUCT_VERSION, service.stop,
  );
  process.send?.(runtime);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void service.stop().catch(() => { process.exitCode = 1; }).finally(() => {
        disposeStop();
        if (process.connected) process.disconnect?.();
      });
    });
} catch {
  process.stderr.write(
    "The local service could not start. Check its port " +
      "and saved configuration.\n",
  );
  process.exitCode = 1;
}
