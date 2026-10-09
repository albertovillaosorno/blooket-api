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
//   - Journaled installation and guarded recovery regression coverage.
// - Must-Not:
//   - Imply Apple assessment or real product restart from test doubles.
// - Allows:
//   - Inputs: Controlled failures and durable test installation facts.
//   - Outputs: Assertions for completion, preservation, and recovery stops.
//   - Side effects: Automatically managed test files and native exchanges.
// - Split-When:
//   - Product installer integration has an independent runtime boundary.
// - Merge-When:
//   - Installation no longer crosses service process lifetimes.
// - Summary:
//   - Exercises actual journal locks and Linux exchanges with synthetic health.
// - Description:
//   - Uncertain acknowledgements never authorize blind exchange replay.
// - Usage:
//   - Run before enabling any independent product installer composition.
// - Defaults:
//   - Unproven ownership, trust, writer completion, or health fail closed.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createUpdateInstallationController } from
  "../../../../src/api/application-updates/application/install.ts";
import { acquireUpdatePublicationBoundary } from
  "../../../../src/api/application-updates/application/publication-boundary.ts";
import { openUpdateInstallationStore } from
  "../../../../src/platforms/update-journals/adapter-outbound/store.ts";
import { withFixture } from "./installation-fixtures.ts";

function stopped(reason: string, phase = "prepared") {
  return { status: "installation-stopped", reason, phase };
}
function deferred() { return Promise.withResolvers<void>(); }

test("real native exchange retains the old app and durable healthy phase",
  async () => { await withFixture(async f => {
    const result = await f.controller().run();
    assert.deepEqual(result, { status: "applied", phase: "new-healthy",
      version: "26.4.1", installationId: f.authority.installationId });
    assert.deepEqual(f.phases,
      ["exchange-intent", "new-observed", "new-healthy"]);
    assert.equal(await readFile(join(f.options.candidatePath, "marker"),
      "utf8"), "old version");
    assert.equal((await f.store.read())!.phase, "new-healthy");
    assert.deepEqual(await openUpdateInstallationStore(f.directory),
      { ok: false, reason: "busy" });
    assert.deepEqual(await acquireUpdatePublicationBoundary(f.root),
      { ok: false, reason: "publication-busy" });
  }, true); });

test("failed candidate health performs one inverse and preserves both apps",
  async () => { await withFixture(async f => {
    const healthy = f.ports.startAndCheck;
    f.ports.startAndCheck = async (target, nonce) => target.kind === "new"
      ? { status: "unhealthy" } : healthy(target, nonce);
    const result = await f.controller().run();
    assert.equal(result.status, "old-running");
    assert.deepEqual(f.phases, ["exchange-intent", "new-observed",
      "rollback-intent", "old-observed", "old-healthy"]);
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      ["exchange:forward", "exchange:rollback"]);
    assert.equal(await readFile(join(f.options.installedPath, "marker"),
      "utf8"), "old version");
    assert.equal(await readFile(join(f.options.candidatePath, "marker"),
      "utf8"), "new version");
    const before = [...f.events];
    assert.equal((await f.controller().run()).status, "old-running");
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      before.filter(event => event.startsWith("exchange:")));
  }, true); });

test("lost forward acknowledgement is independently observed without replay",
  async () => { await withFixture(async f => {
    const exchange = f.ports.exchange;
    f.ports.exchange = async (...args) => {
      await exchange(...args); throw new Error("acknowledgement-lost");
    };
    assert.equal((await f.controller().run()).status, "applied");
    assert.equal((await f.controller().run()).status, "applied");
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      ["exchange:forward"]);
    assert.equal(f.events.filter(event => event === "health:new").length, 2);
  }, true); });

test("failed forward exchange checks the still installed old app once",
  async () => { await withFixture(async f => {
    f.ports.exchange = async () => { throw new Error("native-failed"); };
    assert.equal((await f.controller().run()).status, "old-running");
    assert.deepEqual(f.phases,
      ["exchange-intent", "old-observed", "old-healthy"]);
    assert.equal(f.state.orientation, "original");
    assert.equal((await f.controller().run()).status, "old-running");
    assert.equal(f.events.includes("exchange:rollback"), false);
  }); });

