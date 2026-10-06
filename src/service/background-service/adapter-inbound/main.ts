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
import { startBrowserService } from
  "../../../api/browser-service/adapter-inbound/server.ts";
import {
  loadPreferences,
  savePreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import { createOnlineConnection } from
  "../../online-service/application/connection.ts";
import { fileURLToPath } from "node:url";

import { createHostSecretStore } from
  "../../../platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import {
  developmentConfiguration,
  readDevelopmentEnvironment,
} from
  "../../../platforms/development-environment/adapter-outbound/environment.ts";

const root = userDataRoot();
let secrets = createHostSecretStore();
if (process.argv.includes("--development")) {
  try {
    const development = developmentConfiguration(
      await loadPreferences(root),
      await readDevelopmentEnvironment(
        fileURLToPath(new URL("../../../../.env", import.meta.url)),
      ),
      secrets,
    );
    await savePreferences(root, development.preferences);
    secrets = development.secrets;
  } catch {
    process.stderr.write(
      "Development configuration is invalid. " +
        "Check variable names, local port, and the HTTPS MCP URL.\n",
    );
    process.exit(1);
  }
}
const online = createOnlineConnection(root, secrets);
try {
  const service = await startBrowserService({ root, online, secrets });
  await online.reload();
  process.stdout.write(service.origin + "\n");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void online.stop().finally(() => {
        service.server.close();
        service.server.closeAllConnections();
      });
    });
} catch {
  await online.stop();
  process.stderr.write(
    "The local service could not start. Check its port " +
      "and saved configuration.\n",
  );
  process.exitCode = 1;
}
