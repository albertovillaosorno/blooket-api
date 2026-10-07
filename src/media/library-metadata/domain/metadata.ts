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
//   - Exact versioned media metadata and per-image export recipes.
// - Must-Not:
//   - Rename source files, translate original text, or execute edits.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Exact versioned media metadata and per-image export recipes.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import {
  decodeRenditionOptimizationCandidate,
  renditionOptimizationCandidates,
  type RenditionOptimizationCandidate,
} from "../../rendition-optimization/domain/candidates.ts";

const PREPARED_FILE = new RegExp(
  "^renditions/[a-zA-Z0-9_-]" + "[a-zA-Z0-9._-]{0,127}/[0-9]+\\.(png|gif)$",
  "u",
);

export interface EditRecipe {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly background: {
    readonly mode: "blur" | "solid";
    readonly color: string;
  };
  readonly width: number;
  readonly height: number;
  readonly gifFps: number;
  readonly compression: "lossless" | "compact";
}
export type NormalizationStatus = "pending" | "completed" | "stale";

export interface LibraryMetadata {
  readonly schemaVersion: 1 | 2;
  readonly legacy?: {
    readonly englishVerified: boolean;
    readonly sourceRevision: number;
    readonly sourcePath: string;
    readonly indexDigest: string;
  };
  readonly id: string;
  readonly asset: string;
  readonly revision: number;
  readonly original: {
    readonly revision: number;
    readonly name: string;
    readonly description: string;
    readonly language: string;
  };
  readonly topics: readonly string[];
  readonly generatedEnglish: null | {
    readonly name: string;
    readonly description: string;
    readonly generatedBy: "ai";
    readonly sourceRevision: number;
    readonly verified: false;
  };
  readonly edit: EditRecipe;
  readonly prepared: null | {
    readonly file: string;
    readonly bytes: number;
    readonly recipeRevision: number;
    readonly effective?: RenditionOptimizationCandidate;
  };
}
export function normalizationStatus(
  record: LibraryMetadata,
): NormalizationStatus {
  if (!record.generatedEnglish) return "pending";
  if (record.generatedEnglish.sourceRevision !== record.original.revision)
    return "stale";
  return record.original.language ? "completed" : "pending";
}

