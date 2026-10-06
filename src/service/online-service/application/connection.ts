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
//   - Composition of the configured private gateway and tunnel.
// - Must-Not:
//   - Provision Cloudflare accounts or expose the general HTTP API.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Composition of the configured private gateway and tunnel.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import type { OnlineConnectionController } from
  "../../../api/online-connection/contract/controller.ts";
import { startMcpGateway } from
  "../../../mcp/streamable-gateway/adapter-inbound/gateway.ts";
import { startCloudflareTunnel } from
  "../../../platforms/cloudflare-tunnel/adapter-outbound/process.ts";
import { createHostSecretStore } from
  "../../../platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import { loadPreferences } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import { OWNER_VERIFIER_SECRET } from
  "../../../security/owner-password/domain/verifier.ts";
import { createOwnerApprovalGuard } from
  "../../../api/teacher-configuration/application/owner-approval.ts";

export function createOnlineConnection(
  root: string,
  secrets: HostSecretStore = createHostSecretStore(),
  dependencies: {
    startGateway?: typeof startMcpGateway;
    startTunnel?: typeof startCloudflareTunnel;
    now?: () => number;
  } = {},
): OnlineConnectionController {
  let gateway: Awaited<ReturnType<typeof startMcpGateway>> | undefined;
  let tunnel: ReturnType<typeof startCloudflareTunnel> | undefined;
  let state = "disabled",
    gatewayPort = 2608;
  let serial: Promise<void> = Promise.resolve();
  let stopped = false;
  let runningLocalPort: number | undefined;
  const verifyApproval = createOwnerApprovalGuard(secrets, dependencies.now);
  async function stopCurrent(): Promise<void> {
    await tunnel?.stop();
    tunnel = undefined;
    gateway?.revokeAll();
    if (gateway)
      await new Promise<void>((resolve) => {
        gateway!.server.close(() => resolve());
        gateway!.server.closeAllConnections();
      });
    gateway = undefined;
    state = "disabled";
  }
  return {
    status: () => ({
      state,
      gatewayPort,
      productVerification: "recipient-mac-and-chatgpt-pending",
    }),
    pending: () => gateway?.pending() ?? [],
    connections: () => gateway?.connections() ?? [],
    approve: async (id, password) => {
      if (!gateway) throw new Error("online-disabled");
      const approving = gateway;
      await verifyApproval(password);
      if (gateway !== approving) throw new Error("authorization-expired");
      approving.approve(id);
    },
    reject: (id) => gateway?.reject(id),
    revoke: (id) => gateway?.revoke(id),
    stop: async () => {
      stopped = true;
      serial = serial.then(stopCurrent, stopCurrent);
      await serial;
    },
    reload: async (localPort) => {
      if (stopped) return;
      if (localPort !== undefined) runningLocalPort = localPort;
      const run = async () => {
        await stopCurrent();
        const preferences = await loadPreferences(root);
        if (!preferences.online.enabled) return;
        const owner = await secrets.read(OWNER_VERIFIER_SECRET);
        if (!owner.ok || owner.kind !== "found") {
          state = "owner-password-missing";
          return;
        }
        const token = await secrets.read("cloudflare-tunnel");
        if (!token.ok || token.kind !== "found") {
          state = "tunnel-token-missing";
          return;
        }
        gatewayPort = (runningLocalPort ?? preferences.service.port) + 1;
        if (gatewayPort > 65535) {
          state = "gateway-port-unavailable";
          return;
        }
        try {
          gateway = await (dependencies.startGateway ?? startMcpGateway)({
            publicUrl: preferences.online.publicUrl,
            dataRoot: root,
            port: gatewayPort,
          });
        } catch {
          state = "gateway-start-failed";
          return;
        }
        tunnel = (dependencies.startTunnel ?? startCloudflareTunnel)(
          token.secret,
          (next) => {
            state = next;
          },
        );
      };
      serial = serial.then(run, run);
      await serial;
    },
  };
}
