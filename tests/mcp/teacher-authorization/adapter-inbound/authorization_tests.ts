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
      scope: "teacher offline_access",
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
      refresh_token: token.refresh_token!,
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

function fixture(
  auth: ReturnType<typeof createTeacherAuthorization>,
  scope = "teacher",
) {
  const client = auth.register({
    client_name: "Unverified fixture name",
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
  });
  const verifier = "v".repeat(64);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "https://client.example/callback",
    resource: auth.resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope,
  });
  const grant = auth.authorize(params);
  const exchange = () =>
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      resource: auth.resource,
      code: new URL(auth.redirect(grant.ticket)!).searchParams.get("code")!,
      code_verifier: verifier,
    });
  return { client, grant, params, exchange };
}

test(
  "teacher-only consent never grants offline " +
    "access or refresh tokens",
  () => {
  const auth = createTeacherAuthorization("https://teacher.example/mcp");
  const setup = fixture(auth);
  const pending = auth.pending()[0]!;
  assert.equal(pending.scope, "teacher");
  assert.equal(pending.identityVerified, false);
  assert.equal(pending.clientId, setup.client.client_id);
  auth.approve(setup.grant.id);
  const originalRedirect = auth.redirect(setup.grant.ticket);
  assert.throws(
    () => auth.approve(setup.grant.id),
    /authorization-already-approved/u,
  );
  assert.equal(auth.redirect(setup.grant.ticket), originalRedirect);
  const token = auth.exchange(setup.exchange());
  assert.equal(token.scope, "teacher");
  assert.equal("refresh_token" in token, false);
  assert.equal(auth.connections()[0]!.id, setup.grant.id);
  auth.revoke(setup.grant.id);
  assert.equal(auth.authenticate("Bearer " + token.access_token), false);
  assert.deepEqual(auth.connections(), []);
});

test(
  "scopes, duplicate parameters and exact " +
    "redirects fail before consent",
  () => {
  const auth = createTeacherAuthorization("https://teacher.example/mcp");
  const setup = fixture(auth);
  for (const scope of [
    "",
    "offline_access",
    "teacher admin",
    "teacher teacher",
    "teacher  offline_access",
  ])
    assert.throws(() =>
      auth.authorize(
        new URLSearchParams({
          ...Object.fromEntries(setup.params),
          scope,
        }),
      ),
    );
  const duplicate = new URLSearchParams(setup.params);
  duplicate.append("resource", auth.resource);
  assert.throws(() => auth.authorize(duplicate));
  const different = new URLSearchParams(setup.params);
  different.set("redirect_uri", "https://client.example/callback/other");
  assert.throws(() => auth.authorize(different));
  auth.reject(setup.grant.id);
  assert.deepEqual(auth.pending(), []);
  assert.throws(() => auth.approve(setup.grant.id));
});

test(
  "expiration and individual revocation " +
    "invalidate access and refresh",
  () => {
  let now = 1000;
  const auth = createTeacherAuthorization("https://teacher.example/mcp", {
    now: () => now,
  });
  const expired = fixture(auth);
  now += 300_000;
  assert.throws(() => auth.approve(expired.grant.id));
  const setup = fixture(auth, "teacher offline_access");
  auth.approve(setup.grant.id);
  const token = auth.exchange(setup.exchange());
  now += 3_600_000;
  assert.equal(auth.authenticate("Bearer " + token.access_token), false);
  const refresh = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: setup.client.client_id,
    resource: auth.resource,
    refresh_token: token.refresh_token!,
  });
  const escalated = new URLSearchParams(refresh);
  escalated.set("scope", "teacher offline_access admin");
  assert.throws(() => auth.exchange(escalated));
  const next = auth.exchange(refresh);
  assert.equal(next.scope, "teacher offline_access");
  assert.throws(() => auth.exchange(refresh));
  auth.revoke(setup.grant.id);
  assert.equal(auth.authenticate("Bearer " + next.access_token), false);
  assert.throws(() =>
    auth.exchange(
      new URLSearchParams({
        ...Object.fromEntries(refresh),
        refresh_token: next.refresh_token!,
      }),
    ),
  );
});

test(
  "unused registrations expire rather than " +
    "permanently exhausting capacity",
  () => {
  let now = 1000;
  const auth = createTeacherAuthorization("https://teacher.example/mcp", {
    now: () => now,
  });
  const registration = {
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
  };
  for (let index = 0; index < 100; index++) auth.register(registration);
  assert.throws(() => auth.register(registration));
  now += 900_000;
  assert.ok(auth.register(registration).client_id);
});
