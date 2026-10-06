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
//   - Behavioral tests for macOS and Linux host secret-store command lowering.
// - Must-Not:
//   - Touch the real Keychain, Secret Service, or persist fixture credentials.
// - Allows:
//   - Inputs: Fake command results and fixed secret values.
//   - Outputs: Stable storage verdicts and captured fake invocations.
//   - Side effects: In-memory invocation capture only.
// - Split-When:
//   - A Windows backend adds independently reviewed command semantics.
// - Merge-When:
//   - Host secret storage no longer delegates to OS command clients.
// - Summary:
//   - Proves secrets stay out of argv and backend errors stay secret-free.
// - Description:
//   - Uses an injected command runner so tests never touch the host keyring.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Fake successful reads return the repository's v1 encoded envelope.
//
import assert from "node:assert/strict";
import test from "node:test";

import { HOST_SECRET_MAX_BYTES } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";
import {
  createHostSecretStore,
  deleteHostSecret,
  readHostSecret,
  writeHostSecret,
} from
  // jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import type {
  SecretCommandInvocation,
  SecretCommandResult,
} from
  // jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/platforms/host-secret-store/adapter-outbound/command-runner.ts";

const SECRET = "teacher-password-é";
const STORED = "v1."
  + Buffer.from(SECRET, "utf8").toString("base64url");

test("new macOS secrets never place secret material in argv", async () => {
  const fake = fakeRunner([
    result(44),
    result(0),
    result(0, STORED + "\n"),
  ]);

  assert.deepEqual(
    await writeHostSecret("blooket-password", SECRET, {
      platform: "darwin",
      runner: fake.run,
    }),
    { ok: true },
  );

  assert.equal(fake.calls.length, 3);
  for (const call of fake.calls) {
    assert.equal(call.args.join(" ").includes(SECRET), false);
    assert.equal(call.args.join(" ").includes(STORED), false);
  }
  const write = fake.calls[1];
  assert.deepEqual(write?.args, ["-i"]);
  const stdin = Buffer.from(write?.stdin ?? []).toString("utf8");
  assert.equal(stdin.includes(SECRET), false);
  assert.equal(stdin.includes(STORED), true);
  assert.equal(stdin.includes("-T /usr/bin/security"), true);
});

test("maximum macOS secrets stay within the stdin command bound", async () => {
  const secret = "x".repeat(HOST_SECRET_MAX_BYTES);
  const stored = "v1."
    + Buffer.from(secret, "utf8").toString("base64url");
  const fake = fakeRunner([
    result(44),
    result(0),
    result(0, stored),
  ]);

  assert.deepEqual(
    await writeHostSecret("maximum-secret", secret, {
      platform: "darwin",
      runner: fake.run,
    }),
    { ok: true },
  );

  const command = fake.calls[1]?.stdin;
  assert.notEqual(command, undefined);
  assert.ok((command?.byteLength ?? Number.MAX_SAFE_INTEGER) < 4096);
});

test("invalid secret values fail before host commands", async () => {
  const fake = fakeRunner([]);
  assert.deepEqual(
    await writeHostSecret("blooket-password", "", {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: false, code: "host-secret-empty" },
  );
  assert.deepEqual(
    await writeHostSecret(
      "blooket-password",
      "x".repeat(HOST_SECRET_MAX_BYTES + 1),
      { platform: "linux", runner: fake.run },
    ),
    { ok: false, code: "host-secret-too-large" },
  );
  assert.equal(fake.calls.length, 0);
});

test("existing macOS secrets update without replacing ACLs", async () => {
  const fake = fakeRunner([
    result(0),
    result(0),
    result(0, STORED),
  ]);

  assert.deepEqual(
    await writeHostSecret("blooket-password", SECRET, {
      platform: "darwin",
      runner: fake.run,
    }),
    { ok: true },
  );

  const stdin = Buffer.from(
    fake.calls[1]?.stdin ?? [],
  ).toString("utf8");
  assert.equal(stdin.includes(" -U "), true);
  assert.equal(stdin.includes(" -T "), false);
});

test("macOS missing reads and deletes are idempotent", async () => {
  const readFake = fakeRunner([result(44)]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "darwin",
      runner: readFake.run,
    }),
    { ok: true, kind: "missing" },
  );

  const deleteFake = fakeRunner([result(44)]);
  assert.deepEqual(
    await deleteHostSecret("blooket-password", {
      platform: "darwin",
      runner: deleteFake.run,
    }),
    { ok: true },
  );
});

