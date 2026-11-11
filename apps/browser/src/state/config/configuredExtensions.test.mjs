import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { useProfileLoading, openProfile } = await import("../profiles/profileLoading.ts");
const config = await import("./configuredExtensions.ts");
const { startConfigFiles, reconcileConfig, resetConfigFilesForTests } = await import("./configFiles.ts");
const { extensionsAdapterFor } = await import("../sync/extensions.ts");
const { readDocument } = await import("../../platform/documents.ts");
const { colorRoles } = await import("../../components/ui/tokens.ts");
const { firstWindowCommitted } = await import("../../lib/afterFirstWindow.ts");
const { useToasts } = await import("../app/toasts.ts");
const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
const S = () => useBrowser.getState();
const calls = [], reports = [], warnings = [], profiles = new Map();
console.warn = (...args) => warnings.push(args.join(" "));
let beforeList, beforeState, beforeApply;
function stateOf(profile) {
  if (!profiles.has(profile)) profiles.set(profile, { ready: true, installed: [], pending: new Set(), queued: new Map(), settling: [], intents: [], outcome: "pending" });
  return profiles.get(profile);
}
const port = native.ardiaCoreNativeModules.ArdiaExtensions;
const original = port.call;
port.call = async (verb, profile, json) => {
  if (!["list", "syncState", "syncApply", "watchActions"].includes(verb)) return original(verb, profile, json);
  const args = JSON.parse(json); calls.push({ verb, profile, ...args });
  const s = stateOf(profile);
  if (verb === "watchActions") return "null";
  if (verb === "list") { await beforeList?.(profile); return JSON.stringify({ extensions: s.installed }); }
  if (verb === "syncState") {
    await beforeState?.(profile);
    return JSON.stringify({ ready: s.ready, extensions: s.installed, pending: [...s.pending], queued: [...s.queued.keys()], settling: s.settling, intents: s.intents.splice(0) });
  }
  await beforeApply?.(profile, args);
  const installed = s.installed.find((extension) => extension.id === args.id);
  if (installed) {
    if (typeof args.record.on === "boolean") installed.enabled = args.record.on;
    if (typeof args.record.inc === "boolean") installed.incognito = args.record.inc;
    if (typeof args.record.pin === "boolean") installed.pinned = args.record.pin;
    return JSON.stringify({ state: "installed" });
  }
  if (s.outcome === "pending") { s.queued.set(args.id, args); s.pending.add(args.id); }
  return JSON.stringify({ state: s.outcome });
};
const applied = () => calls.filter((c) => c.verb === "syncApply");
const lists = () => calls.filter((c) => c.verb === "list");
function install(p, id, enabled = true) {
  const s = stateOf(p);
  s.installed.push({ id, enabled, syncable: true, userDisabled: !enabled, incognito: true, pinned: true, approved: false });
  s.pending.delete(id); s.queued.delete(id);
}
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
const profile = (id, extra = {}) => ({ id, name: id, color: "blue", icon: null, createdAt: 0, ...extra });
async function fresh() {
  resetConfigFilesForTests(); await settle(); native.configFolder.files.clear();
  S().hydrate({ profiles: { default: profile("default"), work: profile("work"), shared: profile("shared", { dataId: "work" }) }, profileOrder: ["default", "work", "shared"] });
  useProfileLoading.setState({ deferred: true, opened: { "": true } });
  calls.length = reports.length = warnings.length = 0; profiles.clear(); beforeList = beforeState = beforeApply = undefined;
}
afterEach(async () => { resetConfigFilesForTests(); await settle(); });
const start = (ids) => { config.configureExtensions(ids); config.startConfiguredExtensions((p) => reports.push(p)); };
const request = (profile, id) => ({ verb: "syncApply", profile, id, record: {} });

test("opened, shared and future profiles receive each missing ID once per engine", async () => {
  await fresh(); start([A]); await settle(); assert.deepEqual(applied(), [request("", A)]);
  openProfile("work"); await settle(); const future = S().createProfile({ name: "Future" }); await settle();
  assert.deepEqual(applied(), [request("", A), request("work", A)]);
  config.configureExtensions([B]); await settle(); openProfile(future); await settle();
  assert.deepEqual(applied(), [request("", A), request("work", A), request("", B), request("work", B), request(future, B)]);
  assert.deepEqual(reports.at(-1), []);
});