test("cancellation during native work retains ownership until closure",
  async () => { await withFixture(async f => {
    const entered = deferred(), closed = deferred();
    const signal = new AbortController(), exchange = f.ports.exchange;
    f.ports.exchange = async (direction, record, cancellation) => {
      if (direction === "forward") {
        f.state.stopped = false; entered.resolve(); await closed.promise;
        f.state.stopped = true;
      } else assert.equal(cancellation, undefined);
      await exchange(direction, record);
    };
    const controller = f.controller();
    const operation = controller.run(signal.signal);
    assert.equal(controller.run(), operation);
    await entered.promise; signal.abort();
    let settled = false; void operation.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal((await f.store.read())!.phase, "exchange-intent");
    assert.deepEqual(await openUpdateInstallationStore(f.directory),
      { ok: false, reason: "busy" });
    assert.deepEqual(await acquireUpdatePublicationBoundary(f.root),
      { ok: false, reason: "publication-busy" });
    closed.resolve();
    assert.equal((await operation).status, "old-running");
    assert.equal(f.events.includes("health:new"), false);
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      ["exchange:forward", "exchange:rollback"]);
  }); });

test("cancellation during health cannot commit a late candidate success",
  async () => { await withFixture(async f => {
    const signal = new AbortController(), healthy = f.ports.startAndCheck;
    f.ports.startAndCheck = async (target, nonce) => {
      if (target.kind === "new") signal.abort();
      return healthy(target, nonce);
    };
    const result = await f.controller().run(signal.signal);
    assert.equal(result.status, "old-running");
    assert.equal(f.phases.includes("new-healthy"), false);
  }); });

