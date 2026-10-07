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
//   - Quarterly CalVer admission for explicit release tags.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: None.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Rejects malformed calendar versions before release execution.
// - Description:
//   - Defines three-month UTC quarters and monotonic release revisions.
// - Usage:
//   - Validate the operator-selected tag before release execution.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  PRODUCT_VERSION,
  decodeProductVersion,
  compareProductVersions,
  extensionVersion,
  appleBuildVersion,
} from "../../../../src/ir/product-version/contract/version.ts";

test("product version uses strict two-digit years and numeric revisions",
() => {
  assert.equal(decodeProductVersion("26.4.0").year, 2026);
  for (const value of [
    "2026.4.0",
    "v26.4.0",
    "26.0.0",
    "26.5.0",
    "26.04.0",
    "26.4.-1",
    "26.4.01",
    "26.4.100000",
    "26.4.0\n",
    "6.4.0",
  ])
    assert.throws(() => decodeProductVersion(value));
  assert.equal(compareProductVersions("26.4.10", "26.4.9"), 1);
  assert.equal(compareProductVersions("27.1.0", "26.4.99999"), 1);
  assert.equal(compareProductVersions("26.4.0", "26.4.0"), 0);
  assert.equal(compareProductVersions("26.3.9", "26.4.0"), -1);
});

test("package projections retain the canonical version and platform limits",
async () => {
  const root = new URL("../../../../", import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const manifest = JSON.parse(
    await readFile(
      new URL("src/ui/browser-extension/adapter-inbound/manifest.json", root),
      "utf8",
    ),
  );
  assert.equal(pkg.version, PRODUCT_VERSION);
  assert.equal(manifest.version_name, PRODUCT_VERSION);
  assert.equal(manifest.version, extensionVersion(PRODUCT_VERSION));
  for (const version of [
    "00.1.0",
    "26.4.65535",
    "26.4.65536",
    "26.4.99999",
    "27.1.0",
    "99.4.99999",
  ]) {
    const chrome = extensionVersion(version).split(".").map(Number);
    assert.ok(chrome.every((value) => value >= 0 && value <= 65535));
    const apple = appleBuildVersion(version).split(".").map(Number);
    assert.ok(apple[0]! > 0 && apple[0]! <= 9999);
    assert.ok(apple[1]! <= 99 && apple[2]! <= 99);
  }
  const values = [
    "26.4.0",
    "26.4.9",
    "26.4.10",
    "26.4.9999",
    "26.4.10000",
    "26.4.65535",
    "26.4.65536",
    "26.4.99999",
    "27.1.0",
  ];
  const numeric = (a: string, b: string) => {
    const x = a.split(".").map(Number),
      y = b.split(".").map(Number);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  };
  for (let i = 1; i < values.length; i++) {
    assert.ok(
      numeric(extensionVersion(values[i]!), extensionVersion(values[i - 1]!)) >
        0,
    );
    assert.ok(
      numeric(
        appleBuildVersion(values[i]!),
        appleBuildVersion(values[i - 1]!),
      ) > 0,
    );
  }
});
