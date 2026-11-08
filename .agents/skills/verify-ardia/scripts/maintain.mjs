#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const { attach, binaryOf, binaryPids, processInfo, sleep } = await import(join(repo, "scripts/lib/instance.mjs"));
const app = resolve(process.argv[2] ?? join(repo, "apps/browser/build-routing/Build/Products/Release/Ardia.app"));
assert.ok(!app.startsWith("/Applications/"));
execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
const binary = binaryOf(app);
const evidence = join(repo, "output/verification/maintenance", `${Date.now()}-${randomUUID().slice(0, 8)}`);
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync("/tmp/as-");
const token = randomUUID();
writeFileSync(join(scratch, "verification-owner"), token);
const canonical = realpathSync(scratch);
const results = {};
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2));
let stage = "preflight";
let failed = false;
let beforeMcpRoots;
let beforeMcpPids;
const clients = new Map();

function records(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? records(path) : entry.name === "instance.json" ? [dirname(path)] : [];
  });
}

async function stopRecorded(dir) {
  try {
    const instance = attach(dir);
    await instance.quit();
    assert.ok(!instance.stillOwned(), "Owned instance did not stop");
  } catch (error) { if (!error.gone) throw error; }
}

function mcpRoots() {
  return new Set(readdirSync("/tmp").filter(n => n.startsWith("ardia-mcp-proof-") || n.startsWith("ardia-mcp-external-")));
}

