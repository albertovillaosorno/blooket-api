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
//   - Canonical read admission and transport regression coverage.
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
//   - Canonical read admission and transport regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startBrowserService } from
  "../../../../src/api/browser-service/adapter-inbound/server.ts";
import { createBlooketBrowserBridgeBroker } from
  "../../../../src/platforms/blooket-browser/adapter-outbound/broker.ts";
import { executeLocalBlooketRead } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/command.ts";
import { executeJsonCommand } from
  "../../../../src/cli/json-command-process/adapter-inbound/execute.ts";
import {
  callTeacherTool,
  listTeacherTools,
} from "../../../../src/mcp/teacher-tools/adapter-inbound/tools.ts";
import { decodeResultEnvelope } from
  "../../../../src/ir/wire-envelopes/contract/result-envelope.ts";

const command = {
  version: 1 as const,
  operationId: "cli:local-read",
  command: "blooket.sets.list",
  payload: {},
};

test("local reads and MCP traverse the real CLI and service bridge",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "canonical-browser-read-"));
  const bridge = createBlooketBrowserBridgeBroker();
  const instance = randomUUID();
  const service = await startBrowserService({
    root,
    port: 0,
    instance,
    browserBridge: bridge,
  });
  let legacyList = false;
  const poll = setInterval(() => {
    const job = bridge.next(bridge.pairingToken());
    if (!job) return;
    const value =
      job.command.kind === "session.observe"
        ? "my-sets"
        : job.command.kind === "capabilities.inspect"
          ? {
              schemaVersion: 3,
              verifiedOn: "2026-10-07",
              evidence: [{
                kind: "browser-observation",
                reference: "synthetic capability fixture",
              }],
              questionTypes: {
                multipleChoice: {
                  availability: "supported",
                  minAnswers: 2,
                  maxAnswers: 4,
                  requiresQuestionText: true,
                  allowsMultipleCorrect: true,
                },
                typingAnswer: {
                  availability: "supported",
                  matchModes: ["exact", "contains"],
                },
              },
              features: {
                questionImages: "supported",
                answerImages: "unsupported",
                audio: "unsupported",
              },
              setMetadata: {
                titleRequired: true,
                descriptionRequired: false,
                titleMaxLength: 75,
                descriptionMaxLength: 300,
                coverImageOptional: true,
                visibility: ["public", "private"],
              },
              upload: {
                maxBytes: 2_500_000,
                canvasWidth: null,
                canvasHeight: null,
                maxPixels: null,
              },
            }
          : job.command.kind === "sets.get"
          ? {
              schemaVersion: 1,
              id: job.command.setId,
              title: "Synthetic quiz",
              description: "Synthetic fixture",
              visibility: "private",
            }
          : job.command.kind === "questions.list"
            ? [{
                schemaVersion: 1,
                number: 1,
                question: "Type sun.",
                qType: "typing",
                random: true,
                timeLimit: 15,
                answers: ["sun"],
                correctAnswers: ["sun"],
                answerTypes: ["exactly"],
                hasImage: false,
                hasAudio: false,
              }]
            : legacyList ? [] : {
                items: [{
                  schemaVersion: 1,
                  id: "fixture",
                  title: "Synthetic quiz",
                }],
                completeness: "unknown",
              };
    assert.ok(
      bridge.complete(bridge.pairingToken(), {
        schemaVersion: 1,
        id: job.id,
        ok: true,
        value,
      }),
    );
  }, 5);
  try {
    await writeFile(
      join(root, "service-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        instance,
        origin: service.origin,
      }),
    );
    const direct = await executeLocalBlooketRead(command, root);
    assert.equal(direct.ok, true);
    const cli = await executeJsonCommand(
      command.command,
      command.payload,
      command.operationId,
      root,
    );
    assert.deepEqual(cli, direct);
    const mcp = await callTeacherTool("blooket_sets_list", {}, root);
    assert.equal(mcp.isError, false);
    const result = decodeResultEnvelope(JSON.parse(mcp.content[0]!.text));
    assert.equal(result.ok, true);
    if (result.ok && result.value.ok && direct.ok)
      assert.deepEqual(result.value.value, direct.value);
    const capabilities = await callTeacherTool(
      "blooket_capabilities_inspect",
      {},
      root,
    );
    assert.equal(capabilities.isError, false);
    const capabilityResult = decodeResultEnvelope(
      JSON.parse(capabilities.content[0]!.text),
    );
    assert.equal(capabilityResult.ok, true);
    if (capabilityResult.ok && capabilityResult.value.ok) {
      const value = capabilityResult.value.value as {
        readonly kind?: string;
        readonly value?: { readonly features?: { readonly audio?: string } };
      };
      assert.equal(value.kind, "capabilities");
      assert.equal(value.value?.features?.audio, "unsupported");
    }
    const detail = await callTeacherTool(
      "blooket_sets_get",
      { setId: "fixture" },
      root,
    );
    assert.equal(detail.isError, false);
    const questions = await callTeacherTool(
      "blooket_questions_list",
      { setId: "fixture" },
      root,
    );
    assert.equal(questions.isError, false);
    assert.equal(
      listTeacherTools().filter((tool) => tool.name.startsWith("blooket_"))
        .length,
      9,
    );
    assert.equal(JSON.stringify(mcp).includes(bridge.pairingToken()), false);
    legacyList = true;
    const incompatible = await executeJsonCommand(
      command.command, command.payload, command.operationId, root,
    );
    assert.equal(incompatible.ok, false);
    if (!incompatible.ok)
      assert.equal(incompatible.issues[0]?.code,
        "blooket-browser-incompatible");
    const incompatibleMcp = await callTeacherTool(
      "blooket_sets_list", {}, root,
    );
    assert.equal(incompatibleMcp.isError, true);
    const decoded = decodeResultEnvelope(
      JSON.parse(incompatibleMcp.content[0]!.text),
    );
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      assert.equal(decoded.value.ok, false);
      if (!decoded.value.ok)
        assert.equal(decoded.value.issues[0]?.code,
          "blooket-browser-incompatible");
    }
    assert.equal(JSON.stringify(incompatibleMcp)
      .includes(bridge.pairingToken()), false);
  } finally {
    clearInterval(poll);
    bridge.close();
    service.server.close();
    service.server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  }
});

