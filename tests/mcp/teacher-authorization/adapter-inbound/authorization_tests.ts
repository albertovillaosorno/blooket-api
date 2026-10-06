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
//   - Local-consent OAuth codes, PKCE, and opaque access tokens.
// - Must-Not:
//   - Use tunnel tokens as tool authorization or skip local consent.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Local-consent OAuth codes, PKCE, and opaque access tokens.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createTeacherAuthorization } from
  "../../../../src/mcp/teacher-authorization/adapter-inbound/authorization.ts";

test(
  "OAuth requires local consent, PKCE, exact resource " +
    "and single-use codes",
  () => {
    const auth = createTeacherAuthorization("https://teacher.example/mcp");
    const client = auth.register({
      client_name: "Test client",
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    });
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      resource: auth.resource,
      state: "state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const grant = auth.authorize(params);
    assert.equal(auth.redirect(grant.ticket), undefined);
    assert.equal(auth.authenticate("Bearer arbitrary"), false);
    auth.approve(grant.id);
    const redirect = new URL(auth.redirect(grant.ticket)!);
    assert.equal(redirect.searchParams.get("state"), "state");
    const exchange = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      resource: auth.resource,
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
    });
    const wrong = new URLSearchParams(exchange);
    wrong.set("code_verifier", "x".repeat(64));
    assert.throws(() => auth.exchange(wrong), /invalid-grant/u);
    const token = auth.exchange(exchange);
    assert.equal(auth.authenticate("Bearer " + token.access_token), true);
    assert.throws(() => auth.exchange(exchange), /invalid-grant/u);
    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      resource: auth.resource,
      refresh_token: token.refresh_token,
    });
    assert.ok(auth.exchange(refresh).access_token);
    assert.throws(() => auth.exchange(refresh));
    auth.revokeAll();
    assert.equal(auth.authenticate("Bearer " + token.access_token), false);
  },
);
test("OAuth rejects insecure redirects and audiences before consent", () => {
  const auth = createTeacherAuthorization("https://teacher.example/mcp");
  assert.throws(() =>
    auth.register({
      redirect_uris: ["http://evil.example/callback"],
      token_endpoint_auth_method: "none",
    }),
  );
  const client = auth.register({
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
  });
  assert.throws(() =>
    auth.authorize(
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        resource: "https://different.example/mcp",
      }),
    ),
  );
});