test("eager profiles receive all IDs and private windows never become targets", async () => {
  await fresh(); S().createWindow({ profileId: "work", kind: "private" });
  useProfileLoading.setState({ deferred: false, opened: {} }); start([A, B]); await settle();
  assert.deepEqual(applied(), [request("", A), request("", B), request("work", A), request("work", B)]);
});

test("enabled and disabled installed extensions retain every setting without syncState or syncApply", async () => {
  await fresh(); install("", A); install("", B, false); const before = structuredClone(stateOf("").installed);
  start([A, B]); await settle(); config.configureExtensions([A, B]); await settle();
  assert.deepEqual(stateOf("").installed, before);
  assert.deepEqual(calls.map((c) => c.verb), ["watchActions", "list", "watchActions", "list"]);
  assert.deepEqual(reports.at(-1), []);
});

test("removing an initially disabled configured extension reinstalls it with sync off", async () => {
  await fresh(); install("", A, false); start([A]); await settle();
  assert.deepEqual(applied(), []);
  stateOf("").installed = [];
  native.emitEvent("extensions.changed", { profile: "", id: A, event: "uninstalled" });
  await settle();
  assert.deepEqual(applied(), [request("", A)]);
});

test("sync's newer installed snapshot also prevents applying to an existing disabled extension", async () => {
  await fresh(); let once = true; beforeState = () => { if (once) { once = false; install("", A, false); } };
  start([A, B]); await settle(); assert.deepEqual(applied(), [request("", B)]); assert.equal(stateOf("").installed[0].enabled, false);
});

test("each batch item is checked again after an earlier asynchronous install request", async () => {
  await fresh(); beforeApply = (_profile, { id }) => { if (id === A) install("", B, false); };
  start([A, B]); await settle();
  assert.deepEqual(applied(), [request("", A)]);
  assert.deepEqual(stateOf("").installed, [{ id: B, enabled: false, syncable: true, userDisabled: true, incognito: true, pinned: true, approved: false }]);
});

test("the empty install record preserves disabled state and permissions if installation races the final check", async () => {
  await fresh(); beforeApply = () => install("", A, false); start([A]); await settle();
  assert.deepEqual(applied(), [request("", A)]);
  assert.deepEqual(stateOf("").installed, [{ id: A, enabled: false, syncable: true, userDisabled: true, incognito: true, pinned: true, approved: false }]);
  assert.deepEqual(reports.at(-1), []);
});

test("removal during an in-flight install stops the batch and later profiles without cancelling", async () => {
  await fresh(); openProfile("work"); let release;
  beforeApply = () => new Promise((r) => { release = r; }); start([A, B]); await settle();
  config.configureExtensions([]); await settle(); beforeApply = undefined; release(); await settle();
  assert.deepEqual(applied(), [request("", A)]); assert.deepEqual([...stateOf("").pending], [A]);
  install("", A); native.emitEvent("extensions.action", { profile: "", id: A, kind: "registry" }); await settle();
  assert.deepEqual(stateOf("").installed.map((e) => e.id), [A]); assert.deepEqual(reports.at(-1), []);
});

test("edits coalesce and removed profiles cannot be opened by stale work", async () => {
  await fresh(); openProfile("work"); let release;
  beforeList = () => new Promise((r) => { release = r; }); start([A]); await settle();
  config.configureExtensions([B]); config.configureExtensions([C]); S().deleteProfile("shared"); S().deleteProfile("work");
  beforeList = undefined; release(); await settle(); assert.deepEqual(applied(), [request("", C)]);
});

test("pending, settling and orphaned saved queues retain original sync records and approvals across reload", async () => {
  await fresh(); const record = { id: A, record: { on: false, inc: true, pin: true }, approval: { v: "2.0", fps: ["tabs"] } };
  const s = stateOf(""); s.pending.add(A); s.queued.set(A, record); s.queued.set(B, { ...record, id: B }); s.settling.push(C);
  const before = structuredClone([...s.queued]); start([A, B, C]); await settle(); config.configureExtensions([A, B, C]); await settle();
  assert.deepEqual(applied(), []); assert.deepEqual([...s.queued], before);
  assert.deepEqual(reports.at(-1), [`config.json: extension "${B}" in profile "default" is waiting for a saved sync install; its settings and approval were preserved`]);
});

