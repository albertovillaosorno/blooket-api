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
//   - Bounded subprocess isolation for native image decode and rendering.
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
//   - Jobs time out after 20 seconds and exit before the caller resumes.
//
import { fork } from "node:child_process";
import { detectImageFormat } from
  "../../../media/image-formats/domain/image-format.ts";
import {
  decodeEditRecipe,
  object,
  exact,
  type EditRecipe,
} from "../../../media/library-metadata/domain/metadata.ts";
import type { ImageDecodeResult } from
  "../../../media/image-decoding/adapter-outbound/sharp-image.ts";
import type {
  EditorRenditionResult,
  OptimizedEditorRenditionResult,
  EditorRenditionOptions,
} from "../../../media/image-renditions/adapter-outbound/edit.ts";

import {
  decodeRenditionOptimizationCandidate,
  renditionOptimizationCandidates,
} from "../../../media/rendition-optimization/domain/candidates.ts";

import type { MediaEditorState } from
  "../../../media/editor-state/domain/editor-state.ts";
import type {
  RenditionCanvas,
  RenditionLimits,
} from "../../../media/image-renditions/adapter-outbound/sharp-rendition.ts";

export interface NativeMediaOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  // Trusted composition/test injection; never loaded from settings or MCP.
  readonly worker?: URL;
  readonly spawned?: (pid: number) => void;
}
const SOURCE_CODES = new Set([
  "invalid-pixel-limit",
  "unsupported-image-format",
  "image-pixel-limit-exceeded",
  "image-frame-limit-exceeded",
  "image-decode-failed",
  "decoder-format-mismatch",
  "invalid-image-metadata",
]);
const RENDER_CODES = new Set([
  "invalid-editor-rendition",
  "editor-animation-unsupported",
  "rendition-pixel-limit-exceeded",
  "rendition-byte-limit-exceeded",
  "rendition-failed",
]);
export async function decodeImageIsolated(
  bytes: Uint8Array,
  maxInputPixels: number,
  options?: NativeMediaOptions,
): Promise<ImageDecodeResult> {
  admitSource(bytes);
  if (
    !Number.isSafeInteger(maxInputPixels) ||
    maxInputPixels < 1 ||
    maxInputPixels > 80_000_000
  )
    throw new Error("invalid-pixel-limit");
  const reply = object(
    await runNativeJob(
      {
        version: 1,
        kind: "decode",
        bytes: new Uint8Array(bytes),
        maxInputPixels,
      },
      options,
    ),
  );
  if (reply["ok"] === false) {
    exact(reply, ["ok", "code"]);
    if (typeof reply["code"] !== "string" || !SOURCE_CODES.has(reply["code"]))
      throw new Error("native-media-invalid-result");
    return reply as Extract<ImageDecodeResult, { ok: false }>;
  }
  exact(reply, ["ok", "value"]);
  const value = object(reply["value"]);
  exact(value, [
    "format",
    "frameWidth",
    "frameHeight",
    "frameCount",
    "animated",
    "frameDelaysMs",
    ...("loopCount" in value ? ["loopCount"] : []),
  ]);
  const format = detectImageFormat(bytes);
  if (
    reply["ok"] !== true ||
    !format ||
    JSON.stringify(value["format"]) !== JSON.stringify(format) ||
    !integer(value["frameWidth"], 1, maxInputPixels) ||
    !integer(value["frameHeight"], 1, maxInputPixels) ||
    !integer(value["frameCount"], 1, 600) ||
    Number(value["frameWidth"]) *
      Number(value["frameHeight"]) *
      Number(value["frameCount"]) >
      maxInputPixels ||
    value["animated"] !== Number(value["frameCount"]) > 1 ||
    !Array.isArray(value["frameDelaysMs"]) ||
    value["frameDelaysMs"].length !==
      (value["animated"] ? value["frameCount"] : 0) ||
    !value["frameDelaysMs"].every((item) => integer(item, 0, 655350)) ||
    ("loopCount" in value && !integer(value["loopCount"], 0, 65535))
  )
    throw new Error("native-media-invalid-result");
  return reply as unknown as ImageDecodeResult;
}
export type CompactImageResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly bytes: Uint8Array;
        readonly format: "webp" | "gif";
      };
    }
  | {
      readonly ok: false;
      readonly code:
        | "unsupported-image-format"
        | "image-pixel-limit-exceeded"
        | "image-frame-limit-exceeded"
        | "image-decode-failed"
        | "decoder-format-mismatch"
        | "invalid-image-metadata"
        | "native-media-failed";
    };

