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
//   - Local transport shape between application adapters and WebExtension jobs.
// - Must-Not:
//   - Expose pairing tokens, persist commands, or interpret provider payloads.
// - Allows:
//   - Inputs: Typed bridge commands.
//   - Outputs: Unknown successful values or stable browser failures.
//   - Side effects: Defined by the concrete local bridge transport.
// - Split-When:
//   - Browser writes require a transport with different delivery guarantees.
// - Merge-When:
//   - The browser adapter becomes in-process.
// - Summary:
//   - Separates Blooket port adaptation from extension job delivery.
// - Description:
//   - Successful values remain untrusted until their owning decoder accepts
//     them.
// - Usage:
//   - Implement with the bounded local broker used by the browser extension.
// - Defaults:
//   - Transport failures reveal no extension, page, or exception details.
//
import type { BlooketBrowserBridgeCommand } from
  "../../../ir/blooket-browser-bridge/contract/message.ts";

export type BlooketBrowserBridgeTransportResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

export interface BlooketBrowserBridgeTransport {
  request(
    command: BlooketBrowserBridgeCommand,
  ): Promise<BlooketBrowserBridgeTransportResult>;
}
