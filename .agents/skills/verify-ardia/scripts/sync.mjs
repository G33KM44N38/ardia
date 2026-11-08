#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";


const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { launch, session, sleep, listenerPids } = await import(join(repo, "scripts/lib/instance.mjs"));
const app = resolve(process.argv[2] ?? join(repo, "apps/browser/build-routing/Build/Products/Release/Ardia.app"));
const work = mkdtempSync(join(tmpdir(), "ardia-routing-sync-test-"));
const folder = join(work, "encrypted-sync");
const instances = [];
let checks = 0;
let stage = "launch";
let failure;
const doctors = [];
try {
  for (const name of ["A", "B"]) instances.push(await launch(app, {
    data: join(work, name), js: "none", probe: true, onboarded: true,
    session: session(), instance: { syncFolder: folder }, test: { reauth: "granted" },
    ready: { timeout: 60000, test: 'return !!ac.sync.native && Object.keys(ac.store.getState().windows).length > 0 && ac.engine.call("windows.list",{}).then(ws=>ws.some(w=>w.hasRoot&&w.ready))' },
  }));
  const [a, b] = instances;
  for (const i of instances) {
    assert.ok(i.alive);
    assert.deepEqual(listenerPids(i.port), [i.pid]);
    doctors.push({ owned: true, pid: i.pid, started: i.started, port: i.port, nativeModule: true });
  }
  stage = "create";
  assert.deepEqual(await a.eval(`return ac.sync.turnOnSync(${JSON.stringify(folder)})`), { ok: true });
  checks++;
  stage = "pair";
  const words = await a.eval("return ac.sync.native.recoveryWords()");
  assert.deepEqual(await b.eval(`return ac.sync.enterRecoveryPhrase(${JSON.stringify(folder)}, ${JSON.stringify(words.join(" "))})`), { ok: true });
  checks++;
  stage = "devices";
  const cycle = async () => {
    for (const instance of [a, b, a, b]) await instance.eval("return ac.sync.syncNow()", { timeout: 30000 });
  };
  let idA, idB;
  for (const until = Date.now() + 45000; Date.now() < until;) {
    await cycle();
    idA = await a.eval("return ac.sync.useSync.getState().devices.find(d=>d.current)?.id");
    idB = await b.eval("return ac.sync.useSync.getState().devices.find(d=>d.current)?.id");
    if (idA && idB) break;
    await sleep(100);
  }
  assert.ok(idA && idB);
  assert.notEqual(idA, idB);
  checks++;
  stage = "exchange";
  const eventually = async (instance, expression) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await cycle();
      if (await instance.eval(expression)) return;
      await sleep(200);
    }
    throw new Error("Synced fixture data never arrived");
  };
  await a.eval('ac.store.getState().addBookmark({profileId:"default",url:"https://fixture.invalid/from-a",title:"Routing sync fixture A"});ac.store.getState().updateSettings({showFullUrl:true});return true;');
  await eventually(b, 'return Object.values(ac.store.getState().bookmarks.nodes).some(n=>n.title==="Routing sync fixture A") && ac.store.getState().settings.showFullUrl===true;');
  checks++;
  await b.eval('ac.store.getState().addBookmark({profileId:"default",url:"https://fixture.invalid/from-b",title:"Routing sync fixture B"});return true;');
  await eventually(a, 'return Object.values(ac.store.getState().bookmarks.nodes).some(n=>n.title==="Routing sync fixture B");');
  checks++;
  const routing = { routes: [{ id: "fixture", match: "contains", pattern: "fixture.invalid", destination: { kind: "profile", profileId: "default" } }], defaultDestination: { kind: "recent" } };
  await a.eval(`ac.store.getState().updateSettings({linkRouting:${JSON.stringify(routing)}});return true;`);
  await cycle();
  assert.equal(await b.eval('return ac.store.getState().settings.linkRouting.routes.length'), 0);
  checks++;
  const files = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
  assert.ok(existsSync(folder));
  const encrypted = files(folder).filter((path) => path.endsWith(".nns"));
  assert.ok(encrypted.length > 0);
  assert.ok(encrypted.every((path) => !readFileSync(path).includes(Buffer.from("Routing sync fixture"))));
  checks++;
  const routingDeviceSuffix = await a.eval('return ac.sync.useSync.getState().devices.some(d=>d.current && d.name.includes("Ardia Routing"))');
  console.log(JSON.stringify({ checks, result: "passed", work, doctors, routingDeviceSuffix }));
} catch (error) {
  failure = true;
  const health = [];
  for (const i of instances) if (i.alive) {
    try { health.push({ owned: i.stillOwned(), status: await i.eval("return ac.sync.useSync.getState().status") }); } catch { health.push({ owned: i.stillOwned(), status: "unresponsive" }); }
  }
  console.log(JSON.stringify({ result: "failed", work, checks, stage, errorType: error.name, health }));
} finally {
  for (const instance of instances.reverse()) { await instance.quit(); assert.ok(!instance.stillOwned()); }
}
if (failure) process.exitCode = 1;
