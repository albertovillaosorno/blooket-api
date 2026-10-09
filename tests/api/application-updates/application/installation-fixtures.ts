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
//   - Portable installation fixtures with real journal and exchange adapters.
// - Must-Not:
//   - Imply Apple assessment or real product restart from test doubles.
// - Allows:
//   - Inputs: Test-selected native exchange execution.
//   - Outputs: Owned fixtures and explicit synthetic lifecycle ports.
//   - Side effects: Automatically managed test files and ephemeral keys.
// - Split-When:
//   - Actual product lifecycle integration has independent fixtures.
// - Merge-When:
//   - Installation fixtures no longer need multiple test cases.
// - Summary:
//   - Holds real publication and journal locks until test cleanup.
// - Description:
//   - Native Linux exchange is not native Mac or Apple trust acceptance.
// - Usage:
//   - Await every controller operation before fixture cleanup.
// - Defaults:
//   - Lifecycle and Apple assessment remain explicitly synthetic.
//
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createUpdateInstallationController } from
  "../../../../src/api/application-updates/application/install.ts";
import type { UpdateInstallationPorts } from
  "../../../../src/api/application-updates/contract/installation.ts";
import { acquireUpdatePublicationBoundary } from
  "../../../../src/api/application-updates/application/publication-boundary.ts";
import { openUpdateInstallationStore } from
  "../../../../src/platforms/update-journals/adapter-outbound/store.ts";
import { exchangeBundles } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { observeExchange } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { syncDirectory } from
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts";
import { manifestSigningBytes, publisherFingerprint,
  verifySignedUpdateManifest } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { advanceUpdateInstallationJournal, type InstallationPhase,
  type ExchangeOrientation } from
  "../../../../src/ir/application-updates/contract/installation.ts";
import { journalFixture } from
  "../../../ir/application-updates/contract/fixtures.ts";
import { fixture as exchangeFixture } from
  "../../../platforms/bundle-exchange/adapter-outbound/fixtures.ts";

export async function fixture(native = false) {
  const files = await exchangeFixture(native);
  const directory = join(files.root, "journal");
  const opened = await openUpdateInstallationStore(directory);
  assert.ok(opened.ok);
  const store = opened.store;
  const publication = await acquireUpdatePublicationBoundary(files.root);
  assert.ok(publication.ok);
  const authority = { ...journalFixture(),
    installationId: basename(files.prepared)
      .slice(".blooket-api.update-".length),
    installedPath: files.options.installedPath,
    candidatePath: files.options.candidatePath,
    installedIdentity: files.options.installedIdentity,
    candidateIdentity: files.options.candidateIdentity };
  const keys = generateKeyPairSync("ed25519");
  authority.document.keyId = publisherFingerprint(keys.publicKey);
  authority.document.signature = sign(null,
    manifestSigningBytes(authority.document.manifest), keys.privateKey)
    .toString("base64url");
  assert.equal(await store.create(authority), "created");
  const data = join(files.root, "teacher-data");
  await writeFile(data, "preserved synthetic settings, drafts, and references");
  const events: string[] = [], phases: InstallationPhase[] = [];
  const state = { orientation: "original" as ExchangeOrientation,
    durable: true, owned: true, stopped: true };
  const ports: UpdateInstallationPorts = {
    journal: { read: () => store.read(), replace: async (expected, next) => {
      await store.replace(expected, next);
      phases.push(next.phase); events.push("phase:" + next.phase);
    } },
    ownership: async () => ({ status: state.owned ? "owned" : "lost" }),
    settleNativeWriter: async () => ({
      status: state.stopped ? "stopped" : "running" }),
    inspect: async () => {
      if (native) {
        state.orientation = await observeExchange(files.options);
        await syncDirectory(dirname(authority.installedPath));
        await syncDirectory(dirname(authority.candidatePath));
      }
      return { orientation: state.orientation, durable: state.durable };
    },
    assess: async (target, record) => {
      events.push("assess:" + target.kind);
      if (target.kind === "new") {
        const manifest = record.document.manifest, asset = manifest.assets[0]!;
        assert.ok(verifySignedUpdateManifest({ document: record.document,
          trustedKeys: [keys.publicKey], release: {
            version: manifest.version, tag: manifest.tag,
            target: "darwin-arm64", asset: { id: 1, name: asset.name,
              size: asset.size, state: "uploaded", url: asset.url } } }).ok);
      }
      // Apple assessment and runtime health are explicitly synthetic here.
      return { status: "verified", version: target.version };
    },
    quiesce: async () => {
      events.push("quiesce"); return { status: "quiesced" };
    },
    exchange: async (direction, record, signal) => {
      assert.equal((await store.read())!.phase, direction === "forward"
        ? "exchange-intent" : "rollback-intent");
      assert.ok(Object.isFrozen(record));
      events.push("exchange:" + direction);
      if (native) {
        const rollback = direction === "rollback";
        const result = await exchangeBundles({ ...files.options,
          installedIdentity: rollback ? authority.candidateIdentity
            : authority.installedIdentity,
          candidateIdentity: rollback ? authority.installedIdentity
            : authority.candidateIdentity, ...(signal ? { signal } : {}) });
        assert.equal(result.status, "exchanged");
      }
      state.orientation = direction === "forward" ? "exchanged" : "original";
    },
    startAndCheck: async (target, nonce) => {
      events.push("health:" + target.kind);
      if (native) assert.equal(await readFile(join(target.path, "marker"),
        "utf8"), target.kind + " version");
      return { status: "healthy", version: target.version, nonce };
    },
  };
  return { ...files, directory, store, authority, state, ports, events, phases,
    controller: () => createUpdateInstallationController(authority, ports),
    async advance(phase: InstallationPhase) {
      const current = (await store.read())!;
      const next = advanceUpdateInstallationJournal(current, phase);
      assert.ok(next.ok); await store.replace(current, next.value);
    },
    async cleanup() {
      try {
        assert.equal(await readFile(data, "utf8"),
          "preserved synthetic settings, drafts, and references");
      } finally {
        await store.close(); await publication.release(); await files.cleanup();
      }
    },
  };
}

export async function withFixture(
  work: (owned: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  native = false,
) {
  const owned = await fixture(native);
  try { await work(owned); } finally { await owned.cleanup(); }
}
