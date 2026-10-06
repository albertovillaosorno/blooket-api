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
export const GIF_FRAME_RATES = [1, 2, 5, 10, 20, 25, 50] as const;

export function resampleGifTimeline(
  delays: readonly number[],
  fps = 10,
  maximumFrames = 600,
): { readonly pages: readonly number[]; readonly delayMs: number } | undefined {
  if (
    !GIF_FRAME_RATES.some((rate) => rate === fps) ||
    delays.length === 0 ||
    delays.length > maximumFrames ||
    !delays.every((delay) => Number.isFinite(delay) && delay > 0) ||
    !Number.isSafeInteger(maximumFrames) ||
    maximumFrames < 1
  ) {
    return undefined;
  }
  const duration = delays.reduce((sum, delay) => sum + delay, 0);
  const delayMs = 1000 / fps;
  const count = Math.max(1, Math.round(duration / delayMs));
  if (duration > 60_000 || count > maximumFrames) return undefined;
  let page = 0;
  let boundary = delays[0]!;
  const pages: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    while (frame * delayMs >= boundary && page < delays.length - 1) {
      page += 1;
      boundary += delays[page]!;
    }
    pages.push(page);
  }
  return { pages, delayMs };
}
