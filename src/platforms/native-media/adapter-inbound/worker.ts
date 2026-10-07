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
//   - One validated native job inside a disposable process.
// - Must-Not:
//   - Pass credentials, user paths, or raw native errors to the worker.
// - Allows:
//   - Inputs: Admitted image bytes and recipes from the application boundary.
//   - Outputs: Validated image facts or bounded prepared bytes.
//   - Side effects: Starts one temporary child with a deadline and minimal
//     environment.
// - Split-When:
//   - Host resource admission needs an independent platform boundary.
// - Merge-When:
//   - Native processing no longer needs process isolation.
// - Summary:
//   - Kills stalled native work without blocking independent service requests.
// - Description:
//   - Sends bounded values over IPC instead of shell arguments or log output.
// - Usage:
//   - Call only from trusted application composition, never with model paths.
// - Defaults:
//   - The parent owns the deadline; this worker exits after one result.
//
import { decodeSourceImage } from
  "../../../media/image-decoding/adapter-outbound/sharp-image.ts";
import {
  renderEditedImageRendition,
  renderOptimizedImageRendition,
} from "../../../media/image-renditions/adapter-outbound/edit.ts";
import {
  decodeEditRecipe,
  object,
  exact,
} from "../../../media/library-metadata/domain/metadata.ts";
import { loadSharp } from
  "../../../media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

import type { MediaEditorState } from
  "../../../media/editor-state/domain/editor-state.ts";
import type {
  RenditionCanvas,
  RenditionLimits,
} from "../../../media/image-renditions/adapter-outbound/sharp-rendition.ts";
import type { EditorRenditionOptions } from
  "../../../media/image-renditions/adapter-outbound/edit.ts";

async function work(input: unknown) {
  const request = object(input);
  const kind = request["kind"];
  exact(request, [
    "version",
    "kind",
    "bytes",
    ...(kind === "decode"
      ? ["maxInputPixels"]
      : kind === "editor"
        ? ["state", "canvas", "limits", "options"]
        : kind === "compact" || kind === "sample-colors"
          ? []
          : ["recipe"]),
  ]);
  const bytes = request["bytes"];
  if (
    request["version"] !== 1 ||
    !(bytes instanceof Uint8Array) ||
    bytes.length < 1 ||
    bytes.length > 25_000_000 ||
    (
      kind !== "decode"
      && kind !== "render"
      && kind !== "editor"
      && kind !== "compact"
      && kind !== "sample-colors"
    )
  )
    throw new Error("invalid-native-job");
  const sharp = await loadSharp();
  sharp.concurrency(1);
  sharp.cache(false);
  if (kind === "decode") {
    const limit = request["maxInputPixels"];
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 80_000_000
    )
      throw new Error("invalid-native-job");
    return await decodeSourceImage(bytes, limit);
  }
  if (kind === "sample-colors") {
    const decoded = await decodeSourceImage(bytes, 80_000_000);
    if (!decoded.ok) throw new Error(decoded.code);
    const count = Math.min(5, decoded.value.frameCount);
    const pages = Array.from({ length: count }, (_, index) =>
      Math.min(
        decoded.value.frameCount - 1,
        Math.floor(((index + 0.5) * decoded.value.frameCount) / count),
      ),
    );
    const frameBytes = 8 * 8 * 4;
    const rgba = new Uint8Array(frameBytes * pages.length);
    for (let index = 0; index < pages.length; index++) {
      const sample = await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 80_000_000,
        page: pages[index]!,
        pages: 1,
      })
        .resize({ width: 8, height: 8, fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer();
      if (sample.byteLength !== frameBytes)
        throw new Error("invalid-native-samples");
      rgba.set(sample, index * frameBytes);
    }
    return { ok: true as const, value: { rgba } };
  }
  if (kind === "compact") {
    const decoded = await decodeSourceImage(bytes, 80_000_000);
    if (!decoded.ok) return decoded;
    const input = sharp(bytes, {
      animated: decoded.value.animated,
      failOn: "warning",
      limitInputPixels: 80_000_000,
    });
    const output = decoded.value.animated
      ? await input.gif({
          reuse: true,
          colours: 256,
          effort: 10,
          dither: 1,
          interFrameMaxError: 0,
          interPaletteMaxError: 0,
          keepDuplicateFrames: true,
        }).toBuffer()
      : await input.rotate().webp({
          quality: 92,
          alphaQuality: 100,
          effort: 6,
          smartSubsample: true,
          smartDeblock: true,
        }).toBuffer();
    return {
      ok: true as const,
      value: {
        bytes: output,
        format: decoded.value.animated ? "gif" as const : "webp" as const,
      },
    };
  }
  if (kind === "editor") {
    const state = object(request["state"]);
    exact(state, ["name", "description", "transform", "regions"]);
    if (state["name"] !== "" || state["description"] !== "")
      throw new Error("invalid-native-job");
    exact(object(state["transform"]), [
      "panX",
      "panY",
      "zoom",
      "contrast",
      "saturation",
    ]);
    const regions = state["regions"];
    if (!Array.isArray(regions) || regions.length > 1000)
      throw new Error("invalid-native-job");
    for (const value of regions) {
      const region = object(value);
      exact(region, ["id", "mode", "x", "y", "width", "height"]);
      if (typeof region["id"] !== "string" || region["id"].length > 128)
        throw new Error("invalid-native-job");
    }
    const canvas = object(request["canvas"]);
    exact(canvas, ["width", "height"]);
    const limits = object(request["limits"]);
    exact(limits, ["maxInputPixels", "maxOutputPixels", "maxOutputBytes"]);
    if (
      ![limits["maxInputPixels"], limits["maxOutputPixels"]].every(
        (value) =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 1 &&
          value <= 80_000_000,
      )
    )
      throw new Error("invalid-native-job");
    const options = object(request["options"]);
    exact(options, [
      "blurSigma",
      ...["gifFps", "background", "compression", "detailScale"].filter(
        (key) => key in options,
      ),
    ]);
    return await renderEditedImageRendition(
      bytes,
      state as unknown as MediaEditorState,
      canvas as unknown as RenditionCanvas,
      limits as unknown as RenditionLimits,
      options as unknown as EditorRenditionOptions,
    );
  }
  const recipe = decodeEditRecipe(request["recipe"]);
  return await renderOptimizedImageRendition(
    bytes,
    {
      name: "",
      description: "",
      regions: [],
      transform: recipe,
    },
    recipe,
    {
      maxInputPixels: 40_000_000,
      maxOutputPixels: 80_000_000,
      maxOutputBytes: 2_499_999,
    },
    {
      blurSigma: 20,
      gifFps: recipe.gifFps,
      compression: recipe.compression,
      background: recipe.background,
    },
  );
}
if (process.send === undefined) process.exit(1);
process.once("message", (request: unknown) => {
  void work(request).then(
    (result) => {
      process.send!(result, (error: Error | null) =>
        process.exit(error ? 1 : 0),
      );
    },
    () => process.exit(1),
  );
});
