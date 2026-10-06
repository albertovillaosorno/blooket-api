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
//   - Explicit development configuration and ephemeral secret overrides.
// - Must-Not:
//   - Persist development credentials or enable production dotenv loading.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Explicit development configuration and ephemeral secret overrides.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { developmentConfiguration } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/development-environment/adapter-outbound/environment.ts";
import { defaultTeacherPreferences } from
  "../../../../src/settings/teacher-preferences/domain/preferences.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

const defaults = defaultTeacherPreferences("/tmp/media");
function hostStore() {
  const calls: string[] = [];
  const secrets: HostSecretStore = {
    async read(name) {
      calls.push("read:" + name);
      return { ok: true, kind: "missing" };
    },
    async write(name) {
      calls.push("write:" + name);
      return { ok: true };
    },
    async delete(name) {
      calls.push("delete:" + name);
      return { ok: true };
    },
  };
  return { calls, secrets };
}
test("development configuration keeps credentials ephemeral", async () => {
  const host = hostStore();
  const config = await developmentConfiguration(
    defaults,
    {
      EMAIL: "teacher@example.com",
      PASSWORD: "development-password",
      LOCAL_PORT: "2607",
      ONLINE_DOMAIN: "https://example.com/mcp",
      CLOUDFLARE_TOKEN: "development-tunnel-token",
    },
    host.secrets,
  );
  assert.equal(config.preferences.online.enabled, true);
  assert.equal(config.preferences.service.port, 2607);
  assert.equal(config.preferences.email, "teacher@example.com");
  const json = JSON.stringify(config.preferences);
  assert.equal(json.includes("development-password"), false);
  assert.equal(json.includes("development-tunnel-token"), false);
  assert.deepEqual(await config.secrets.read("cloudflare-tunnel"), {
    ok: true,
    kind: "found",
    secret: "development-tunnel-token",
  });
  assert.deepEqual(host.calls, []);
  await config.secrets.write("cloudflare-tunnel", "replacement");
  await config.secrets.read("cloudflare-tunnel");
  assert.deepEqual(host.calls, [
    "write:cloudflare-tunnel",
    "read:cloudflare-tunnel",
  ]);
});
test(
  "misspelled tokens and invalid port/domain " +
    "fail before writes",
  async () => {
  for (const environment of [
    { CLOUDLFARE_TOKEN: "typo" },
    { LOCAL_PORT: "2607garbage" },
    { LOCAL_PORT: "65536" },
    { LOCAL_PORT: "0" },
    { ONLINE_DOMAIN: "http://example.com/mcp" },
    { ONLINE_DOMAIN: "https://example.com/" },
  ]) {
    const host = hostStore();
    await assert.rejects(() =>
      developmentConfiguration(defaults, environment, host.secrets),
    );
    assert.deepEqual(host.calls, []);
  }
});
test("absent development values preserve saved configuration", async () => {
  const host = hostStore();
  assert.deepEqual(
    (await developmentConfiguration(defaults, {}, host.secrets)).preferences,
    defaults,
  );
});

test(
  "canonical names admit quoted Unicode secrets " + "without persistence",
  async () => {
    const host = hostStore();
    const environment = parseEnv(
      [
        'BLOOKET_EMAIL="teacher@example.com"',
        'BLOOKET_PASSWORD="Contraseña Ç"',
        'LOCAL_HTTP_PORT="2607"',
        'MCP_PUBLIC_URL="https://example.com/mcp"',
        'CLOUDFLARE_TUNNEL_TOKEN="development-token"',
        'MCP_DISPLAY_NAME="Blooket"',
      ].join("\n"),
    );
    const config = await developmentConfiguration(
      defaults,
      environment,
      host.secrets,
    );
    assert.equal(
      config.preferences.online.publicUrl,
      "https://example.com/mcp",
    );
    assert.equal(config.preferences.service.port, 2607);
    assert.deepEqual(await config.secrets.read("blooket.password"), {
      ok: true,
      kind: "found",
      secret: "Contraseña Ç",
    });
    assert.equal(
      JSON.stringify(config.preferences).includes("Contraseña"),
      false,
    );
    assert.deepEqual(host.calls, []);
  },
);
test(
  "conflicting canonical and legacy settings " +
    "fail before writes",
  async () => {
  for (const environment of [
    { BLOOKET_EMAIL: "one@example.com", EMAIL: "two@example.com" },
    { BLOOKET_PASSWORD: "new", PASSWORD: "old" },
    { LOCAL_HTTP_PORT: "2607", LOCAL_PORT: "2608" },
    {
      MCP_PUBLIC_URL: "https://one.example/mcp",
      ONLINE_DOMAIN: "https://two.example/mcp",
    },
    { CLOUDFLARE_TUNNEL_TOKEN: "new", CLOUDFLARE_TOKEN: "old" },
  ]) {
    const host = hostStore();
    await assert.rejects(
      () => developmentConfiguration(defaults, environment, host.secrets),
      /conflicting-development-setting/u,
    );
    assert.deepEqual(host.calls, []);
  }
});
test("the empty example parses and keeps online access disabled", async () => {
  const example = await readFile(
    new URL("../../../../.env.example", import.meta.url),
    "utf8",
  );
  const config = await developmentConfiguration(
    defaults,
    parseEnv(example),
    hostStore().secrets,
  );
  assert.equal(config.preferences.online.enabled, false);
  assert.equal(config.preferences.service.port, 2607);
});

test(
  "development owner passwords produce only an " +
    "ephemeral salted verifier",
  async () => {
  const host = hostStore();
  const config = await developmentConfiguration(
    defaults,
    {
      MCP_OWNER_PASSWORD: "owner-fixture",
      MCP_PASSWORD: "owner-fixture",
    },
    host.secrets,
  );
  const stored = await config.secrets.read("mcp.owner-verifier");
  assert.ok(stored.ok && stored.kind === "found");
  assert.match(stored.secret, /^scrypt-v1\$/u);
  assert.equal(stored.secret.includes("owner-fixture"), false);
  assert.equal(JSON.stringify(config.preferences).includes("owner-"), false);
  assert.deepEqual(host.calls, []);
  await assert.rejects(
    developmentConfiguration(
      defaults,
      {
        MCP_OWNER_PASSWORD: "one",
        MCP_PASSWORD: "two",
      },
      host.secrets,
    ),
    /conflicting-development-setting/u,
  );
});
