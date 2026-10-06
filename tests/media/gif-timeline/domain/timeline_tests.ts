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
//   - Bounded fixed-rate sampling of a GIF source timeline.
// - Must-Not:
//   - Decode images, persist files, or silently preserve source delays.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Bounded fixed-rate sampling of a GIF source timeline.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { resampleGifTimeline } from
  "../../../../src/media/gif-timeline/domain/timeline.ts";

test("variable-delay GIF sampling defines a constant 10 FPS timeline", () => {
  assert.deepEqual(resampleGifTimeline([80, 140]), {
    pages: [0, 1],
    delayMs: 100,
  });
  assert.deepEqual(resampleGifTimeline([200, 100]), {
    pages: [0, 0, 1],
    delayMs: 100,
  });
  assert.deepEqual(resampleGifTimeline([10]), { pages: [0], delayMs: 100 });
  assert.deepEqual(resampleGifTimeline([100, 100], 20), {
    pages: [0, 0, 1, 1],
    delayMs: 50,
  });
});
test(
  "invalid rates, delays, duration and expanded " + "timelines fail closed",
  () => {
    for (const rate of [0, 3, 30, 60, Number.NaN])
      assert.equal(resampleGifTimeline([100], rate), undefined);
    for (const delays of [[], [0], [-1], [Infinity], [60_001]])
      assert.equal(resampleGifTimeline(delays), undefined);
    assert.equal(resampleGifTimeline([1000], 50, 20), undefined);
  },
);