export async function sampleImageColorsIsolated(
  bytes: Uint8Array,
  options?: NativeMediaOptions,
): Promise<Uint8Array> {
  admitSource(bytes);
  const reply = object(
    await runNativeJob(
      {
        version: 1,
        kind: "sample-colors",
        bytes: new Uint8Array(bytes),
      },
      options,
    ),
  );
  if (reply["ok"] === false) {
    exact(reply, ["ok", "code"]);
    if (typeof reply["code"] === "string" && SOURCE_CODES.has(reply["code"]))
      throw new Error(reply["code"]);
    throw new Error("native-media-invalid-result");
  }
  exact(reply, ["ok", "value"]);
  if (reply["ok"] !== true) throw new Error("native-media-invalid-result");
  const value = object(reply["value"]);
  exact(value, ["rgba"]);
  const rgba = value["rgba"];
  if (
    !(rgba instanceof Uint8Array) ||
    rgba.byteLength < 256 ||
    rgba.byteLength > 1_280 ||
    rgba.byteLength % 256 !== 0
  )
    throw new Error("native-media-invalid-result");
  return rgba;
}

export async function compactImageIsolated(
  bytes: Uint8Array,
  options?: NativeMediaOptions,
): Promise<CompactImageResult> {
  admitSource(bytes);
  try {
    const reply = object(
      await runNativeJob(
        {
          version: 1,
          kind: "compact",
          bytes: new Uint8Array(bytes),
        },
        options,
      ),
    );
    if (reply["ok"] === false) {
      exact(reply, ["ok", "code"]);
      if (
        typeof reply["code"] !== "string"
        || !SOURCE_CODES.has(reply["code"])
      ) {
        throw new Error("native-media-invalid-result");
      }
      return reply as CompactImageResult;
    }
    exact(reply, ["ok", "value"]);
    const value = object(reply["value"]);
    exact(value, ["bytes", "format"]);
    const output = value["bytes"];
    const detected =
      output instanceof Uint8Array ? detectImageFormat(output) : undefined;
    if (
      reply["ok"] !== true
      || !(output instanceof Uint8Array)
      || output.byteLength < 1
      || output.byteLength > 25_000_000
      || !detected
      || !["webp", "gif"].includes(detected.format)
      || value["format"] !== detected.format
    ) {
      throw new Error("native-media-invalid-result");
    }
    return reply as CompactImageResult;
  } catch {
    return { ok: false, code: "native-media-failed" };
  }
}

export async function renderImageIsolated(
  bytes: Uint8Array,
  recipe: EditRecipe,
  options?: NativeMediaOptions,
): Promise<OptimizedEditorRenditionResult> {
  admitSource(bytes);
  decodeEditRecipe(recipe);
  const reply = object(
    await runNativeJob(
      {
        version: 1,
        kind: "render",
        bytes: new Uint8Array(bytes),
        recipe,
      },
      options,
    ),
  );
  try {
    return decodeRenderedReply(
      reply,
      recipe,
      80_000_000,
      2_499_999,
      recipe,
    ) as OptimizedEditorRenditionResult;
  } catch {
    throw new Error("native-media-invalid-result");
  }
}
const NATIVE_FAILURES = [
  "native-media-timeout",
  "native-media-cancelled",
  "native-media-unavailable",
  "native-media-failed",
  "native-media-invalid-result",
] as const;
export type NativeRenditionResult =
  | EditorRenditionResult
  | {
      readonly ok: false;
      readonly code: (typeof NATIVE_FAILURES)[number];
    };
