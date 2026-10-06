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
import { createHash, randomBytes } from "node:crypto";

interface Client {
  name: string;
  redirects: string[];
  expires: number;
}
interface Grant {
  id: string;
  ticket: string;
  client: string;
  redirect: string;
  state: string;
  challenge: string;
  scope: string[];
  expires: number;
  approved: boolean;
  code?: string;
}
interface Token {
  client: string;
  connection: string;
  redirect: string;
  scope: string[];
  expires: number;
}
export function createTeacherAuthorization(
  publicUrl: string,
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const resource = new URL(publicUrl).href;
  const issuer = new URL(publicUrl).origin;
  const clients = new Map<string, Client>();
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Token>();
  const refreshTokens = new Map<string, Token>();
  const random = () => randomBytes(32).toString("base64url");
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("base64url");
  function prune() {
    for (const [id, grant] of grants)
      if (grant.expires <= now()) grants.delete(id);
    for (const map of [tokens, refreshTokens])
      for (const [id, token] of map) if (token.expires <= now()) map.delete(id);
    for (const [id, client] of clients) {
      const active = [...tokens.values(), ...refreshTokens.values()].some(
        (token) => token.client === id,
      );
      if (client.expires <= now() && !active) {
        clients.delete(id);
        for (const [grantId, grant] of grants)
          if (grant.client === id) grants.delete(grantId);
      }
    }
  }
  function issue(value: Omit<Token, "expires">) {
    prune();
    const offline = value.scope.includes("offline_access");
    if (tokens.size >= 200 || (offline && refreshTokens.size >= 200))
      throw new Error("authorization-capacity");
    const access = random();
    tokens.set(hash(access), { ...value, expires: now() + 3_600_000 });
    let refresh: string | undefined;
    if (offline) {
      refresh = random();
      refreshTokens.set(hash(refresh), {
        ...value,
        expires: now() + 7 * 86_400_000,
      });
    }
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      ...(refresh === undefined ? {} : { refresh_token: refresh }),
      scope: value.scope.join(" "),
    };
  }
  return {
    resource,
    issuer,
    metadata: {
      issuer,
      authorization_endpoint: issuer + "/oauth/authorize",
      token_endpoint: issuer + "/oauth/token",
      registration_endpoint: issuer + "/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["teacher", "offline_access"],
    },
    resourceMetadata: {
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["teacher", "offline_access"],
    },
    register(value: unknown) {
      prune();
      const body = record(value);
      if (
        clients.size >= 100 ||
        !Array.isArray(body["redirect_uris"]) ||
        body["redirect_uris"].length < 1 ||
        body["redirect_uris"].length > 5 ||
        !body["redirect_uris"].every(validRedirect) ||
        body["token_endpoint_auth_method"] !== "none" ||
        (body["client_name"] !== undefined &&
          (typeof body["client_name"] !== "string" ||
            body["client_name"].length > 200))
      )
        throw new Error("invalid-client-metadata");
      const clientId = random();
      clients.set(clientId, {
        name:
          typeof body["client_name"] === "string"
            ? body["client_name"]
            : "MCP client",
        redirects: body["redirect_uris"] as string[],
        expires: now() + 900_000,
      });
      return {
        client_id: clientId,
        client_id_issued_at: Math.floor(now() / 1000),
        token_endpoint_auth_method: "none",
        redirect_uris: body["redirect_uris"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      };
    },
    authorize(params: URLSearchParams) {
      prune();
      uniqueParameters(params);
      const clientId = params.get("client_id") ?? "";
      const client = clients.get(clientId);
      const redirect = params.get("redirect_uri") ?? "";
      const challenge = params.get("code_challenge") ?? "";
      const scope = (params.get("scope") ?? "teacher").split(" ");
      const state = params.get("state") ?? "";
      if (
        !client ||
        !client.redirects.includes(redirect) ||
        params.get("response_type") !== "code" ||
        params.get("code_challenge_method") !== "S256" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(challenge) ||
        params.get("resource") !== resource ||
        !scope.includes("teacher") ||
        scope.some((part) => !["teacher", "offline_access"].includes(part)) ||
        new Set(scope).size !== scope.length ||
        state.length > 2048 ||
        grants.size >= 20
      )
        throw new Error("invalid-authorization-request");
      const grant: Grant = {
        id: randomBytes(8).toString("hex"),
        ticket: random(),
        client: clientId,
        redirect,
        state,
        challenge,
        scope,
        expires: now() + 300_000,
        approved: false,
      };
      grants.set(grant.id, grant);
      return { id: grant.id, ticket: grant.ticket };
    },
    pending() {
      prune();
      return [...grants.values()]
        .filter((grant) => !grant.approved)
        .map((grant) => ({
          id: grant.id,
          client: clients.get(grant.client)!.name,
          clientId: grant.client,
          redirect: grant.redirect,
          scope: grant.scope.join(" "),
          expires: grant.expires,
          identityVerified: false,
        }));
    },
    approve(id: string) {
      prune();
      const grant = grants.get(id);
      if (!grant) throw new Error("authorization-expired");
      if (grant.approved) throw new Error("authorization-already-approved");
      grant.approved = true;
      grant.code = random();
    },
    reject(id: string) {
      grants.delete(id);
    },
    connections() {
      prune();
      const active = new Map<string, Token>();
      for (const token of [...tokens.values(), ...refreshTokens.values()]) {
        const previous = active.get(token.connection);
        if (!previous || previous.expires < token.expires)
          active.set(token.connection, token);
      }
      return [...active.values()].map((token) => ({
        id: token.connection,
        clientId: token.client,
        client: clients.get(token.client)!.name,
        redirect: token.redirect,
        scope: token.scope.join(" "),
        expires: token.expires,
        identityVerified: false,
      }));
    },
    revoke(id: string) {
      grants.delete(id);
      for (const map of [tokens, refreshTokens])
        for (const [key, token] of map)
          if (token.connection === id) map.delete(key);
    },
    redirect(ticket: string): string | undefined {
      prune();
      const grant = [...grants.values()].find(
        (entry) => entry.ticket === ticket,
      );
      if (!grant) throw new Error("authorization-expired");
      if (!grant.approved || !grant.code) return undefined;
      const url = new URL(grant.redirect);
      url.searchParams.set("code", grant.code);
      url.searchParams.set("state", grant.state);
      return url.href;
    },
    exchange(params: URLSearchParams) {
      prune();
      uniqueParameters(params);
      const client = params.get("client_id") ?? "";
      if (params.get("resource") !== resource)
        throw new Error("invalid-target");
      if (params.get("grant_type") === "refresh_token") {
        const key = hash(params.get("refresh_token") ?? "");
        const token = refreshTokens.get(key);
        if (!token || token.client !== client) throw new Error("invalid-grant");
        const requested = params.get("scope");
        if (requested !== null && requested !== token.scope.join(" "))
          throw new Error("invalid-scope");
        const issued = issue(token);
        refreshTokens.delete(key);
        return issued;
      }
      const grant = [...grants.values()].find(
        (entry) => entry.code === params.get("code"),
      );
      const verifier = params.get("code_verifier") ?? "";
      if (
        params.get("grant_type") !== "authorization_code" ||
        !grant ||
        !grant.approved ||
        grant.client !== client ||
        grant.redirect !== params.get("redirect_uri") ||
        !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier) ||
        hash(verifier) !== grant.challenge
      )
        throw new Error("invalid-grant");
      const issued = issue({
        client,
        connection: grant.id,
        redirect: grant.redirect,
        scope: grant.scope,
      });
      grants.delete(grant.id);
      return issued;
    },
    authenticate(header: string | undefined): boolean {
      prune();
      return (
        header?.startsWith("Bearer ") === true &&
        tokens.has(hash(header.slice(7)))
      );
    },
    revokeAll() {
      grants.clear();
      tokens.clear();
      refreshTokens.clear();
      clients.clear();
    },
  };
}
function uniqueParameters(params: URLSearchParams): void {
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    throw new Error("duplicate-oauth-parameter");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid-client-metadata");
  return value as Record<string, unknown>;
}
function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