test("prepared cancellation does not stop service or mutate the journal",
  async () => { await withFixture(async f => {
    const signal = AbortSignal.abort();
    assert.deepEqual(await f.controller().run(signal), stopped("cancelled"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.phases, []);
  }); });

test("cancellation after intent restarts old without beginning an exchange",
  async () => { await withFixture(async f => {
    const signal = new AbortController(), journal = f.ports.journal;
    f.ports.journal = { ...journal, replace: async (expected, next) => {
      await journal.replace(expected, next);
      if (next.phase === "exchange-intent") signal.abort();
    } };
    const result = await f.controller().run(signal.signal);
    assert.equal(result.status, "old-running");
    assert.equal(f.events.some(event => event.startsWith("exchange:")), false);
  }); });

test("authority is copied before asynchronous admission and never reread",
  async () => { await withFixture(async f => {
    const entered = deferred(), release = deferred();
    f.ports.ownership = async () => {
      entered.resolve(); await release.promise; return { status: "owned" };
    };
    const operation = f.controller().run(); await entered.promise;
    f.authority.installedPath = "/foreign/Blooket API.app";
    f.authority.document.manifest.sourceCommit = "b".repeat(40);
    release.resolve();
    assert.equal((await operation).status, "applied");
    assert.equal((await f.store.read())!.document.manifest.sourceCommit,
      "a".repeat(40));
  }); });

test("invalid or resumed authority cannot grant installation ownership",
  async () => { await withFixture(async f => {
    for (const authority of [null, {}, { ...f.authority, phase: "new-healthy" },
      { ...f.authority, unknown: true }]) {
      assert.deepEqual(await createUpdateInstallationController(authority,
        f.ports).run(), { status: "installation-stopped",
        reason: "invalid-authority" });
    }
    assert.deepEqual(f.events, []);
  }); });

test("a valid foreign journal cannot redefine locally owned paths or facts",
  async () => { await withFixture(async f => {
    for (const change of [
      { installedIdentity: { ...f.authority.installedIdentity, inode: "99" } },
      { document: { ...f.authority.document, keyId: "b".repeat(64) } },
    ]) {
      f.ports.journal = { ...f.ports.journal,
        read: async () => ({ ...f.authority, ...change }) };
      assert.deepEqual(await f.controller().run(),
        stopped("authority-mismatch"));
    }
    assert.deepEqual(f.events, []);
  }); });

test("unknown, missing, and malformed journal state remains preserved",
  async () => { await withFixture(async f => {
    for (const read of [undefined, {}, { ...f.authority, unexpected: 1 }]) {
      f.ports.journal = { ...f.ports.journal, read: async () => read };
      const result = await f.controller().run();
      assert.deepEqual(result, { status: "installation-stopped",
        reason: "journal" });
    }
    assert.equal((await f.store.read())!.phase, "prepared");
    assert.deepEqual(f.events, []);
  }); });

test("ownership, writer completion, and durable identities are mandatory",
  async () => { await withFixture(async f => {
    f.state.owned = false;
    assert.deepEqual(await f.controller().run(), {
      status: "installation-stopped", reason: "ownership" });
    f.state.owned = true; f.state.stopped = false;
    assert.deepEqual(await f.controller().run(), stopped("writer"));
    f.state.stopped = true; f.state.orientation = "unknown";
    assert.deepEqual(await f.controller().run(), stopped("orientation"));
    f.state.orientation = "original"; f.state.durable = false;
    assert.deepEqual(await f.controller().run(), stopped("durability"));
    assert.deepEqual(f.events, []);
  }); });

test("extra fields and coercions cannot satisfy installation boundary proof",
  async () => { await withFixture(async f => {
    f.ports.ownership = async () => ({ status: "owned", pid: 1 });
    assert.equal((await f.controller().run()).status, "installation-stopped");
    f.ports.ownership = async () => ({ status: "owned" });
    for (const value of [
      { orientation: "original", durable: "true" },
      { orientation: "original", durable: true, pid: 1 },
    ]) {
      f.ports.inspect = async () => value;
      assert.deepEqual(await f.controller().run(), stopped("orientation"));
    }
    assert.deepEqual(f.events, []);
  }); });

test("failed candidate assessment never quiesces or exchanges",
  async () => { await withFixture(async f => {
    for (const assessment of [undefined,
      { status: "verified", version: "26.4.0" },
      { status: "verified", version: "26.4.1", trusted: true }]) {
      f.ports.assess = async () => assessment;
      assert.deepEqual(await f.controller().run(), stopped("assessment"));
    }
    assert.equal(f.events.includes("quiesce"), false);
    assert.deepEqual(f.phases, []);
  }); });

test("candidate is reassessed after quiescence before any native write",
  async () => { await withFixture(async f => {
    const assess = f.ports.assess; let candidateChecks = 0;
    f.ports.assess = async (target, record) => {
      if (target.kind === "new" && ++candidateChecks === 2)
        return { status: "untrusted" };
      return assess(target, record);
    };
    assert.equal((await f.controller().run()).status, "old-running");
    assert.equal(candidateChecks, 2);
    assert.equal(f.events.some(event => event.startsWith("exchange:")), false);
  }); });

test("failed quiescence preserves prepared intent without an exchange",
  async () => { await withFixture(async f => {
    f.ports.quiesce = async () => ({ status: "quiesced", pid: 1 });
    assert.deepEqual(await f.controller().run(), stopped("quiescence"));
    assert.deepEqual(f.phases, []);
    assert.equal(f.state.orientation, "original");
  }); });

test("cancellation during reassessment prevents initiating a native writer",
  async () => { await withFixture(async f => {
    const signal = new AbortController(), assess = f.ports.assess;
    let candidateChecks = 0;
    f.ports.assess = async (target, record) => {
      const result = await assess(target, record);
      if (target.kind === "new" && ++candidateChecks === 2) signal.abort();
      return result;
    };
    const result = await f.controller().run(signal.signal);
    assert.equal(result.status, "old-running");
    assert.equal(f.events.some(event => event.startsWith("exchange:")), false);
    assert.equal(f.state.orientation, "original");
  }); });

test("ownership lost after exchange retains intent without claiming health",
  async () => { await withFixture(async f => {
    const exchange = f.ports.exchange;
    f.ports.exchange = async (...args) => {
      await exchange(...args); f.state.owned = false;
    };
    assert.deepEqual(await f.controller().run(),
      stopped("ownership", "exchange-intent"));
    assert.equal(f.events.includes("health:new"), false);
    assert.equal(f.state.orientation, "exchanged");
    assert.deepEqual(await openUpdateInstallationStore(f.directory),
      { ok: false, reason: "busy" });
  }); });

test("a running post-exchange writer prevents observation and health",
  async () => { await withFixture(async f => {
    const exchange = f.ports.exchange;
    f.ports.exchange = async (...args) => {
      await exchange(...args); f.state.stopped = false;
    };
    assert.deepEqual(await f.controller().run(),
      stopped("writer", "exchange-intent"));
    assert.equal(f.events.includes("health:new"), false);
    assert.equal(f.phases.includes("new-observed"), false);
  }); });

test("contradictory prepared orientation cannot authorize either exchange",
  async () => { await withFixture(async f => {
    f.state.orientation = "exchanged";
    assert.deepEqual(await f.controller().run(), stopped("orientation"));
    assert.deepEqual(f.events, []); assert.deepEqual(f.phases, []);
  }); });

test("journal failure before exchange stops without losing original facts",
  async () => { await withFixture(async f => {
    f.ports.journal = { ...f.ports.journal, replace: async () => {
      throw new Error("disk-full");
    } };
    assert.deepEqual(await f.controller().run(), stopped("journal"));
    assert.equal(f.state.orientation, "original");
    assert.equal((await f.store.read())!.phase, "prepared");
  }); });

test("journal failure after exchange recovers by observation without replay",
  async () => { await withFixture(async f => {
    const journal = f.ports.journal;
    f.ports.journal = { ...journal, replace: async (expected, next) => {
      if (next.phase === "new-observed") throw new Error("disk-full");
      await journal.replace(expected, next);
    } };
    assert.deepEqual(await f.controller().run(),
      stopped("journal", "exchange-intent"));
    assert.equal(f.state.orientation, "exchanged");
    f.ports.journal = journal;
    assert.equal((await f.controller().run()).status, "applied");
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      ["exchange:forward"]);
  }); });

