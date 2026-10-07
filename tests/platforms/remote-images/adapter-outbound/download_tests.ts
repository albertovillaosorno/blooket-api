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
//   - Verification of bounded image intake and gallery presentation.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Verification of bounded image intake and gallery presentation.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  publicImageAddress,
  imageDownloadUrl,
  downloadImage,
} from "../../../../src/platforms/remote-images/adapter-outbound/download.ts";

test(
  "image URLs reject credential, scheme, port and private-address variants",
  () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.31.0.1",
    "192.168.1.2",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "2001:100::1",
    "2002::1",
  ]) {
    assert.equal(publicImageAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])
    assert.equal(publicImageAddress(address), true, address);
  for (const url of [
    "file:///a",
    "data:image/png;base64,eA==",
    "https://user:secret@example.test/a",
    "http://example.test:8080/a",
    "https://example.test/a#secret",
  ]) {
    assert.throws(() => imageDownloadUrl(url), /invalid-image-url/u);
  }
});

function transport(
  hops,
  addresses = [{ address: "93.184.216.34", family: 4 }],
) {
  let requests = 0;
  const lookup = async () => addresses;
  const request = (url, options, callback) => {
    requests++;
    assert.equal(options.agent, false);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    options.lookup(url.hostname, { all: false }, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, addresses[0].address);
      assert.equal(family, addresses[0].family);
    });
    const req = new EventEmitter();
    req.end = () => {
      const hop = hops.shift();
      const response = Readable.from(hop.chunks ?? [Buffer.from("image")]);
      response.statusCode = hop.status ?? 200;
      response.headers = hop.headers ?? { "content-type": "image/png" };
      callback(response);
    };
    return req;
  };
  return {
    dependencies: { lookup, httpRequest: request, httpsRequest: request },
    requests: () => requests,
  };
}

test(
  "downloads pin public DNS; redirects recheck and reject private answers",
  async () => {
  const good = transport([
    { status: 302, headers: { location: "/final.png" } },
    {},
  ]);
  const result = await downloadImage(
    "https://example.test/a",
    good.dependencies,
  );
  assert.equal(result.bytes.toString(), "image");
  assert.equal(result.type, "image/png");
  assert.equal(good.requests(), 2);
  const blocked = transport([], [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(
    downloadImage("https://example.test/a", blocked.dependencies),
    /image-url-not-public/u,
  );
  assert.equal(blocked.requests(), 0);
  const mixed = transport(
    [],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  );
  await assert.rejects(
    downloadImage("https://example.test/a", mixed.dependencies),
    /image-url-not-public/u,
  );
  const rebound = transport([
    { status: 302, headers: { location: "https://other.example.test/image" } },
  ]);
  let lookups = 0;
  rebound.dependencies.lookup = async () => [
    {
      address: ++lookups === 1 ? "93.184.216.34" : "169.254.169.254",
      family: 4,
    },
  ];
  await assert.rejects(
    downloadImage("https://example.test/a", rebound.dependencies),
    /image-url-not-public/u,
  );
  assert.equal(rebound.requests(), 1);
});

test(
  "downloads bound bytes and redirects and reject HTML or TLS downgrade",
  async () => {
  for (const [hops, code] of [
    [
      [{ headers: { "content-type": "text/html" } }],
      "image-download-not-image",
    ],
    [
      [{ chunks: [Buffer.alloc(12_500_001), Buffer.alloc(12_500_000)] }],
      "source-too-large",
    ],
    [
      [{ status: 302, headers: { location: "http://example.test/a" } }],
      "invalid-image-url",
    ],
    [
      Array.from({ length: 4 }, () => ({
        status: 302,
        headers: { location: "/again" },
      })),
      "image-download-redirect-limit",
    ],
  ]) {
    const mocked = transport(hops);
    await assert.rejects(
      downloadImage("https://example.test/a", mocked.dependencies),
      new RegExp(code, "u"),
    );
  }
});
