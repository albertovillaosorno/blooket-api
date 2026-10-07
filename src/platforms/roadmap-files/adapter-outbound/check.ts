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
//   - Typed planning records and unfinished-index integrity.
// - Must-Not:
//   - Write records, infer completion, or consume secret files.
// - Allows:
//   - Inputs: A trusted repository root with local planning documents.
//   - Outputs: Validated repository planning metadata.
//   - Side effects: Reading owned repository documentation.
// - Split-When:
//   - An independent record schema needs a separate migration.
// - Merge-When:
//   - Repository planning no longer uses typed records.
// - Summary:
//   - Binds unfinished entries to typed records and stable identities.
// - Description:
//   - Validates metadata, dependencies, owned paths, and completion moves.
// - Usage:
//   - Validate planning records before accepting repository changes.
// - Defaults:
//   - Invalid record identity, status, paths, and links fail closed.
//
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const yaml = await import(
  new URL(
    "../../../../.dependencies/pnpm/node_modules/yaml/dist/index.js",
    import.meta.url,
  ).href
);

type RecordData = {
  id: string;
  status: "active" | "completed";
  task: string;
  order: number;
  depends_on: string[];
};
const keys = [
  "schema_version",
  "id",
  "status",
  "priority",
  "horizon",
  "order",
  "area",
  "task",
  "legacy_task",
  "depends_on",
  "contracts",
  "scope",
  "validation",
];
const fail = (reason: string): never => {
  throw new Error(reason);
};
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}
function decode(source: string, path: string): RecordData {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
  if (!match) return fail(`roadmap-front-matter: ${path}`);
  const document = yaml.parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) return fail(`roadmap-yaml: ${path}`);
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(`roadmap-metadata: ${path}`);
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(data, key))
  )
    return fail(`roadmap-fields: ${path}`);
  if (
    data["schema_version"] !== 1 ||
    typeof data["id"] !== "string" ||
    !/^blooket-[0-9]{2,}$/u.test(data["id"]) ||
    !["active", "completed"].includes(String(data["status"])) ||
    !/^p[0-3]$/u.test(String(data["priority"])) ||
    !["foundations", "publication", "delivery", "acceptance"].includes(
      String(data["horizon"]),
    ) ||
    !["status", "priority", "horizon"].every(
      key => typeof data[key] === "string",
    ) ||
    !Number.isSafeInteger(data["order"]) ||
    Number(data["order"]) < 0 ||
    typeof data["area"] !== "string" ||
    !/^[a-z-]+$/u.test(data["area"]) ||
    typeof data["task"] !== "string" ||
    !/^TODO - [^\n]+$/u.test(data["task"]) ||
    typeof data["legacy_task"] !== "string" ||
    !["depends_on", "contracts", "scope", "validation"].every((key) =>
      stringArray(data[key]),
    ) ||
    (data["scope"] as string[]).length === 0 ||
    (data["validation"] as string[]).length === 0
  )
    return fail(`roadmap-metadata: ${path}`);
  const record = data as RecordData;
  const expected = record.status === "active" ? "open" : "completed";
  if (!path.startsWith(`docs/todo/${expected}/${data["area"]}/`))
    return fail(`roadmap-status-path: ${path}`);
  if (
    !match[2]?.trimStart().startsWith(`# ${record.task}\n`) ||
    ["Objective", "Acceptance", "Evidence"].some(
      (section) => !match[2]?.includes(`\n## ${section}\n`),
    )
  )
    return fail(`roadmap-sections: ${path}`);
  return record;
}

async function ownedPath(root: string, path: string): Promise<string> {
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    return fail(`roadmap-unsafe-path: ${path}`);
  let current = root;
  for (const part of path.split("/").filter(Boolean)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink())
      return fail(`roadmap-symbolic-path: ${path}`);
  }
  return current;
}

export async function checkRoadmap(root: string): Promise<number> {
  root = resolve(root);
  const records = new Map<string, { data: RecordData; path: string }>();
  const paths = new Map<string, RecordData>();
  async function walk(path: string): Promise<void> {
    const absolute = await ownedPath(root, path);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const child = path + "/" + entry.name;
      if (entry.isSymbolicLink())
        return fail(`roadmap-symbolic-path: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith(".mdc")) {
        const source = await readFile(resolve(root, child), "utf8");
        const data = decode(source, child);
        if (records.has(data.id))
          return fail(`roadmap-duplicate-id: ${data.id}`);
        records.set(data.id, { data, path: child });
        paths.set(child, data);
        const meta = yaml.parse(source.split("---\n")[1]);
        for (const contract of meta.contracts as string[])
          await ownedPath(root, contract);
        for (const scope of meta.scope as string[])
          await ownedPath(root, scope);
      }
    }
  }
  await walk("docs/todo/open");
  await walk("docs/todo/completed");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dependencies(id: string): void {
    if (visiting.has(id)) return fail(`roadmap-dependency-cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const record = records.get(id)!;
    for (const dependency of record.data.depends_on) {
      if (!records.has(dependency))
        return fail(`roadmap-missing-dependency: ${dependency}`);
      dependencies(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of records.keys()) dependencies(id);
  const index = await readFile(await ownedPath(root, "TODO.md"), "utf8");
  const indexed = new Set<string>();
  const entries = [
    ...index.matchAll(
      /^### (TODO - [^\n]+)\n([\s\S]*?)(?=^## |^### |$(?![\s\S]))/gmu,
    ),
  ];
  for (const entry of entries) {
    const parts = entry[2]!.trim().split(/\n\s*\n/u);
    if (parts.length !== 2 || /^(?:#|[-*] |[0-9]+\.)/u.test(parts[0]!))
      return fail("roadmap-index-shape");
    const link = /^\[[^\]\n]+\]\((docs\/todo\/open\/[^)]+\.mdc)\)$/u.exec(
      parts[1]!,
    );
    if (!link) return fail("roadmap-index-link");
    const path = link[1]!;
    const data = paths.get(path);
    if (!data || data.status !== "active")
      return fail(`roadmap-index-not-open: ${path}`);
    if (data.task !== entry[1]) return fail(`roadmap-index-title: ${path}`);
    if (indexed.has(path)) return fail(`roadmap-index-duplicate: ${path}`);
    indexed.add(path);
  }
  const links = [...index.matchAll(/\[[^\]\n]+\]\(([^)]+)\)/gu)];
  if (links.length !== entries.length) return fail("roadmap-index-extra-link");
  for (const link of links) await ownedPath(root, link[1]!);
  for (const [path, data] of paths)
    if (data.status === "active" && !indexed.has(path))
      return fail(`roadmap-unindexed-open: ${path}`);
  return indexed.size;
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === script) {
  const root = resolve(script, "../../../../../");
  try {
    const count = await checkRoadmap(root);
    process.stdout.write(`Roadmap: ${count} unfinished records validated.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "roadmap-invalid";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
