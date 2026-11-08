import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { agentSocket } = await import("../../test-native/index.ts");
const { setAgentControl, useAgentControl, handleAgentRequest, approveAgent, revokeAgent } = await import("./agentControl.ts");
let id = 0;
async function request(method, params = {}, connection = 1, generation = agentSocket.generation) {
  const requestId = ++id;
  await handleAgentRequest({ connection, generation, line: JSON.stringify({ id: requestId, method, params }) });
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
