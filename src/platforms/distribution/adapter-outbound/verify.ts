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
//   - Native smoke verification of an extracted distribution archive.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: Temporary extraction and a synthetic local service.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Tests the archive that would be delivered rather than repository imports.
// - Description:
//   - Exercises launch, native media, canonical CLI, and owned shutdown.
// - Usage:
//   - Run on the matching native host after assembly.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  access,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preparedMediaBytesAdmitted } from
  "../../../media/rendition-optimization/domain/limits.ts";
import { defaultTeacherPreferences } from
  "../../../settings/teacher-preferences/domain/preferences.ts";
import { decodeServiceRuntime } from
  "../../service-lifecycle/adapter-outbound/runtime.ts";
import {
  MAC_LOGIN_AGENT_EXECUTABLE,
  MAC_LOGIN_AGENT_LABEL,
  MAC_LOGIN_AGENT_PLIST,
  TARGETS,
  type DistributionTarget,
} from "./build.ts";

import { PRODUCT_VERSION, extensionVersion, appleBuildVersion } from
  "../../../ir/product-version/contract/version.ts";

const execute = promisify(execFile);
export async function verifyDistribution(
  target: DistributionTarget,
  release = false,
): Promise<void> {
  assert.ok(TARGETS.includes(target));
  assert.equal(target, process.platform + "-" + process.arch);
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = await mkdtemp(join(repo, ".temp/package verification "));
  const mac = target.startsWith("darwin-");
  const resources = mac
    ? join(root, "Blooket API.app/Contents/Resources")
    : root;
  const launcher = mac
    ? join(root, "Blooket API.app/Contents/MacOS/Blooket API")
    : join(root, "blooket-api");
  const data = join(root, "test data");
  const env = {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    BLOOKET_DATA_HOME: data,
    DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
    XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
  };
  let started = false;
  const launch = (args: string[]) =>
    execute(launcher, args, {
      env,
      timeout: 40_000,
      maxBuffer: 1_000_000,
    });
  try {
    if (mac)
      await execute("unzip", [
        "-q",
        join(repo, ".temp/distributions", target + ".zip"),
        "-d",
        root,
      ]);
    else
      await execute("tar", [
        "-xzf",
        join(repo, ".temp/distributions", target + ".tar.gz"),
        "-C",
        root,
      ]);
    const manifest = JSON.parse(
      await readFile(join(resources, "distribution.json"), "utf8"),
    ) as {
      target: unknown;
      productVersion: unknown;
      sourceDirty: unknown;
      sourceRevision: unknown;
    };
    assert.equal(manifest.target, target);
    assert.equal(manifest.productVersion, PRODUCT_VERSION);
    if (release) assert.equal(manifest.sourceDirty, false);
    const { stdout: revision } = await execute("git", ["rev-parse", "HEAD"], {
      cwd: repo,
    });
    assert.equal(manifest.sourceRevision, revision.trim());
    const app = join(resources, "app");
    const packageMetadata = JSON.parse(await readFile(
      join(app, "package.json"), "utf8",
    ));
    assert.equal(packageMetadata.version, PRODUCT_VERSION);
    if (mac) {
      const info = await readFile(join(root,
        "Blooket API.app/Contents/Info.plist"), "utf8");
      assert.ok(info.includes(
        `<key>CFBundleShortVersionString</key>` +
        `<string>${PRODUCT_VERSION}</string>`,
      ));
      assert.ok(info.includes(`<key>CFBundleVersion</key>` +
        `<string>${appleBuildVersion(PRODUCT_VERSION)}</string>`));
      const loginAgent = join(
        resources,
        "ServiceManagement",
        MAC_LOGIN_AGENT_EXECUTABLE,
      );
      await access(loginAgent);
      const loginAgentPlist = await readFile(
        join(
          root,
          "Blooket API.app/Contents/Library/LaunchAgents",
          MAC_LOGIN_AGENT_PLIST,
        ),
        "utf8",
      );
      assert.ok(loginAgentPlist.includes(
        `<string>${MAC_LOGIN_AGENT_LABEL}</string>`,
      ));
      assert.ok(loginAgentPlist.includes(
        "Contents/Resources/ServiceManagement/" +
          MAC_LOGIN_AGENT_EXECUTABLE,
      ));
      assert.ok(loginAgentPlist.includes("<key>RunAtLoad</key>"));
      assert.ok(!loginAgentPlist.includes("KeepAlive"));
    }
    const names = await readdir(app);
    assert.ok(!names.includes(".env") && !names.includes("reference"));
    await assert.rejects(access(join(app, "docs/agents/AGENTS-DEV.md")));
    const browser = join(resources, "extensions/chrome");
    const browserManifest = JSON.parse(await readFile(
      join(browser, "manifest.json"), "utf8",
    ));
    assert.equal(browserManifest.manifest_version, 3);
    assert.equal(browserManifest.version_name, PRODUCT_VERSION);
    assert.equal(browserManifest.version, extensionVersion(PRODUCT_VERSION));
    assert.deepEqual(browserManifest.permissions, ["storage", "scripting"]);
    assert.equal(browserManifest.background.service_worker,
      "src/service/browser-extension/adapter-inbound/worker.js");
    const worker = await readFile(join(browser,
      "src/service/browser-extension/adapter-inbound/worker.js"), "utf8");
    assert.doesNotMatch(worker, /from\s+["'][^"']+\.ts["']/u);
    assert.doesNotMatch(worker, /from\s+["']node:/u);
    if (mac && release) {
      const safariRoot = join(
        root,
        "Blooket API.app/Contents/Resources/Safari",
      );
      const companion = join(safariRoot, "Blooket API Safari.app");
      const plugins = join(companion, "Contents/PlugIns");
      const extensions = (await readdir(plugins)).filter((name) =>
        name.endsWith(".appex"),
      );
      assert.equal(extensions.length, 1, "Safari extension must be packaged");
      await access(join(safariRoot, "open-extension"));
      await access(join(safariRoot, "extension-id.txt"));
      await execute("codesign", [
        "--verify",
        "--deep",
        "--strict",
        join(root, "Blooket API.app"),
      ]);
      await execute("spctl", [
        "--assess",
        "--type",
        "execute",
        join(root, "Blooket API.app"),
      ]);
    }
    // Setup uses ordinary preferences only; all exercised code is packaged.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(data, { mode: 0o700 });
    const settings = defaultTeacherPreferences(join(data, "media"));
    await writeFile(
      join(data, "settings.json"),
      JSON.stringify({
        ...settings,
        service: { ...settings.service, portMode: "automatic", port: 1 },
      }),
      { mode: 0o600 },
    );
    if (mac) {
      const loginAgent = join(
        resources,
        "ServiceManagement",
        MAC_LOGIN_AGENT_EXECUTABLE,
      );
      await execute(loginAgent, [], {
        env,
        timeout: 40_000,
        maxBuffer: 1_000_000,
      });
      started = true;
    }
    const first = await launch(["--no-open"]);
    started = true;
    const runtime = decodeServiceRuntime(
      JSON.parse(await readFile(join(data, "service-runtime.json"), "utf8")),
    );
    assert.equal(first.stdout.trim(), runtime.origin);
    assert.equal((await launch(["--no-open"])).stdout.trim(), runtime.origin);
    const runtimeAfter = decodeServiceRuntime(
      JSON.parse(await readFile(join(data, "service-runtime.json"), "utf8")),
    );
    assert.equal(runtimeAfter.instance, runtime.instance);
    const request = async (path: string, options?: RequestInit) =>
      fetch(runtime.origin + path, {
        ...options,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    assert.equal((await request("/")).status, 200);
    for (const path of ["/icon.svg", "/mcp-icon.png", "/library.js"])
      assert.equal((await request(path)).status, 200);
    const bootstrap = (await (await request("/api/bootstrap")).json()) as {
      csrf: string;
      browserBridge: { token: string };
    };
    const post = async (path: string, value: unknown) => {
      const response = await request(path, {
        method: "POST",
        headers: {
          Origin: runtime.origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": bootstrap.csrf,
        },
        body: JSON.stringify(value),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as Record<string, unknown>;
    };
    const source =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBI" +
      "WXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwHwwZGP6DAQBJyAn3iFfy" +
      "TAAAAABJRU5ErkJggg==";
    const imported = await post("/api/import", {
      name: "Package fixture",
      description: "Synthetic image",
      base64: source,
      edit: {
        panX: 0,
        panY: 0,
        zoom: 1,
        contrast: 1,
        saturation: 1,
        background: { mode: "blur", color: "#ffffff" },
        width: 1280,
        height: 720,
        gifFps: 10,
        compression: "compact",
      },
    });
    assert.equal(typeof imported["id"], "string");
    const prepared = await post("/api/prepare", {
      id: imported["id"],
      revision: imported["revision"],
    });
    const rendition = prepared["prepared"] as { bytes: number };
    assert.ok(preparedMediaBytesAdmitted(rendition.bytes));
    const download = await request(
      "/media/" +
        String(imported["id"]) +
        "?variant=prepared&revision=" +
        String(prepared["revision"]),
    );
    assert.equal(download.status, 200);
    assert.equal((await download.arrayBuffer()).byteLength, rendition.bytes);
    const denied = await request("/api/service-stop", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(denied.status, 403);
    const node = join(resources, "runtime/node");
    // Exercise the real JSON CLI subprocess, including the bundled profile.
    const cli = execFile(
      node,
      [
        join(app, "src/cli/executable/adapter-inbound/blooket.ts"),
        "command",
        "--json",
      ],
      { env, timeout: 30_000, maxBuffer: 1_000_000 },
    );
    const result = new Promise<string>((resolve, reject) => {
      let stdout = "";
      cli.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      cli.once("error", reject);
      cli.once("close", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error("packaged-cli-failed")),
      );
    });
    cli.stdin!.on("error", () => undefined);
    cli.stdin!.end(
      JSON.stringify({
        version: 1,
        operationId: "test:package",
        command: "profile.get",
        payload: {},
      }),
    );
    const response = JSON.parse(await result) as {
      ok: unknown;
      operationId: unknown;
    };
    assert.equal(response.ok, true);
    assert.equal(response.operationId, "test:package");
    // Drive only this disposable package's bridge with synthetic read facts.
    // This proves CLI/service composition, not native browser acceptance.
    for (const args of [
      ["session", "inspect", "--json"],
      ["sets", "list", "--json"],
      ["sets", "get", "package-fixture", "--json"],
      ["questions", "list", "package-fixture", "--json"],
    ]) {
      let finished = false;
      const read = execute(node, [
        join(app, "src/cli/executable/adapter-inbound/blooket.ts"), ...args,
      ], { env, timeout: 30_000, maxBuffer: 1_000_000 }).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ).finally(() => { finished = true; });
      while (!finished) {
        const next = await request("/api/browser-bridge/next", {
          headers: {
            Authorization: "Bearer " + bootstrap.browserBridge.token,
          },
        });
        assert.equal(next.status, 200);
        const { job } = await next.json();
        if (job) {
          assert.ok([
            "session.observe",
            "sets.list",
            "sets.get",
            "questions.list",
          ].includes(job.command.kind));
          const value = job.command.kind === "session.observe" ? "my-sets"
            : job.command.kind === "sets.list" ? [{ schemaVersion: 1,
              id: "package-fixture", title: "Synthetic quiz" }]
            : job.command.kind === "questions.list" ? [{
              schemaVersion: 1, number: 1, question: "Type sun.",
              qType: "typing", random: true, timeLimit: 15,
              answers: ["sun"], correctAnswers: ["sun"],
              answerTypes: ["exactly"], hasImage: false, hasAudio: false,
            }]
            : { schemaVersion: 1, id: "package-fixture",
              title: "Synthetic quiz", description: "Synthetic package data",
              visibility: "private" };
          const completion = await request("/api/browser-bridge/result", {
            method: "POST",
            headers: { "Content-Type": "application/json",
              Authorization: "Bearer " + bootstrap.browserBridge.token },
            body: JSON.stringify({ schemaVersion: 1, id: job.id,
              ok: true, value }),
          });
          assert.equal(completion.status, 200);
        }
        if (!finished)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const captured = await read;
      assert.ok(captured.ok, "Packaged Blooket read command must succeed");
      const result = JSON.parse(captured.value.stdout);
      assert.equal(result.ok, true);
      assert.equal(result.value.ok, true);
      if (args[0] === "session") assert.equal(result.value.state, "my-sets");
      else assert.equal(
        result.value.kind,
        args[0] === "questions"
          ? "questions"
          : args[1] === "list" ? "sets" : "set",
      );
      assert.ok(!captured.value.stdout.includes(bootstrap.browserBridge.token));
    }
    await launch(["--stop"]);
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await launch(["--status"])).stdout.trim() === "Service offline.")
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      (await launch(["--status"])).stdout.trim(),
      "Service offline.",
    );
    await assert.rejects(access(join(data, "service-runtime.json")));
    started = false;
  } finally {
    if (started) {
      await launch(["--stop"]);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        (await launch(["--status"])).stdout.trim(),
        "Service offline.",
      );
    }
    await rm(root, { recursive: true, force: true });
  }
}