test("local read discovery rejects stale and non-loopback runtimes",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "read-offline-"));
  try {
    const offline = await executeLocalBlooketRead(command, root);
    assert.equal(offline.ok, false);
    await writeFile(
      join(root, "service-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        instance: randomUUID(),
        origin: "https://example.invalid",
      }),
    );
    assert.deepEqual(await executeLocalBlooketRead(command, root), offline);
    const invalid = await executeLocalBlooketRead(
      { ...command, payload: { password: "not-admitted" } },
      root,
    );
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.issues[0]?.code, "unknown-field");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("MCP publication crosses CLI service and journaled browser transport",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "canonical-publication-"));
    const bridge = createBlooketBrowserBridgeBroker();
    const instance = randomUUID();
    const service = await startBrowserService({
      root, port: 0, instance, browserBridge: bridge,
    });
    const capabilities = JSON.parse(await readFile(new URL(
      "../../../ir/capability-snapshots/contract/" +
        "blooket-official-2026-10-05.json", import.meta.url,
    ), "utf8"));
    let remote: Record<string, unknown> | undefined;
    const questions: Record<string, unknown>[] = [];
    const mutations: string[] = [];
    const poll = setInterval(() => {
      const job = bridge.next(bridge.pairingToken());
      if (!job) return;
      let value: unknown;
      const request = job.command;
      switch (request.kind) {
        case "session.observe": value = "my-sets"; break;
        case "capabilities.inspect": value = capabilities; break;
        case "sets.list": value = {
          items: remote ? [{ schemaVersion: 1, id: remote["id"],
            title: remote["title"] }] : [],
          completeness: remote ? "unknown" : "complete",
        }; break;
        case "sets.get": value = remote; break;
        case "questions.list": value = structuredClone(questions); break;
        case "sets.create":
          mutations.push(request.kind);
          remote = { schemaVersion: 1, id: "synthetic-created",
            title: request.title, description: request.description,
            visibility: request.private ? "private" : "public" };
          value = { ok: true, remoteSetId: remote["id"] }; break;
        case "questions.create":
          mutations.push(request.kind);
          questions.push({ schemaVersion: 3, number: request.number,
            question: request.question, equation: null,
            qType: request.qType, random: request.random,
            timeLimit: request.timeLimit, hasImage: false, hasAudio: false,
            answers: request.answers.map((answer, index) => ({
              kind: "text", content: answer.text, correct: answer.correct,
              match: request.answerTypes?.[index] ?? null,
            })),
          });
          value = { ok: true }; break;
        default: throw new Error("Unexpected publication bridge command.");
      }
      assert.ok(bridge.complete(bridge.pairingToken(), {
        schemaVersion: 1, id: job.id, ok: true, value,
      }));
    }, 5);
    try {
      await writeFile(join(root, "service-runtime.json"), JSON.stringify({
        version: 1, pid: process.pid, instance, origin: service.origin,
      }));
      const saved = await executeJsonCommand("drafts.put", {
        id: "publication-fixture", expectedRevision: null,
        document: { schemaVersion: 1, title: "Synthetic publication",
          description: "Fixture", quizLanguage: "English",
          visibility: "private", mediaIndex: "media.jsonl", coverImage: null,
          questions: [{ id: "q1", type: "typing-answer",
            prompt: "Type sun.", timeLimitSeconds: 10, image: null,
            matchMode: "contains", answer: "sun" }],
        },
      }, "cli:publication-draft", root);
      assert.ok(saved.ok);
      const expectedRevision = (saved.value as { revision: string }).revision;
      for (let index = 0; index < 2; index++) {
        const reply = await callTeacherTool("blooket_publication_step", {
          draftId: "publication-fixture", expectedRevision,
        }, root);
        assert.equal(reply.isError, false, reply.content[0]?.text);
        const envelope = decodeResultEnvelope(
          JSON.parse(reply.content[0]!.text),
        );
        assert.ok(envelope.ok && envelope.value.ok);
        if (envelope.ok && envelope.value.ok) {
          const progress = envelope.value.value as {
            completedOperations: number; published: boolean };
          assert.equal(progress.completedOperations, index + 1);
          assert.equal(progress.published, false);
        }
        assert.equal(mutations.length, index + 1);
      }
      const verified = await callTeacherTool("blooket_publication_verify", {
        draftId: "publication-fixture",
      }, root);
      assert.equal(verified.isError, false, verified.content[0]?.text);
      const envelope = decodeResultEnvelope(
        JSON.parse(verified.content[0]!.text),
      );
      assert.ok(envelope.ok && envelope.value.ok);
      if (envelope.ok && envelope.value.ok)
        assert.equal((envelope.value.value as { published: boolean }).published,
          true);
      assert.deepEqual(mutations, ["sets.create", "questions.create"]);
      assert.equal(JSON.stringify(verified).includes(bridge.pairingToken()),
        false);
      assert.equal(JSON.stringify(verified).includes(root), false);
    } finally {
      clearInterval(poll);
      bridge.close();
      service.server.close();
      service.server.closeAllConnections();
      await rm(root, { recursive: true, force: true });
    }
  });