export function decodeEditRecipe(value: unknown): EditRecipe {
  const recipe = object(value);
  exact(recipe, [
    "panX",
    "panY",
    "zoom",
    "contrast",
    "saturation",
    "background",
    "width",
    "height",
    "gifFps",
    "compression",
  ]);
  const background = object(recipe["background"]);
  exact(background, ["mode", "color"]);
  if (
    !number(recipe["panX"], -10, 10) ||
    !number(recipe["panY"], -10, 10) ||
    !number(recipe["zoom"], 0.1, 10) ||
    !number(recipe["contrast"], 0, 3) ||
    !number(recipe["saturation"], 0, 3) ||
    !integer(recipe["width"], 16, 1920) ||
    !integer(recipe["height"], 16, 1920) ||
    typeof recipe["gifFps"] !== "number" ||
    ![1, 2, 5, 10, 20, 25, 50].includes(recipe["gifFps"]) ||
    (recipe["compression"] !== "lossless" &&
      recipe["compression"] !== "compact") ||
    (background["mode"] !== "blur" && background["mode"] !== "solid") ||
    typeof background["color"] !== "string" ||
    !/^#[0-9a-f]{6}$/iu.test(background["color"])
  )
    throw new Error("invalid-edit-recipe");
  return value as EditRecipe;
}
export function decodeLibraryMetadata(value: unknown): LibraryMetadata {
  const m = object(value);
  exact(m, [
    "schemaVersion",
    "id",
    "asset",
    "revision",
    "original",
    "topics",
    "generatedEnglish",
    "edit",
    "prepared",
    ...(m["schemaVersion"] === 2 ? ["legacy"] : []),
  ]);
  if (
    (m["schemaVersion"] !== 1 && m["schemaVersion"] !== 2) ||
    typeof m["id"] !== "string" ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(m["id"]) ||
    typeof m["asset"] !== "string" ||
    !safeAsset(m["asset"]) ||
    !integer(m["revision"], 1, Number.MAX_SAFE_INTEGER)
  )
    throw new Error("invalid-media-metadata");
  if (m["schemaVersion"] === 2) {
    const legacy = object(m["legacy"]);
    exact(legacy, [
      "englishVerified",
      "sourceRevision",
      "sourcePath",
      "indexDigest",
    ]);
    if (
      typeof legacy["englishVerified"] !== "boolean" ||
      !integer(
        legacy["sourceRevision"],
        1,
        Number(object(m["original"])["revision"]),
      ) ||
      typeof legacy["sourcePath"] !== "string" ||
      !safeRelativeImage(legacy["sourcePath"]) ||
      typeof legacy["indexDigest"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(legacy["indexDigest"])
    )
      throw new Error("invalid-legacy-provenance");
  }
  const original = object(m["original"]);
  exact(original, ["revision", "name", "description", "language"]);
  if (
    !integer(original["revision"], 1, Number.MAX_SAFE_INTEGER) ||
    !text(original["name"], 200) ||
    !text(original["description"], 10_000) ||
    !text(original["language"], 35)
  )
    throw new Error("invalid-original-metadata");
  topics(m["topics"]);
  decodeEditRecipe(m["edit"]);
  if (m["generatedEnglish"] !== null) {
    const generated = object(m["generatedEnglish"]);
    exact(generated, [
      "name",
      "description",
      "generatedBy",
      "sourceRevision",
      "verified",
    ]);
    if (
      !text(generated["name"], 200) ||
      !text(generated["description"], 10_000) ||
      generated["generatedBy"] !== "ai" ||
      generated["verified"] !== false ||
      !integer(generated["sourceRevision"], 1, Number(original["revision"]))
    )
      throw new Error("invalid-enrichment");
  }
  if (m["prepared"] !== null) {
    const prepared = object(m["prepared"]);
    exact(prepared, [
      "file",
      "bytes",
      "recipeRevision",
      ...("effective" in prepared ? ["effective"] : []),
    ]);
    if (
      typeof prepared["file"] !== "string" ||
      !PREPARED_FILE.test(prepared["file"]) ||
      !integer(prepared["bytes"], 1, 2_499_999) ||
      !integer(prepared["recipeRevision"], 1, Number(m["revision"]))
    )
      throw new Error("invalid-prepared-media");
    if ("effective" in prepared) {
      const effective = decodeRenditionOptimizationCandidate(
        prepared["effective"],
      );
      const allowed = renditionOptimizationCandidates({
        animated: prepared["file"].endsWith(".gif"),
        gifFps: Number(object(m["edit"])["gifFps"]),
        compression: object(m["edit"])["compression"] as
          | "lossless"
          | "compact",
      });
      if (
        !allowed.some(
          (candidate) =>
            JSON.stringify(candidate) === JSON.stringify(effective),
        )
      )
        throw new Error("invalid-prepared-media");
    }
  }
  return value as LibraryMetadata;
}
export function topics(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    !value.every((item) => text(item, 100))
  )
    throw new Error("invalid-topics");
}
export function safeAsset(value: string): boolean {
  return (
    value.startsWith("photos/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" && part !== "." && part !== ".." && !part.startsWith("."),
      )
  );
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid-object");
  return value as Record<string, unknown>;
}
export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  )
    throw new Error("unknown-or-missing-field");
}
export function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" && value.length <= limit && !value.includes("\0")
  );
}
function integer(value: unknown, min: number, max: number): boolean {
  return number(value, min, max) && Number.isSafeInteger(value);
}
function number(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function safeRelativeImage(value: string): boolean {
  return (
    value.length <= 1024 &&
    /\.(png|jpe?g|gif|webp|avif)$/iu.test(value) &&
    !/[\\\x00-\x1f]/u.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 && part.length <= 240 && !part.startsWith("."),
      )
  );
}