test("unknown or nondurable post-write observations preserve exchange intent",
  async () => { await withFixture(async f => {
    f.ports.exchange = async () => { f.state.orientation = "unknown"; };
    assert.deepEqual(await f.controller().run(),
      stopped("orientation", "exchange-intent"));
    assert.equal((await f.store.read())!.phase, "exchange-intent");
    f.state.orientation = "exchanged"; f.state.durable = false;
    assert.deepEqual(await f.controller().run(),
      stopped("durability", "exchange-intent"));
    assert.equal(f.events.includes("health:new"), false);
  }); });

test("wrong version, stale nonce, and extra health fields cause rollback",
  async () => {
    for (const wrong of ["version", "nonce", "extra"]) {
      await withFixture(async f => {
        const healthy = f.ports.startAndCheck;
        f.ports.startAndCheck = async (target, nonce) => target.kind === "old"
          ? healthy(target, nonce) : { status: "healthy",
            version: wrong === "version" ? "26.4.0" : target.version,
            nonce: wrong === "nonce" ? "stale" : nonce,
            ...(wrong === "extra" ? { pid: 1 } : {}) };
        assert.equal((await f.controller().run()).status, "old-running");
        assert.equal(f.events.includes("exchange:rollback"), true);
      });
    }
  });

test("persisted candidate health is reassessed and stale health can rollback",
  async () => { await withFixture(async f => {
    const controller = f.controller();
    assert.equal((await controller.run()).status, "applied");
    const healthy = f.ports.startAndCheck;
    f.ports.startAndCheck = async (target, nonce) => target.kind === "new"
      ? { status: "unhealthy" } : healthy(target, nonce);
    assert.equal((await controller.run()).status, "old-running");
    assert.deepEqual(f.events.filter(event => event.startsWith("exchange:")),
      ["exchange:forward", "exchange:rollback"]);
  }); });

test("untrusted old bundle preserves intent without stopping candidate",
  async () => { await withFixture(async f => {
    const assess = f.ports.assess;
    f.ports.assess = async (target, record) => target.kind === "old"
      ? { status: "untrusted" } : assess(target, record);
    f.ports.startAndCheck = async () => ({ status: "unhealthy" });
    assert.deepEqual(await f.controller().run(),
      stopped("assessment", "rollback-intent"));
    assert.equal(f.events.filter(event => event === "quiesce").length, 1);
    assert.equal(f.events.includes("exchange:rollback"), false);
    assert.equal(f.state.orientation, "exchanged");
  }); });

test("failed inverse retains rollback intent and both apps without looping",
  async () => { await withFixture(async f => {
    const exchange = f.ports.exchange;
    f.ports.exchange = async (direction, ...rest) => {
      if (direction === "rollback") throw new Error("inverse-failed");
      await exchange(direction, ...rest);
    };
    f.ports.startAndCheck = async () => ({ status: "unhealthy" });
    assert.deepEqual(await f.controller().run(),
      stopped("exchange", "rollback-intent"));
    assert.equal(f.state.orientation, "exchanged");
    assert.equal((await f.store.read())!.phase, "rollback-intent");
  }); });

test("interrupted recovery checks actual orientation before selecting a writer",
  async () => {
    for (const orientation of ["original", "exchanged"] as const) {
      await withFixture(async f => {
        await f.advance("exchange-intent");
        await f.advance("new-observed");
        await f.advance("rollback-intent");
        f.state.orientation = orientation;
        assert.equal((await f.controller().run()).status, "old-running");
        const exchanges = f.events.filter(event =>
          event.startsWith("exchange:"));
        assert.deepEqual(exchanges,
          orientation === "original" ? [] : ["exchange:rollback"]);
      });
    }
  });

test("fresh orientation after health is mandatory before committing success",
  async () => { await withFixture(async f => {
    const healthy = f.ports.startAndCheck;
    f.ports.startAndCheck = async (target, nonce) => {
      const result = await healthy(target, nonce);
      f.state.orientation = "unknown"; return result;
    };
    assert.deepEqual(await f.controller().run(),
      stopped("orientation", "new-observed"));
    assert.equal(f.phases.includes("new-healthy"), false);
  }); });

test("original unhealthy app never acquires a persisted healthy claim",
  async () => { await withFixture(async f => {
    await f.advance("exchange-intent");
    f.ports.startAndCheck = async () => ({ status: "healthy", nonce: "stale",
      version: "26.4.0" });
    assert.deepEqual(await f.controller().run(),
      stopped("health", "old-observed"));
    assert.equal(f.phases.includes("old-healthy"), false);
    assert.equal(f.events.some(event => event.startsWith("exchange:")), false);
  }); });