test("sync intents drained during installation checks are saved by the existing sync owner", async () => {
  await fresh(); stateOf("").intents.push({ id: B, kind: "uninstalled" }, { id: C, kind: "installed" }); start([A]); await settle();
  const saved = JSON.parse(readDocument("sync-extensions.json"));
  assert.equal(saved.profiles[""][B].kind, "uninstalled"); assert.equal(saved.profiles[""][C].kind, "installed");
  assert.deepEqual(applied(), [request("", A)]);
});

test("a concurrent sync install finishes before config checks and preserves its approval", async () => {
  await fresh(); let release; const record = { on: false, inc: true, pin: true }, approval = { v: "2.0", fps: ["tabs"] };
  beforeApply = () => new Promise((r) => { release = r; });
  const syncing = extensionsAdapterFor("default").reconcile(new Map([[`ext:${A}`, record], [`ext:v:${A}`, approval]]), Date.now());
  await settle(); start([A]); await settle(); assert.deepEqual(applied(), [{ verb: "syncApply", profile: "", id: A, record, approval }]);
  beforeApply = undefined; release(); await syncing; await settle();
  assert.deepEqual(stateOf("").queued.get(A), { id: A, record, approval }); assert.equal(applied().length, 1);
});

test("bridge errors remain visible while another profile reconciles; reload retries", async () => {
  await fresh(); openProfile("work"); beforeList = (p) => { if (p === "") throw new Error("Web Store download refused"); };
  start([A]); await settle(); assert.deepEqual(applied(), [request("work", A)]);
  assert.deepEqual(reports.at(-1), ['config.json: extensions for profile "default": Web Store download refused']);
  beforeList = undefined; config.configureExtensions([A]); await settle();
  assert.deepEqual(applied(), [request("work", A), request("", A)]); assert.deepEqual(reports.at(-1), []);
});

test("native refusals reach warnings and config toasts; removal makes no more requests", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout"] }); const w = S().createWindow({ profileId: "default" }); firstWindowCommitted();
  stateOf("").outcome = "blocked"; native.configFolder.files.set("config.json", JSON.stringify({ extensions: [A] })); startConfigFiles(colorRoles);
  t.mock.timers.tick(0); await settle(); const problem = `config.json: extension "${A}" in profile "default" couldn't be added (blocked)`;
  assert.equal(useToasts.getState().toasts[w].title, problem); assert.ok(warnings.some((line) => line.includes(problem)));
  config.configureExtensions([]); await settle(); assert.deepEqual(applied(), [request("", A)]);
});

test("a real registry action event clears a timeout after late enabled completion without another apply", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout", "Date"] }); start([A]); await settle(); t.mock.timers.tick(60_000); await settle();
  assert.deepEqual(reports.at(-1), [`config.json: extension "${A}" in profile "default" hasn't finished downloading after 60 seconds; check the connection and Chrome Web Store availability`]);
  install("", A); native.emitEvent("extensions.action", { profile: "", id: A, kind: "registry" }); await settle();
  assert.deepEqual(reports.at(-1), []); assert.deepEqual(applied(), [request("", A)]);
});

test("slow polling clears a late disabled install even without a Chromium loaded event and then stops", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout", "Date"] }); start([A]); await settle(); t.mock.timers.tick(60_000); await settle();
  assert.match(reports.at(-1)[0], /hasn't finished downloading/); install("", A, false); t.mock.timers.tick(15_000); await settle();
  assert.deepEqual(reports.at(-1), []); assert.equal(stateOf("").installed[0].enabled, false); assert.deepEqual(applied(), [request("", A)]);
  const count = lists().length; t.mock.timers.tick(60_000); await settle(); assert.equal(lists().length, count);
});

test("sync events recheck completed saved queues without taking over their work", async () => {
  await fresh(); stateOf("").queued.set(A, { record: { on: false, inc: true, pin: true } }); start([A]); await settle();
  assert.match(reports.at(-1)[0], /saved sync install/); install("", A, false); native.emitEvent("extensions.sync", { profile: "", id: A, kind: "installed" }); await settle();
  assert.deepEqual(reports.at(-1), []); assert.deepEqual(applied(), []);
});