async function run(script, args = [], env = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", b => { stdout = (stdout + b).slice(-2000000); });
  child.stderr.on("data", b => { stderr = (stderr + b).slice(-2000000); });
  const watcher = setInterval(() => {
    const pids = spawnSync("pgrep", ["-P", String(child.pid)], { encoding: "utf8" }).stdout?.trim().split(/\s+/).map(Number) ?? [];
    for (const pid of pids) {
      const info = processInfo(pid);
      if (info?.command.startsWith(join(repo, "output/agent-tools/Ardia Fork MCP") + " ")) clients.set(pid, info);
    }
  }, 200);
  let timer;
  const code = await new Promise((r, reject) => {
    timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${stage} exceeded its 240-second deadline`)); }, 240000);
    child.once("error", reject);
    child.once("exit", r);
  }).finally(() => { clearTimeout(timer); clearInterval(watcher); });
  if (code !== 0) {
    writeFileSync(join(scratch, `${stage}-private-output.txt`), stdout + stderr, { mode: 0o600 });
    throw new Error(`${stage} failed with exit ${code}; raw fixture output withheld`);
  }
  const reports = stdout.split("\n").filter(line => line.startsWith("{")).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { report: reports.at(-1), stdout };
}

function proofDirectory(path, parent) {
  assert.equal(typeof path, "string");
  const canonicalPath = realpathSync(path);
  assert.ok(canonicalPath.startsWith(realpathSync(parent) + "/"));
  return canonicalPath;
}

try {
  save("doctor-preflight.json", { app, signatureValid: true, binary, productRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim() });
  stage = "browser";
  const ui = (await run(join(here, "verify.mjs"), ["suite", app])).report;
  assert.equal(ui?.passed, true);
  const uiEvidence = proofDirectory(ui.evidence, join(repo, "output/verification/ardia"));
  for (const file of ["result.json", "workspace.json", "bookmarks.json", "doctor-workspace.json", "doctor-restored-bookmarks.json", "before.png", "after.png", "workspace-split.png", "bookmark-opened.png", "migration-ui.json", "cleanup.json"]) assert.ok(existsSync(join(uiEvidence, file)), file);
  assert.equal(JSON.parse(readFileSync(join(uiEvidence, "cleanup.json"))).scratchRemoved, true);
  for (const name of ["routing", "workspace", "bookmarks"]) results[name] = { status: "passed", evidence: uiEvidence };

  stage = "sync";
  const sync = (await run(join(here, "sync.mjs"), [app], { TMPDIR: scratch })).report;
  assert.equal(sync?.result, "passed");
  assert.equal(sync.checks, 7);
  proofDirectory(sync.work, scratch);
  for (const dir of records(sync.work)) {
    try { attach(dir); throw new Error("Sync helper left a live instance"); } catch (error) { if (!error.gone) throw error; }
  }
  results.sync = { status: "passed", nativeChecks: 7, doctors: sync.doctors, routingDeviceSuffix: sync.routingDeviceSuffix, scope: "Native create/pair and bidirectional encrypted local-folder sync; reauthentication is a fixture override, not Touch ID or cloud replication" };
  save("sync.json", results.sync);

  stage = "migration-fixtures";
  const unit = await run(join(repo, "scripts/migrate-official.test.mjs"), [], { TMPDIR: scratch });
  assert.match(unit.stdout, /(?:pass 8|tests 8)/);
  stage = "migration-guard";
  const beforeGuard = binaryPids(binary);
  const guard = (await run(join(repo, "scripts/verify-routing-migration-guard.mjs"), [app], { TMPDIR: scratch })).report;
  assert.equal(guard?.result, "passed");
  const guardDir = proofDirectory(guard.data, scratch);
  const log = readFileSync(join(guardDir, "app.out.log"), "utf8");
  assert.match(log, /migrated data kept closed/);
  assert.doesNotMatch(log, /engine started/);
  assert.deepEqual([...binaryPids(binary)].filter(pid => !beforeGuard.has(pid)), []);
  writeFileSync(join(evidence, "migration-guard.log"), log);
  results.migration = { status: "passed", fixtureTests: 8, refusedBeforeEngine: true, connectedAccountsUI: JSON.parse(readFileSync(join(uiEvidence, "migration-ui.json"), "utf8")) };
  save("migration.json", results.migration);

  stage = "agents";
  beforeMcpRoots = mcpRoots();
  beforeMcpPids = binaryPids(binary);
  const mcp = (await run(join(here, "agents.mjs"), [app])).report;
  assert.equal(mcp?.passed, true);
  const mcpEvidence = proofDirectory(mcp.evidence, join(repo, "output/verification/mcp"));
  for (const file of ["result.json", "actions.json", "page.png", "settings.png", "screenshot-limits.json", "cleanup.json"]) assert.ok(existsSync(join(mcpEvidence, file)), file);
  const cleanup = JSON.parse(readFileSync(join(mcpEvidence, "cleanup.json")));
  assert.equal(cleanup.instanceStopped, true);
  assert.equal(cleanup.scratchRemoved, true);
  results.agents = { status: "passed", evidence: mcpEvidence, scope: "Real MCP and native page operations; approval fixtures use production handlers, not button clicks; physical input, positive scripts, expiry waiting and Stop button remain separate journeys" };
  save("agents.json", results.agents);
} catch (error) {
  failed = true;
  save("failure.json", { stage, error: error.message });
} finally {
  for (const dir of records(scratch)) await stopRecorded(dir);
  if (beforeMcpRoots) {
    for (const name of mcpRoots()) if (!beforeMcpRoots.has(name)) {
      const dir = join("/tmp", name);
      for (const record of records(dir)) await stopRecorded(record);
      assert.ok(basename(dir).startsWith("ardia-mcp-"));
      execFileSync("trash", [dir]);
    }
    assert.deepEqual([...binaryPids(binary)].filter(pid => !beforeMcpPids.has(pid)), [], "MCP helper left an unrecorded application");
  }
  for (const [pid, info] of clients) {
    const same = () => { const current = processInfo(pid); return current?.started === info.started && current.command === info.command; };
    for (const until = Date.now() + 3000; same() && Date.now() < until;) await sleep(100);
    if (same()) process.kill(pid, "SIGTERM");
    for (const until = Date.now() + 3000; same() && Date.now() < until;) await sleep(100);
    assert.ok(!same(), "Owned MCP client did not stop");
  }
  assert.equal(realpathSync(scratch), canonical);
  assert.equal(readFileSync(join(scratch, "verification-owner"), "utf8"), token);
  execFileSync("trash", [scratch]);
  save("coverage.json", { passed: !failed, results });
  for (const result of Object.values(results)) if (result.evidence) assert.ok(existsSync(join(result.evidence, "cleanup.json")));
  save("cleanup.json", { scratchTrashed: !existsSync(scratch), trackedClientsStopped: true, evidenceExists: existsSync(join(evidence, "coverage.json")), retainedEvidence: Object.values(results).map(r => r.evidence).filter(Boolean) });
}
console.log(JSON.stringify({ passed: !failed, evidence, covered: Object.keys(results) }));
if (failed) process.exitCode = 1;
