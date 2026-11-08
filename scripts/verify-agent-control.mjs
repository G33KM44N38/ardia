#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appEnv, attach, binaryOf, binaryPids, launch, mergeLaunchEnv, processInfo, session, sleep } from "./lib/instance.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(process.argv[2] ?? join(repo, "apps/browser/build-routing/Build/Products/Release/Ardia.app"));
assert.ok(!app.startsWith("/Applications/"));
const evidence = join(repo, "output/verification/mcp", String(Date.now()));
mkdirSync(evidence, { recursive: true });
const data = mkdtempSync("/tmp/ardia-mcp-proof-");
const canonicalData = realpathSync(data);
writeFileSync(join(data, "owned-verification"), evidence);
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2));
const actions = [];
const clients = [];
const requests = [];
let instance;
let external;
let externalData;
let failure;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", part => { body += part; });
  req.on("end", () => {
    requests.push({ method: req.method, path: req.url, body });
    if (req.url === "/saved") { save("saved.json", { body }); res.end("saved"); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><h1>Agent control fixture</h1><input aria-label="Fixture name" id="name"><button id="save" onclick="document.getElementById(\'status\').textContent=\'Saved \'+document.getElementById(\'name\').value;fetch(\'/saved\',{method:\'POST\',body:document.getElementById(\'name\').value})">Save fixture</button><p id="status">Waiting</p><a href="chrome://settings">Forbidden browser page</a></body></html>');
  });
});
const eventually = async test => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await test()) return; await sleep(100); }
  throw new Error("Expected fixture state never arrived");
};
function client() {
  const child = spawn(join(repo, "scripts/ardia-fork-mcp"), ["--data-dir", data], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const reply = JSON.parse(line);
    const waiting = pending.get(reply.id);
    if (waiting) { clearTimeout(waiting.timer); pending.delete(reply.id); waiting.resolve(reply); }
  });
  child.stderr.on("data", chunk => actions.push({ stderr: chunk.toString().slice(0, 1000) }));
  child.on("exit", () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("MCP client exited")); }
    pending.clear();
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tool = async (name, args = {}) => {
    const reply = await rpc("tools/call", { name, arguments: args });
    actions.push({ tool: name, args, isError: !!reply.result?.isError, error: reply.error ?? (reply.result?.isError ? reply.result.content?.[0]?.text : null) });
    return reply.result;
  };
  const result = { child, rpc, tool, close: () => { child.stdin.end(); lines.close(); child.kill(); } };
  clients.push(result);
  return result;
}
const value = reply => { assert.ok(!reply.isError, reply.content?.[0]?.text); return JSON.parse(reply.content[0].text); };
try {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(data, "session.json"), JSON.stringify(session({ profiles: ["Personal", { id: "secret", name: "Secret" }],
    tabs: [{ id: "source", url: base + "/source" }, { id: "hidden", profileId: "secret", url: base + "/secret" }],
    settings: { cliControl: false, showAdvancedSettings: true, loadProfilesWhenOpened: false },
  })));
  writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  writeFileSync(join(data, "perf-probe"), "");
  const binary = binaryOf(app), before = binaryPids(binary), log = join(data, "app.log");
  const env = appEnv(app, mergeLaunchEnv({ ARDIA_BACKGROUND: "1", ARDIA_DATA_DIR: data, ARDIA_REMOTE_DEBUGGING_PORT: "" }));
  execFileSync("open", ["-g", "-n", ...Object.entries(env).filter(([, v]) => v !== null && v !== undefined).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--stdout", log, "--stderr", log, app]);
  let pid;
  await eventually(() => { pid = [...binaryPids(binary)].find(p => !before.has(p)); return !!pid; });
  writeFileSync(join(data, "instance.json"), JSON.stringify({ app, binary, data, port: 0, log, pid, started: processInfo(pid).started, js: { mode: "none" }, meta: { kind: "agent-verification" } }));
  instance = attach(data);
  await instance.ready({ test: 'return !!ac.store.getState().tabs.source && ac.webviews.has("source")' });
  const nativeStatus = await instance.eval('return ac.engine.call("engine.cliControlStatus",{})');
  assert.equal(nativeStatus.state, "off");
  await instance.eval('return ac.agentControl.setAgentControl(true)');
  assert.equal(await instance.eval('return ac.agentControl.useAgentControl.getState().enabled'), true);
  const a = client(), b = client();
  assert.equal((await a.rpc("initialize", { protocolVersion: "2025-03-26" })).result.serverInfo.name, "ardia-fork");
  assert.equal((await a.rpc("tools/list")).result.tools.length, 13);
  value(await a.tool("request_access", { name: "Verification A" }));
  value(await b.tool("request_access", { name: "Verification B" }));
  assert.equal((await a.tool("list_tabs")).isError, true);
  const sessions = await instance.eval('return ac.agentControl.useAgentControl.getState().sessions');
  const idA = sessions.find(s => s.name === "Verification A").connection;
  const idB = sessions.find(s => s.name === "Verification B").connection;
  await instance.eval(`return ac.agentControl.approveAgent(${idA},["default"],true,false)`);
  await instance.eval(`return ac.agentControl.approveAgent(${idB},["secret"],false,false)`);
  assert.deepEqual(value(await a.tool("list_profiles")).map(p => p.id), ["default"]);
  assert.deepEqual(value(await b.tool("list_profiles")).map(p => p.id), ["secret"]);
  assert.ok(value(await a.tool("list_tabs")).every(t => t.profile === "default"));
  assert.ok(value(await b.tool("list_tabs")).every(t => t.profile === "secret"));
  assert.equal((await a.tool("snapshot", { tab: "hidden" })).isError, true);
  assert.equal((await b.tool("open_tab", { profile: "secret", url: base + "/blocked" })).isError, true);
  let snapshot;
  await eventually(async () => {
    const response = await a.tool("snapshot", { tab: "source" });
    if (response.isError) return false;
    snapshot = value(response); return snapshot.text.includes("Agent control fixture");
  });
  const name = snapshot.elements.find(e => e.name === "Fixture name").ref;
  const button = snapshot.elements.find(e => e.name === "Save fixture").ref;
  const forbidden = snapshot.elements.find(e => e.name === "Forbidden browser page").ref;
  value(await a.tool("fill", { tab: "source", snapshot: snapshot.snapshot, ref: name, text: "Verified fixture" }));
  value(await a.tool("click", { tab: "source", snapshot: snapshot.snapshot, ref: button }));
  await eventually(() => requests.some(r => r.path === "/saved" && r.body === "Verified fixture"));
  assert.equal(JSON.parse(readFileSync(join(evidence, "saved.json"))).body, "Verified fixture");
  const after = value(await a.tool("snapshot", { tab: "source" }));
  assert.ok(after.text.includes("Saved Verified fixture"));
  assert.equal((await a.tool("click", { tab: "source", snapshot: snapshot.snapshot, ref: button })).isError, true);
  assert.equal((await a.tool("click", { tab: "source", snapshot: after.snapshot, ref: forbidden })).isError, true);
  assert.equal((await a.tool("evaluate_script", { tab: "source", snapshot: after.snapshot, script: "return document.cookie" })).isError, true);
  assert.equal((await a.tool("navigate", { tab: "source", destination: "file:///etc/passwd" })).isError, true);
  const forged = await instance.eval(`return ac.engine.call("engine.agentPage",{connection:${idA},generation:${sessions[0].generation},profile:"secret",tab:"hidden",url:${JSON.stringify(base + "/secret")},operation:"snapshot"})`);
  assert.ok(forged.error);
  const shot = await a.tool("screenshot", { tab: "source" });
  assert.ok(!shot.isError, shot.content?.[0]?.text);
  writeFileSync(join(evidence, "page.png"), Buffer.from(shot.content[0].data, "base64"));
  await instance.eval('ac.openSettings("advanced");return true');
  await sleep(1000);
  await instance.eval('ac.settingsSearch.revealSetting({id:"advanced.agents",pane:"advanced",section:"Agents"});return true');
  await sleep(1800);
  const windows = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", `ObjC.import('CoreGraphics');JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll,0))).filter(w=>w.kCGWindowOwnerPID===${pid}).map(w=>({id:w.kCGWindowNumber,title:w.kCGWindowName})))`], { encoding: "utf8" }));
  const settings = windows.find(w => w.title === "Settings");
  assert.ok(settings);
  assert.equal(await instance.eval(`return ac.engine.call("windows.dev",{window:${settings.id},action:${JSON.stringify("snapshotFrame:" + join(evidence, "settings.png"))}})`), "ok");
  save("settings-state.json", { sessions: await instance.eval('return ac.agentControl.useAgentControl.getState().sessions'), nativeStatus });
  await instance.eval(`return ac.agentControl.revokeAgent(${idA})`);
  assert.equal((await a.tool("list_tabs")).isError, true);
  a.close();
  const reconnect = client();
  assert.equal(value(await reconnect.tool("request_access", { name: "Verification A reconnect" })).approved, false);
  assert.equal((await reconnect.tool("list_tabs")).isError, true);
  await instance.eval('ac.store.getState().updateSettings({cliControl:true});return true');
  await eventually(async () => !(await instance.eval('return ac.agentControl.useAgentControl.getState().enabled')));
  await eventually(() => !existsSync(join(data, "ArdiaAgents.sock")));
  await instance.quit();
  externalData = mkdtempSync("/tmp/ardia-mcp-external-");
  external = await launch(app, { data: externalData, js: "none", probe: true, onboarded: true, session: session() });
  await external.eval('return ac.agentControl.setAgentControl(true)');
  assert.equal(await external.eval('return ac.agentControl.useAgentControl.getState().enabled'), false);
  assert.match(await external.eval('return ac.agentControl.useAgentControl.getState().reason'), /DevTools/);
  save("result.json", { passed: true, scope: "Real MCP stdio → dedicated native socket → browser broker → native page operations; fixture approvals use the internal approval function, not UI clicks", requests, checks: ["preapproval refusal", "two-profile isolation", "read-only refusal", "fill/click and HTTP side effect", "stale snapshot", "privileged link", "scripts denied", "native forged target denied", "screenshot", "revocation", "reconnect requires approval", "global CLI stops scoped access", "external CDP refusal"] });
} catch (error) {
  failure = error;
  save("failure.json", { error: error.stack });
} finally {
  for (const c of clients) c.close();
  if (external) await external.quit();
  if (instance) {
    if (existsSync(instance.log)) writeFileSync(join(evidence, "app.log"), readFileSync(instance.log));
    await instance.quit();
    assert.ok(!instance.stillOwned());
  }
  await new Promise(r => server.close(r));
  assert.equal(realpathSync(data), canonicalData);
  assert.ok(canonicalData.startsWith("/private/tmp/ardia-mcp-proof-"));
  assert.equal(readFileSync(join(data, "owned-verification"), "utf8"), evidence);
  rmSync(data, { recursive: true });
  if (externalData && external && !external.stillOwned()) {
    assert.ok(realpathSync(externalData).startsWith("/private/tmp/ardia-mcp-external-"));
    rmSync(externalData, { recursive: true });
  }
  save("actions.json", actions);
  save("cleanup.json", { instanceStopped: !instance || !instance.stillOwned(), scratchRemoved: !existsSync(data), evidencePreserved: true });
}
console.log(JSON.stringify({ passed: !failure, evidence }));
if (failure) throw failure;