test("profile readiness has a deadline and config reload retries", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout", "Date"] }); stateOf("").ready = false; start([A]); await settle();
  t.mock.timers.tick(1000); await settle(); assert.equal(calls.filter((c) => c.verb === "syncState").length, 2);
  t.mock.timers.tick(30_000); await settle(); assert.deepEqual(reports.at(-1), ['config.json: extensions couldn\'t load because profile "default" isn\'t ready']);
  stateOf("").ready = true; config.configureExtensions([A]); await settle(); assert.deepEqual(applied(), [request("", A)]); assert.deepEqual(reports.at(-1), []);
});

test("launch, edits, invalid JSON, key removal and file deletion follow add-only semantics", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout"] }); firstWindowCommitted(); const files = native.configFolder.files;
  files.set("config.json", JSON.stringify({ extensions: [A, A] })); startConfigFiles(colorRoles); assert.deepEqual(calls, []);
  useProfileLoading.setState({ deferred: true, opened: { work: true } }); t.mock.timers.tick(0); await settle(); assert.deepEqual(applied(), [request("work", A)]);
  t.mock.timers.tick(100); await settle(); files.set("config.json", JSON.stringify({ extensions: [B] })); native.emitConfigChange();
  t.mock.timers.tick(100); await settle(); assert.deepEqual(applied().at(-1), request("work", B));
  const before = calls.length; files.set("config.json", "{"); reconcileConfig(); await settle();
  assert.equal(calls.length, before); assert.ok(warnings.some((w) => w.includes("isn't valid JSON")));
  files.set("config.json", "{}"); reconcileConfig(); await settle(); files.set("config.json", JSON.stringify({ extensions: [A] })); reconcileConfig(); await settle();
  files.delete("config.json"); reconcileConfig(); await settle(); assert.deepEqual(applied(), [request("work", A), request("work", B)]);
  assert.deepEqual([...stateOf("work").pending], [A, B]);
});

test("quitting during a request prevents the next ID and next profile", async () => {
  await fresh(); openProfile("work"); let release; const { setQuitting } = await import("../app/quit.ts");
  beforeApply = () => new Promise((r) => { release = r; }); start([A, B]); await settle(); setQuitting(true);
  try { beforeApply = undefined; release(); await settle(); config.configureExtensions([B]); await settle(); assert.deepEqual(applied(), [request("", A)]); }
  finally { setQuitting(false); }
});

test("polls and duplicate events are idempotent; reload retries a refused request", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout", "Date"] }); stateOf("").outcome = "refused"; start([A]); await settle();
  native.emitEvent("extensions.action", { profile: "", id: A, kind: "registry" }); native.emitEvent("extensions.action", { profile: "", id: A, kind: "registry" }); await settle();
  assert.deepEqual(applied(), [request("", A)]); stateOf("").outcome = "pending"; config.configureExtensions([A]); await settle();
  t.mock.timers.tick(1000); await settle(); assert.deepEqual(applied(), [request("", A), request("", A)]); assert.deepEqual(reports.at(-1), []);
});

test("invalid config at launch makes no native request until a valid list arrives", async (t) => {
  await fresh(); t.mock.timers.enable({ apis: ["setTimeout"] }); firstWindowCommitted(); native.configFolder.files.set("config.json", "{"); startConfigFiles(colorRoles);
  t.mock.timers.tick(0); await settle(); assert.deepEqual(calls, []);
  native.configFolder.files.set("config.json", JSON.stringify({ extensions: [B] })); reconcileConfig(); await settle(); assert.deepEqual(applied(), [request("", B)]);
});

test("telemetry contains counts and fixed outcomes without IDs", async () => {
  await fresh(); const { flushLocalNow } = await import("../telemetry/localStore.ts"); const { scrubText } = await import("../telemetry/sanitize.ts");
  flushLocalNow(); native.telemetryLocal.reset(); stateOf("").outcome = "blocked"; start([A]); await settle(); flushLocalNow();
  const records = native.telemetryLocal.records().filter((r) => r.event === "configured_extensions");
  assert.deepEqual(records.map((r) => ({ sent: r.sent, outcome: r.properties.outcome, count: r.properties.count })), [
    { sent: false, outcome: "blocked", count: 1 }, { sent: false, outcome: "error", count: 1 },
  ]);
  assert.equal(JSON.stringify(records).includes(A), false); assert.equal(scrubText(reports.at(-1)[0]), "<file>: extension <text>");
});
