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
//   - Normalized public release metadata and bounded update selection.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Unknown release candidates and explicit current host/version.
//   - Outputs: Exact decoded metadata and local update status.
//   - Side effects: None.
// - Split-When:
//   - Trusted manifests add an independent installation contract.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Selects final public candidates without claiming installation trust.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Decode adapter projections before selecting an update candidate.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPublicUpdates,
  admittedNextPage,
  projectGithubReleases,
} from "../../../../src/platforms/github-updates/adapter-outbound/catalog.ts";
import {
  PUBLIC_RELEASES_API,
  releaseAssetUrl,
  releasePageUrl,
} from "../../../../src/ir/application-updates/contract/releases.ts";

const options = {
  currentVersion: "26.4.0",
  target: "darwin-arm64",
  now: new Date("2026-10-07T00:00:00Z"),
};
const json = (value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
const release = (revision: string, id = 1) => ({
  id,
  tag_name: "v" + revision,
  html_url: releasePageUrl("v" + revision),
  draft: false,
  prerelease: false,
  published_at: "2026-10-06T12:00:00Z",
  body: "ignored text",
  author: { login: "ignored identity" },
  assets: [
    {
      id: id * 10,
      name: "darwin-arm64.zip",
      size: 1234,
      state: "uploaded",
      browser_download_url: releaseAssetUrl("v" + revision, "darwin-arm64.zip"),
    },
  ],
});

function requests(responses: Response[]) {
  const seen: { url: string; options: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), options: init });
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { seen, request };
}

test(
  "public check sends only fixed anonymous headers and selected metadata",
  async () => {
  const fixture = requests([json([release("26.4.1")])]);
  const result = await checkPublicUpdates({
    ...options,
    request: fixture.request,
  });
  assert.equal(result.status, "available");
  assert.equal(
    fixture.seen[0]!.url,
    `${PUBLIC_RELEASES_API}?per_page=50&page=1`,
  );
  const init = fixture.seen[0]!.options!;
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.method, "GET");
  assert.deepEqual(Object.keys(init.headers!).sort(), [
    "Accept",
    "User-Agent",
    "X-GitHub-Api-Version",
  ]);
  assert.equal(JSON.stringify(result).includes("ignored"), false);
  assert.equal(projectGithubReleases([release("26.4.1")]).length, 1);
});

test(
  "empty and current catalogs differ from HTTP/network failures", async () => {
  for (const page of [[], [release("26.4.0")]])
    assert.equal(
      (
        await checkPublicUpdates({
          ...options,
          request: requests([json(page)]).request,
        })
      ).status,
      "current",
    );
  const failure = await checkPublicUpdates({
    ...options,
    request: requests([
      new Response("private error", {
        status: 503,
        headers: { "retry-after": "3600" },
      }),
    ]).request,
  });
  assert.deepEqual(failure, {
    status: "source-unavailable",
    reason: "http",
    httpStatus: 503,
    retryAfterSeconds: 3600,
  });
  assert.equal(JSON.stringify(failure).includes("private"), false);
  assert.deepEqual(
    await checkPublicUpdates({
      ...options,
      request: async () => {
        throw new Error("DNS details are private");
      },
    }),
    { status: "source-unavailable", reason: "network" },
  );
});

test(
  "malformed JSON, types and response limits cannot report current",
  async () => {
  for (const response of [
    new Response("not JSON", {
      headers: {
        "content-type": "application/json",
      },
    }),
    json({}),
    json([{}]),
    new Response("[]", { headers: { "content-type": "text/html" } }),
    json([], { "content-length": "1000001" }),
    new Response(" ".repeat(1_000_001), {
      headers: {
        "content-type": "application/json",
      },
    }),
    new Response(new Uint8Array([0xff]), {
      headers: {
        "content-type": "application/json",
      },
    }),
  ])
    assert.equal(
      (
        await checkPublicUpdates({
          ...options,
          request: requests([response]).request,
        })
      ).status,
      "untrusted-metadata",
    );
});

test(
  "pagination follows the exact authority and stops before a third page",
  async () => {
  const next = (page: number) =>
    `<${PUBLIC_RELEASES_API}?page=${page}&per_page=50>; rel="next"`;
  assert.equal(
    admittedNextPage(next(2), 1),
    `${PUBLIC_RELEASES_API}?per_page=50&page=2`,
  );
  for (const value of [
    "nonsense",
    '<bad>; rel="next"',
    '<https://example.test/private>; rel="next"',
    next(2) + "," + next(2),
    next(3),
    next(2).replace("page=2", "page=2&secret=oops"),
  ])
    assert.throws(() => admittedNextPage(value, 1));
  const fixture = requests([
    json([release("26.4.1")], { link: next(2) }),
    json([release("26.4.2", 2)]),
  ]);
  const result = await checkPublicUpdates({
    ...options,
    request: fixture.request,
  });
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.version, "26.4.2");
  assert.equal(fixture.seen.length, 2);
  const limited = requests([
    json([], { link: next(2) }),
    json([], { link: next(3) }),
  ]);
  assert.deepEqual(
    await checkPublicUpdates({ ...options, request: limited.request }),
    { status: "source-unavailable", reason: "catalog-limit" },
  );
  assert.equal(limited.seen.length, 2);
});

test(
  "timeout bounds a hanging response and cancellation is distinct",
  async () => {
  const never: typeof fetch = async () => new Promise(() => {});
  assert.deepEqual(
    await checkPublicUpdates({ ...options, request: never, timeoutMs: 10 }),
    { status: "source-unavailable", reason: "timeout" },
  );
  const signal = AbortSignal.abort();
  assert.deepEqual(
    await checkPublicUpdates({ ...options, request: never, signal }),
    { status: "source-unavailable", reason: "cancelled" },
  );
  const active = new AbortController();
  const pending = checkPublicUpdates({
    ...options,
    request: never,
    signal: active.signal,
  });
  active.abort();
  assert.deepEqual(await pending, {
    status: "source-unavailable",
    reason: "cancelled",
  });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const body = requests([
    new Response(stream, {
      headers: {
        "content-type": "application/json",
      },
    }),
  ]);
  assert.deepEqual(
    await checkPublicUpdates({
      ...options,
      request: body.request,
      timeoutMs: 10,
    }),
    {
      status: "source-unavailable",
      reason: "timeout",
    },
  );
  assert.equal(cancelled, true);
  const unsupported = requests([]);
  assert.deepEqual(
    await checkPublicUpdates({
      ...options,
      target: "linux-x64",
      request: unsupported.request,
    }),
    { status: "unsupported-platform" },
  );
  assert.equal(unsupported.seen.length, 0);
});
