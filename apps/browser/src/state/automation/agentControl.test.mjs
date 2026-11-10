import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { agentSocket } = await import("../../test-native/index.ts");
const { setAgentControl, useAgentControl, handleAgentRequest, approveAgent, revokeAgent } = await import("./agentControl.ts");
let id = 0;
async function request(method, params = {}, connection = 1, generation = agentSocket.generation) {
  const requestId = ++id;
  await handleAgentRequest({ connection, generation, authorization: agentSocket.sessions.get(connection)?.authorization, line: JSON.stringify({ id: requestId, method, params }) });
  return JSON.parse(agentSocket.replies.findLast(r => r.connection === connection && JSON.parse(r.line).id === requestId).line);
}
async function fresh() {
  useBrowser.getState().hydrate({});
  useBrowser.getState().updateSettings({ cliControl: false });
  globalThis.acTestCliControl = async () => ({ state: "off", connections: 0 });
  await setAgentControl(true);
}

test("connections reveal no browser state before approval; grants belong to one connection", async () => {
  await fresh();
  useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  assert.equal((await request("connect", { name: "Test agent" })).result.approved, false);
  assert.ok((await request("list_tabs")).error);
  await approveAgent(1, ["default"], false, false);
  assert.equal((await request("list_tabs")).result.length, 1);
  assert.ok((await request("list_tabs", {}, 2)).error);
  assert.ok((await request("open_tab", { profile: "default", url: "https://x.example/" })).error);
});

test("private tabs, internal pages and unapproved profiles are hidden and cannot be targeted", async () => {
  await fresh();
  const s = useBrowser.getState();
  const w = s.createWindow({ url: "https://allowed.example/" });
  const internal = s.newTab(w, { url: "chrome://settings" });
  s.createWindow({ kind: "private", url: "https://private.example/" });
  s.createProfile({ name: "Secret" });
  const other = Object.values(useBrowser.getState().profiles).find(p => p.name === "Secret").id;
  const hidden = useBrowser.getState().newTab(w, { profileId: other, url: "https://secret.example/" });
  await request("connect");
  await approveAgent(1, ["default"], true, false);
  assert.equal((await request("list_tabs")).result.length, 1);
  for (const tab of [internal, hidden]) assert.ok((await request("snapshot", { tab })).error);
  assert.ok((await request("open_tab", { profile: other, url: "https://secret.example/" })).error);
  assert.ok((await request("open_tab", { profile: "default", url: "file:///etc/passwd" })).error);
});

test("scripts, stale generations, expiry and revocation fail closed", async () => {
  await fresh();
  const w = useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  const tab = Object.values(useBrowser.getState().tabs).find(t => t.windowId === w).id;
  await request("connect");
  await approveAgent(1, ["default"], true, false);
  assert.ok((await request("script", { tab, script: "return 1", snapshot: "x" })).error);
  assert.ok((await request("list_tabs", {}, 1, agentSocket.generation - 1)).error);
  useAgentControl.setState(s => ({ sessions: s.sessions.map(a => ({ ...a, expires: 1 })) }));
  assert.ok((await request("list_tabs")).error);
  await revokeAgent(1);
  assert.ok((await request("list_tabs")).error);
});

test("external DevTools and global CLI block scoped agents; global activation stops an existing session", async () => {
  await fresh();
  globalThis.acTestCliControl = async () => ({ state: "external", connections: 0 });
  await setAgentControl(true);
  assert.equal(useAgentControl.getState().enabled, false);
  assert.match(useAgentControl.getState().reason, /DevTools/);
  await fresh();
  await request("connect");
  await approveAgent(1, ["default"], true, false);
  useBrowser.getState().updateSettings({ cliControl: true });
  assert.ok((await request("list_tabs")).error);
  assert.equal(useAgentControl.getState().enabled, false);
  delete globalThis.acTestCliControl;
});

test("remembered native grants reconnect with exact scopes and identity-wide revoke clears every session", async () => {
  await fresh();
  agentSocket.identities.set(1, "persistent-client");
  agentSocket.identities.set(2, "persistent-client");
  await request("connect");
  await approveAgent(1, ["default"], false, false, true);
  assert.equal(useAgentControl.getState().remembered.length, 1);
  const grant = useAgentControl.getState().sessions[0];
  assert.equal(grant.remembered, true);
  assert.equal(grant.expires, 0);
  await setAgentControl(true);
  assert.equal((await request("connect")).result.approved, true);
  assert.deepEqual((await request("list_profiles")).result.map(p => p.id), ["default"]);
  await request("connect", {}, 2);
  assert.equal(useAgentControl.getState().sessions.filter(s => s.approved).length, 2);
  await revokeAgent(1);
  assert.equal(useAgentControl.getState().sessions.length, 0);
  assert.equal(useAgentControl.getState().remembered.length, 0);
  assert.ok((await request("list_profiles", {}, 2)).error);
  await setAgentControl(true);
  assert.equal((await request("connect")).result.approved, false);
  agentSocket.identities.clear();
});

