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
//   - Ordered bounded candidate policy for automatic media optimization.
// - Must-Not:
//   - Decode media, encode files, mutate recipes, or certify byte size.
// - Allows:
//   - Inputs: Animation state and validated requested FPS/compression.
//   - Outputs: Ordered cumulative optimization candidates.
//   - Side effects: None.
// - Split-When:
//   - A format needs an independent optimization priority policy.
// - Merge-When:
//   - Rendering can own candidate ordering without duplicating policy.
// - Summary:
//   - Makes detail, FPS, then compression fallback order deterministic.
// - Description:
//   - Candidates preserve final canvas geometry while reducing work detail.
// - Usage:
//   - Iterate in order and accept only an actually encoded valid candidate.
// - Defaults:
//   - At most twelve candidates are emitted.
//
import { GIF_FRAME_RATES } from "../../gif-timeline/domain/timeline.ts";

export type OptimizationStage =
  | "requested"
  | "detail"
  | "fps"
  | "compression";

export interface RenditionOptimizationCandidate {
  readonly stage: OptimizationStage;
  readonly detailScale: number;
  readonly gifFps: number | null;
  readonly compression: "lossless" | "compact";
}

const DETAIL_SCALES = [1, 0.85, 0.7, 0.55, 0.4] as const;

export function decodeRenditionOptimizationCandidate(
  value: unknown,
): RenditionOptimizationCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid-rendition-optimization-candidate");
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.join(",") !==
      ["compression", "detailScale", "gifFps", "stage"].sort().join(",") ||
    !["requested", "detail", "fps", "compression"].includes(
      String(candidate["stage"]),
    ) ||
    !DETAIL_SCALES.some((scale) => scale === candidate["detailScale"]) ||
    !(
      candidate["gifFps"] === null ||
      GIF_FRAME_RATES.some((fps) => fps === candidate["gifFps"])
    ) ||
    !["lossless", "compact"].includes(String(candidate["compression"]))
  )
    throw new Error("invalid-rendition-optimization-candidate");
  return candidate as unknown as RenditionOptimizationCandidate;
}

export function renditionOptimizationCandidates(input: {
  readonly animated: boolean;
  readonly gifFps: number;
  readonly compression: "lossless" | "compact";
}): readonly RenditionOptimizationCandidate[] {
  if (
    !GIF_FRAME_RATES.some((fps) => fps === input.gifFps) ||
    !["lossless", "compact"].includes(input.compression)
  )
    return [];

  const requestedFps = input.animated ? input.gifFps : null;
  const candidates: RenditionOptimizationCandidate[] = [
    {
      stage: "requested",
      detailScale: DETAIL_SCALES[0],
      gifFps: requestedFps,
      compression: input.compression,
    },
  ];

  for (const detailScale of DETAIL_SCALES.slice(1)) {
    candidates.push({
      stage: "detail",
      detailScale,
      gifFps: requestedFps,
      compression: input.compression,
    });
  }

  if (input.animated) {
    for (
      const gifFps of [...GIF_FRAME_RATES]
        .filter((fps) => fps < input.gifFps)
        .sort((left, right) => right - left)
    ) {
      candidates.push({
        stage: "fps",
        detailScale: DETAIL_SCALES.at(-1)!,
        gifFps,
        compression: input.compression,
      });
    }
  }

  if (input.compression === "lossless") {
    candidates.push({
      stage: "compression",
      detailScale: DETAIL_SCALES.at(-1)!,
      gifFps: input.animated
        ? candidates.at(-1)!.gifFps
        : null,
      compression: "compact",
    });
  }

  return candidates;
}
