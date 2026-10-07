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
//   - Trusted presentation icon assembly.
// - Must-Not:
//   - Change original artwork or choose product behavior.
// - Allows:
//   - Inputs: Repository artwork and owned package destinations.
//   - Outputs: Chrome PNGs and a PNG-backed macOS ICNS.
//   - Side effects: Native rendering and owned artifact writes.
// - Split-When:
//   - Another platform requires its own icon container.
// - Merge-When:
//   - Package assembly no longer converts presentation icons.
// - Summary:
//   - Builds icon resolutions from the supplied source artwork.
// - Description:
//   - Keeps platform-specific containers in the distribution adapter.
// - Usage:
//   - Call during native or extension package assembly.
// - Defaults:
//   - Unsupported source artwork fails the build.
//
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSharp } from
  "../../../media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

async function png(source: Uint8Array, size: number): Promise<Buffer> {
  const sharp = await loadSharp();
  return Buffer.from(
    await sharp(source, { limitInputPixels: 4_000_000 })
      .resize({ width: size, height: size, fit: "contain" })
      .png()
      .toBuffer(),
  );
}
export async function buildExtensionIcons(
  repo: string,
  destination: string,
): Promise<void> {
  const source = await readFile(
    join(repo, "assets/icon/blooket-extension-and-macos.png"),
  );
  await mkdir(join(destination, "icons"));
  for (const size of [16, 32, 48, 128]) {
    await writeFile(
      join(destination, `icons/${size}.png`),
      await png(source, size),
    );
  }
}
export async function buildMacIcon(repo: string, destination: string) {
  const source = await readFile(
    join(repo, "assets/icon/blooket-extension-and-macos.png"),
  );
  const chunks: Buffer[] = [];
  for (const [type, size] of [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ] as const) {
    const image = await png(source, size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(image.length + 8, 4);
    chunks.push(header, image);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(
    8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    4,
  );
  await writeFile(destination, Buffer.concat([header, ...chunks]));
}
