#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { launch, session, sleep, listenerPids } = await import(join(repo, "scripts/lib/instance.mjs"));
assert.equal(process.argv[2] ?? "prove", "prove", "Usage: verify.mjs prove [built-app]");
const app = resolve(process.argv[3] ?? join(repo, "apps/browser/build-routing/Build/Products/Release/Ardia.app"));
const evidence = join(repo, "output/verification/ardia", `${Date.now()}-${randomUUID().slice(0, 8)}`);
mkdirSync(evidence, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "ardia-verify-"));
const canonicalData = realpathSync(data);
const token = randomUUID();
writeFileSync(join(data, "verification-owner"), token);
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2));
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(req.url === "/source" ? '<html><body><h1>Personal profile</h1><a id="route-work" href="/route-fixture">Open work page</a></body></html>' : '<html><body><h1>Work destination</h1><p>Routing verification fixture</p></body></html>');
});
let instance;
let failure;
try {
  await new Promise((r, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fixture = session({
    profiles: ["Personal", { id: "verify-work", name: "Work" }],
    windows: [{ id: "verify-window" }],
    tabs: [{ id: "verify-source", url: `${base}/source`, title: "Personal profile" }],
    settings: { linkRouting: { routes: [{ id: "verify-route", match: "contains", pattern: "route-fixture", destination: { kind: "profile", profileId: "verify-work" } }], defaultDestination: { kind: "recent" } } },
  });
  instance = await launch(app, { data, js: "none", probe: true, onboarded: true, session: fixture,
    ready: { timeout: 60000, test: 'return !!ac.store.getState().windows["verify-window"] && ac.webviews.has("verify-source")' },
  });
  save("instance.json", { app, data, pid: instance.pid, started: instance.started, port: instance.port });
  assert.ok(instance.alive);
  assert.deepEqual(listenerPids(instance.port), [instance.pid]);
  const state = await instance.eval('const s=ac.store.getState();return {profiles:Object.keys(s.profiles),routes:s.settings.linkRouting,windows:Object.keys(s.windows)}');
  assert.ok(state.profiles.includes("verify-work"));
  assert.equal(state.routes.routes[0].pattern, "route-fixture");
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { timeout: 30000 });
  save("doctor.json", { owned: true, isolated: true, signatureValid: true, state, nativeWindows: await instance.eval('return ac.engine.call("windows.list",{})') });
  const source = await instance.page(`${base}/source`);
  try {
    const end = Date.now() + 15000;
    while (!(await source.eval('!!document.querySelector("#route-work")')) && Date.now() < end) await sleep(100);
    const box = await source.eval('(()=>{const r=document.querySelector("#route-work").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    const capture = async (page, name) => {
      const result = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(evidence, name), Buffer.from(result.data, "base64"));
    };
    await capture(source, "before.png");
    save("action.json", { target: "#route-work", label: "Open work page", input: "CDP Input.dispatchMouseEvent", box, limitations: "Scratch instances bypass the native physical-mouse gate. This does not prove that gate, Settings editing, or native keyboard input." });
    await source.send("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
    await source.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
    let result;
    const deadline = Date.now() + 20000;
    do {
      result = await instance.eval('const s=ac.store.getState();return {tabs:Object.values(s.tabs).map(t=>({id:t.id,url:t.url,profileId:t.profileId})),windows:Object.values(s.windows).map(w=>({id:w.id,profileId:w.profileId}))}');
      if (result.tabs.some(t => t.url === `${base}/route-fixture` && t.profileId === "verify-work")) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert.ok(result.tabs.some(t => t.url === `${base}/route-fixture` && t.profileId === "verify-work"));
    assert.equal(result.tabs.find(t => t.id === "verify-source").url, `${base}/source`);
    const destination = await instance.page(`${base}/route-fixture`);
    try {
      const loadDeadline = Date.now() + 15000;
      while (await destination.eval("document.querySelector('h1')?.textContent") !== "Work destination" && Date.now() < loadDeadline) await sleep(100);
      assert.equal(await destination.eval("document.querySelector('h1')?.textContent"), "Work destination");
      await capture(destination, "after.png");
    } finally { destination.close(); }
    assert.ok(requests.includes("/route-fixture"));
    let persisted;
    const persistDeadline = Date.now() + 15000;
    do {
      persisted = JSON.parse(readFileSync(join(data, "session.json"), "utf8"));
      if (persisted.tabs.some(t => t.url === `${base}/route-fixture` && t.profileId === "verify-work")) break;
      await sleep(100);
    } while (Date.now() < persistDeadline);
    assert.ok(persisted.tabs.some(t => t.url === `${base}/route-fixture` && t.profileId === "verify-work"));
    save("result.json", { passed: true, result, requests, persisted: true, scope: "Internal page click routes to Work while preserving source tab" });
  } finally { source.close(); }
} catch (error) {
  failure = error;
  save("failure.json", { error: error.stack });
} finally {
  if (instance) {
    if (existsSync(instance.log)) writeFileSync(join(evidence, "app.log"), readFileSync(instance.log));
    await instance.quit();
    assert.ok(!instance.stillOwned(), "Instance still running; refuse scratch removal");
  }
  await new Promise(r => server.close(r));
  assert.equal(realpathSync(data), canonicalData);
  assert.ok(canonicalData.startsWith(join(realpathSync(tmpdir()), "ardia-verify-")));
  assert.equal(readFileSync(join(data, "verification-owner"), "utf8"), token);
  rmSync(data, { recursive: true });
  save("cleanup.json", { instanceStopped: !instance || !instance.stillOwned(), scratchRemoved: !existsSync(data), evidencePreserved: existsSync(join(evidence, failure ? "failure.json" : "result.json")) });
}
console.log(JSON.stringify({ passed: !failure, evidence }));
if (failure) throw failure;