test("list, open and close consult native authority even when JavaScript still has an approved session", async () => {
  await fresh();
  const w = useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  const tab = Object.values(useBrowser.getState().tabs).find(t => t.windowId === w).id;
  await request("connect");
  await approveAgent(1, ["default"], true, true);
  agentSocket.deny = true;
  for (const [method, params] of [["list_tabs", {}], ["list_profiles", {}], ["open_tab", { profile: "default", url: "https://new.example/" }], ["close_tab", { tab }]]) assert.ok((await request(method, params)).error);
  assert.ok(useBrowser.getState().tabs[tab]);
  assert.ok(!Object.values(useBrowser.getState().tabs).some(t => t.url === "https://new.example/"));
  agentSocket.deny = false;
});

test("replacing a profile's native identity never inherits its prior approval", async () => {
  await fresh();
  await request("connect");
  await approveAgent(1, ["default"], true, true);
  useBrowser.setState(s => ({ profiles: { ...s.profiles, default: { ...s.profiles.default, dataId: "replacement" } } }));
  assert.ok((await request("list_profiles")).error);
  assert.ok((await request("open_tab", { profile: "default", url: "https://new.example/" })).error);
});

test("revoke during delayed approval cannot restore the JavaScript session", async () => {
  await fresh();
  await request("connect");
  let release;
  agentSocket.beforeGrant = () => new Promise(resolve => { release = resolve; });
  const approving = approveAgent(1, ["default"], true, true, true);
  await revokeAgent(1);
  release();
  await approving;
  agentSocket.beforeGrant = null;
  assert.equal(useAgentControl.getState().sessions.length, 0);
  assert.equal(useAgentControl.getState().remembered.length, 0);
  assert.ok((await request("list_tabs")).error);
});

test("revoke while a broker mutation awaits native authorization prevents the mutation", async () => {
  await fresh();
  useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  await request("connect");
  await approveAgent(1, ["default"], true, false);
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  agentSocket.beforeAccess = () => new Promise(resolve => { release = resolve; entered(); });
  const opening = request("open_tab", { profile: "default", url: "https://blocked.example/" });
  await waiting;
  await revokeAgent(1);
  release();
  await opening;
  agentSocket.beforeAccess = null;
  assert.ok(!Object.values(useBrowser.getState().tabs).some(t => t.url === "https://blocked.example/"));
});

test("close refuses a tab moved into another profile during authorization", async () => {
  await fresh();
  const w = useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  useBrowser.getState().createProfile({ name: "Other" });
  const other = Object.values(useBrowser.getState().profiles).find(p => p.name === "Other").id;
  const tab = Object.values(useBrowser.getState().tabs).find(t => t.windowId === w).id;
  await request("connect");
  await approveAgent(1, ["default", other], true, false);
  agentSocket.beforeAccess = async () => {
    useBrowser.setState(s => ({ profiles: { ...s.profiles, [other]: { ...s.profiles[other], dataId: "replacement" } }, tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], profileId: other } } }));
  };
  try {
    assert.ok((await request("close_tab", { tab })).error);
    assert.ok(useBrowser.getState().tabs[tab]);
  } finally { agentSocket.beforeAccess = null; }
});

test("enumeration snapshots each authorized profile before checking the next", async () => {
  await fresh();
  const w = useBrowser.getState().createWindow({ url: "https://allowed.example/" });
  useBrowser.getState().createProfile({ name: "Other" });
  const other = Object.values(useBrowser.getState().profiles).find(p => p.name === "Other").id;
  const tab = Object.values(useBrowser.getState().tabs).find(t => t.windowId === w).id;
  await request("connect");
  await approveAgent(1, ["default", other], false, false);
  let count = 0;
  agentSocket.beforeAccess = async () => {
    if (++count === 2) useBrowser.setState(s => ({ profiles: { ...s.profiles, default: { ...s.profiles.default, dataId: "replacement", name: "Private replacement" } }, tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], url: "https://replacement.example/", title: "Private replacement" } } }));
  };
  try {
    const result = await request("list_tabs");
    assert.ok(result.result);
    assert.ok(!result.result.some(t => t.url === "https://replacement.example/"));
  } finally { agentSocket.beforeAccess = null; }
});