export async function renderEditorIsolated(
  bytes: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
  processOptions?: NativeMediaOptions,
): Promise<NativeRenditionResult> {
  if (
    !integer(limits.maxInputPixels, 1, 80_000_000) ||
    !integer(limits.maxOutputPixels, 1, 80_000_000) ||
    !integer(limits.maxOutputBytes, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(canvas.width, 1, 80_000_000) ||
    !integer(canvas.height, 1, 80_000_000)
  )
    return { ok: false, code: "invalid-editor-rendition" };
  try {
    admitSource(bytes);
    const reply = object(
      await runNativeJob(
        {
          version: 1,
          kind: "editor",
          bytes: new Uint8Array(bytes),
          state: {
            name: "",
            description: "",
            transform: state.transform,
            regions: state.regions,
          },
          canvas,
          limits,
          options,
        },
        processOptions,
      ),
    );
    return decodeRenderedReply(
      reply,
      canvas,
      limits.maxOutputPixels,
      limits.maxOutputBytes,
    ) as EditorRenditionResult;
  } catch (error) {
    const code = error instanceof Error ? error.message : "native-media-failed";
    return {
      ok: false,
      code:
        NATIVE_FAILURES.find((item) => item === code) ?? "native-media-failed",
    };
  }
}
function decodeRenderedReply(
  reply: Record<string, unknown>,
  canvas: RenditionCanvas,
  maxOutputPixels: number,
  maxOutputBytes: number,
  expectedRecipe?: EditRecipe,
): EditorRenditionResult | OptimizedEditorRenditionResult {
  if (reply["ok"] === false) {
    exact(reply, [
      "ok",
      "code",
      ...("sourceCode" in reply ? ["sourceCode"] : []),
    ]);
    if (
      typeof reply["code"] !== "string" ||
      !RENDER_CODES.has(reply["code"]) ||
      ("sourceCode" in reply &&
        (typeof reply["sourceCode"] !== "string" ||
          !SOURCE_CODES.has(reply["sourceCode"])))
    )
      throw new Error("native-media-invalid-result");
    return reply as Extract<EditorRenditionResult, { ok: false }>;
  }
  exact(reply, ["ok", "value"]);
  const value = object(reply["value"]);
  exact(value, [
    "bytes",
    "format",
    "mediaType",
    "width",
    "height",
    "frameCount",
    "animated",
    ...(expectedRecipe === undefined ? [] : ["effective"]),
  ]);
  const effective =
    expectedRecipe === undefined
      ? undefined
      : decodeRenditionOptimizationCandidate(value["effective"]);
  const output = value["bytes"];
  const format =
    output instanceof Uint8Array ? detectImageFormat(output) : null;
  if (
    expectedRecipe !== undefined &&
    effective !== undefined &&
    !renditionOptimizationCandidates({
      animated: value["animated"] === true,
      gifFps: expectedRecipe.gifFps,
      compression: expectedRecipe.compression,
    }).some(
      (candidate) =>
        candidate.stage === effective.stage &&
        candidate.detailScale === effective.detailScale &&
        candidate.gifFps === effective.gifFps &&
        candidate.compression === effective.compression,
    )
  )
    throw new Error("native-media-invalid-result");
  if (
    reply["ok"] !== true ||
    !(output instanceof Uint8Array) ||
    output.length < 1 ||
    output.length >= 2_500_000 ||
    output.length > maxOutputBytes ||
    !format ||
    !(expectedRecipe === undefined
      ? ["png", "gif"]
      : ["jpeg", "gif"]
    ).includes(format.format) ||
    value["format"] !== format.format ||
    value["mediaType"] !== format.mediaType ||
    value["width"] !== canvas.width ||
    value["height"] !== canvas.height ||
    !integer(value["frameCount"], 1, 600) ||
    canvas.width * canvas.height * Number(value["frameCount"]) >
      maxOutputPixels ||
    typeof value["animated"] !== "boolean" ||
    (format.format === "gif"
      ? value["animated"] !== true
      : value["animated"] !== false || value["frameCount"] !== 1)
  )
    throw new Error("native-media-invalid-result");
  return reply as unknown as EditorRenditionResult;
}
async function runNativeJob(job: unknown, options: NativeMediaOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!integer(timeoutMs, 1, 60_000)) throw new Error("invalid-native-timeout");
  if (options.signal?.aborted) throw new Error("native-media-cancelled");
  return await new Promise<unknown>((resolve, reject) => {
    const child = fork(
      options.worker ??
        new URL("../adapter-inbound/worker.ts", import.meta.url),
      [],
      {
        serialization: "advanced",
        execArgv: ["--max-old-space-size=256"],
        env: { PATH: process.env["PATH"] ?? "" },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let failure: string | undefined,
      reply: unknown,
      received = false;
    const stop = (code: string) => {
      failure ??= code;
      child.kill("SIGKILL");
    };
    const abort = () => stop("native-media-cancelled");
    const timer = setTimeout(() => stop("native-media-timeout"), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.once("spawn", () => {
      if (child.pid !== undefined) options.spawned?.(child.pid);
    });
    child.on("message", (message: unknown) => {
      if (received) {
        stop("native-media-invalid-result");
        return;
      }
      received = true;
      reply = message;
    });
    child.once("error", () => stop("native-media-unavailable"));
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(new Error(failure));
      else if (code !== 0 || !received)
        reject(new Error("native-media-failed"));
      else resolve(reply);
    });
    child.send(job as object, (error) => {
      if (error) stop("native-media-unavailable");
    });
  });
}
function admitSource(bytes: Uint8Array) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 1 ||
    bytes.length > 25_000_000
  )
    throw new Error("source-too-large");
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
