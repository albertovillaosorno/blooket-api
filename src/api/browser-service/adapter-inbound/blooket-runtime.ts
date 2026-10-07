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
//   - Local composition of Blooket browser/read/write/media application ports.
// - Must-Not:
//   - Register publication commands, execute plans, choose persistence paths,
//     or weaken browser/media validation.
// - Allows:
//   - Inputs: Service-owned browser bridge and user-data root.
//   - Outputs: Read ports plus canonical browser write/media execution ports.
//   - Side effects: None during composition.
// - Split-When:
//   - Publication needs an independently hosted runtime lifecycle.
// - Merge-When:
//   - Browser service becomes the sole canonical Blooket composition owner.
// - Summary:
//   - Wires the verified bridge surface into canonical write execution.
// - Description:
//   - Consumers still must use persisted execution, pacing, and journaling.
// - Usage:
//   - Compose once in the local service; do not call the surface directly.
// - Defaults:
//   - No external publication command is registered here.
//
import { createBlooketBrowserBridgeAdapters } from
  "../../blooket-browser-bridge/adapter-outbound/adapters.ts";
import { blooketBrowserWriteExecutionPort } from
  "../../blooket-write-execution/application/browser-write-adapter.ts";
import type { BlooketBrowserBridgeTransport } from
  "../../../platforms/blooket-browser/contract/bridge-transport.ts";
import { createBlooketPreparedMediaReadPort } from
  "./blooket-prepared-media.ts";

export function createBlooketRuntimePorts(
  bridge: BlooketBrowserBridgeTransport,
  root: string,
) {
  const adapters = createBlooketBrowserBridgeAdapters(bridge);
  return {
    ...adapters,
    writeExecution: blooketBrowserWriteExecutionPort(adapters.writes),
    preparedMedia: createBlooketPreparedMediaReadPort(root),
  };
}
