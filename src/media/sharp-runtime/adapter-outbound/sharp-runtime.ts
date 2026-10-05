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
//   - Loading Sharp from the repository's governed dependency materialization.
// - Must-Not:
//   - Choose media policy, decode product contracts, or transform images.
// - Allows:
//   - Inputs: No product input; callers receive a narrow Sharp factory surface.
//   - Outputs: One cached Sharp factory.
//   - Side effects: Dynamic module loading of the pinned repository dependency.
// - Split-When:
//   - Packaging requires multiple runtime dependency locations.
// - Merge-When:
//   - Media adapters can use standard package resolution under Jig.
// - Summary:
//   - Centralizes the only repository-local Sharp module URL.
// - Description:
//   - Keeps .dependencies layout knowledge out of image policy adapters.
// - Usage:
//   - Media decoder and rendition adapters call loadSharp at operation start.
// - Defaults:
//   - A missing or unloadable Sharp package rejects the returned promise.
//
export interface SharpInputOptions {
  readonly animated?: boolean;
  readonly failOn?: "warning";
  readonly limitInputPixels?: number | boolean;
}

export interface SharpMetadata {
  readonly format?: string;
  readonly compression?: string;
  readonly width?: number;
  readonly height?: number;
  readonly pages?: number;
  readonly pageHeight?: number;
  readonly loop?: number;
  readonly delay?: readonly number[];
}

export interface SharpResizeOptions {
  readonly width: number;
  readonly height: number;
  readonly fit: "cover" | "contain";
  readonly background?: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly alpha: number;
  };
}

export interface SharpPipeline {
  metadata(): Promise<SharpMetadata>;
  raw(): SharpPipeline;
  rotate(): SharpPipeline;
  resize(options: SharpResizeOptions): SharpPipeline;
  blur(sigma: number): SharpPipeline;
  png(): SharpPipeline;
  gif(options: {
    readonly loop: number;
    readonly delay: readonly number[];
    readonly keepDuplicateFrames: boolean;
  }): SharpPipeline;
  composite(images: readonly {
    readonly input: Uint8Array;
  }[]): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
}

export type SharpFactory = (
  input: Uint8Array,
  options?: SharpInputOptions,
) => SharpPipeline;

let sharpFactory: SharpFactory | undefined;

export async function loadSharp(): Promise<SharpFactory> {
  if (sharpFactory !== undefined) {
    return sharpFactory;
  }

  const moduleUrl = new URL(
    "../../../../.dependencies/pnpm/node_modules/sharp/dist/index.mjs",
    import.meta.url,
  );
  const loaded = await import(moduleUrl.href) as {
    readonly default: SharpFactory;
  };
  sharpFactory = loaded.default;
  return sharpFactory;
}