test("Linux stores encoded secrets only through stdin", async () => {
  const fake = fakeRunner([
    result(0),
    result(0, STORED),
  ]);

  assert.deepEqual(
    await writeHostSecret("blooket-password", SECRET, {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: true },
  );

  const write = fake.calls[0];
  assert.equal(write?.command, "/usr/bin/secret-tool");
  assert.equal(write?.args.join(" ").includes(SECRET), false);
  assert.equal(write?.args.join(" ").includes(STORED), false);
  assert.equal(
    Buffer.from(write?.stdin ?? []).toString("utf8"),
    STORED,
  );
});

test("Linux missing deletes are idempotent", async () => {
  const fake = fakeRunner([result(1)]);
  assert.deepEqual(
    await deleteHostSecret("blooket-password", {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: true },
  );
});

test("Linux distinguishes a clean missing lookup from errors", async () => {
  const missing = fakeRunner([result(1)]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "linux",
      runner: missing.run,
    }),
    { ok: true, kind: "missing" },
  );

  const failed = fakeRunner([result(1, "", 42)]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "linux",
      runner: failed.run,
    }),
    { ok: false, code: "host-secret-store-failed" },
  );
});

test("writes fail closed when read-back does not match", async () => {
  const other = "v1."
    + Buffer.from("other", "utf8").toString("base64url");
  const fake = fakeRunner([
    result(0),
    result(0, other),
  ]);

  assert.deepEqual(
    await writeHostSecret("blooket-password", SECRET, {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: false, code: "host-secret-store-failed" },
  );
});

test("command infrastructure failures become stable store codes", async () => {
  const unavailable = fakeRunner([{
    ok: false,
    code: "secret-command-unavailable",
  }]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "linux",
      runner: unavailable.run,
    }),
    { ok: false, code: "host-secret-store-unavailable" },
  );

  const timedOut = fakeRunner([{
    ok: false,
    code: "secret-command-timeout",
  }]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "linux",
      runner: timedOut.run,
    }),
    { ok: false, code: "host-secret-store-failed" },
  );
});

test(
  "stored envelopes require canonical base64url and exact UTF-8",
  async () => {
  const padded = STORED + "=";
  const invalidUtf8 = "v1."
    + Buffer.from([0xff]).toString("base64url");
  const newline = Buffer.from([0x0a]).toString("utf8");
  const doubledNewline = STORED + newline + newline;

  for (const stored of [padded, invalidUtf8, doubledNewline]) {
    const fake = fakeRunner([result(0, stored)]);
    assert.deepEqual(
      await readHostSecret("blooket-password", {
        platform: "linux",
        runner: fake.run,
      }),
      { ok: false, code: "host-secret-data-invalid" },
    );
  }
  },
);

test("stored envelopes accept one platform line ending", async () => {
  const lineEndings = [
    Buffer.from([0x0a]).toString("utf8"),
    Buffer.from([0x0d, 0x0a]).toString("utf8"),
  ];
  for (const ending of lineEndings) {
    const fake = fakeRunner([result(0, STORED + ending)]);
    assert.deepEqual(
      await readHostSecret("blooket-password", {
        platform: "linux",
        runner: fake.run,
      }),
      { ok: true, kind: "found", secret: SECRET },
    );
  }
});

test("Linux delete errors are not mistaken for missing secrets", async () => {
  const fake = fakeRunner([result(1, "", 9)]);
  assert.deepEqual(
    await deleteHostSecret("blooket-password", {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: false, code: "host-secret-store-failed" },
  );
});

test("invalid stored payloads never become caller secrets", async () => {
  const fake = fakeRunner([result(0, "not-our-data\n")]);
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: false, code: "host-secret-data-invalid" },
  );
});

test("store factory implements the security-domain port", async () => {
  const fake = fakeRunner([result(1), result(1)]);
  const store = createHostSecretStore({
    platform: "linux",
    runner: fake.run,
  });

  assert.deepEqual(
    await store.read("blooket-password"),
    { ok: true, kind: "missing" },
  );
  assert.deepEqual(
    await store.delete("blooket-password"),
    { ok: true },
  );
});

test("unsupported hosts and invalid names fail before commands", async () => {
  const fake = fakeRunner([]);
  assert.deepEqual(
    await readHostSecret("bad name", {
      platform: "linux",
      runner: fake.run,
    }),
    { ok: false, code: "invalid-host-secret-name" },
  );
  assert.deepEqual(
    await readHostSecret("blooket-password", {
      platform: "win32",
      runner: fake.run,
    }),
    { ok: false, code: "host-secret-store-unsupported" },
  );
  assert.equal(fake.calls.length, 0);
});

function result(
  exitCode: number,
  stdout = "",
  stderrBytes = 0,
): SecretCommandResult {
  return {
    ok: true,
    exitCode,
    signal: null,
    stdout: Buffer.from(stdout, "utf8"),
    stderrBytes,
  };
}

function fakeRunner(
  results: readonly SecretCommandResult[],
): {
  readonly calls: SecretCommandInvocation[];
  readonly run: (
    invocation: SecretCommandInvocation,
  ) => Promise<SecretCommandResult>;
} {
  const calls: SecretCommandInvocation[] = [];
  let index = 0;
  return {
    calls,
    run: async (invocation) => {
      calls.push(invocation);
      const value = results[index];
      index += 1;
      if (value === undefined) {
        throw new Error("Unexpected fake secret-store invocation.");
      }
      return value;
    },
  };
}
