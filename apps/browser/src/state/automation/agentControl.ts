import { create } from "zustand";
import { startAgentSocket, stopAgentSocket, replyToAgent, grantAgentAccess, revokeAgentAccess, onAgentRequest, onAgentClose, agentAccess, agentStatus, type AgentGrant, type ControlRequest } from "../../platform/automation";
import { call } from "../../platform/engine";
import { cliControlStatus, onCliControlChanged } from "../../platform/cli";
import { engineProfile } from "../browser/model";
import { useBrowser } from "../browser/store";
import { isEligibleTab } from "./automationWindows";
import { parseRequest } from "./automationMethods";
import { capture } from "../telemetry/client";

export type AgentSession = AgentGrant & { connection: number; generation: number; approved: boolean };
export const useAgentControl = create<{ enabled: boolean; reason: string | null; sessions: AgentSession[]; remembered: AgentGrant[] }>()(() => ({ enabled: false, reason: null, sessions: [], remembered: [] }));
let generation: number | null = null;
let revision = 0;
let started = false;
const tools = new Set(["connect", "list_profiles", "list_tabs", "open_tab", "close_tab", "snapshot", "click", "fill", "press_key", "scroll", "screenshot", "navigate", "script"]);
const busy = new Set<number>();
const closed = new Set<number>();
const session = (connection: number) => useAgentControl.getState().sessions.find(s => s.connection === connection && s.generation === generation);
const profilesOf = () => Object.values(useBrowser.getState().profiles).filter(p => !p.id.startsWith("incognito"));
const safeURL = (value: unknown) => {
  if (typeof value !== "string" || value.length > 8192) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
};
const error = (message: string) => ({ error: { code: "refused", message } });
const reply = (connection: number, id: unknown, result: unknown) => replyToAgent(connection, JSON.stringify({ id, ...result as object }));

export async function setAgentControl(enabled: boolean) {
  const mine = ++revision;
  generation = null;
  closed.clear();
  useAgentControl.setState({ enabled: false, sessions: [], reason: null });
  await stopAgentSocket(enabled);
  await refreshRemembered();
  if (!enabled || mine !== revision) return;
  const status = await cliControlStatus();
  if (mine !== revision) return;
  if (useBrowser.getState().settings.cliControl || status.state !== "off") {
    useAgentControl.setState({ reason: "Turn off command-line control and restart without a DevTools port before enabling scoped agents." });
    return;
  }
  const socket = await startAgentSocket();
  if (mine !== revision) { await stopAgentSocket(true); return; }
  generation = socket.state === "on" ? socket.generation : null;
  useAgentControl.setState({ enabled: generation !== null, reason: socket.reason ?? null });
}

let viewRevision = 0;
async function refreshRemembered() {
  const mine = ++viewRevision;
  const status = await agentStatus();
  if (mine === viewRevision) useAgentControl.setState({ remembered: status.remembered, ...(status.storageFailed ? { reason: "Agent access storage is unavailable. Existing data was left in place." } : {}) });
  return status;
}

export async function approveAgent(connection: number, profiles: string[], actions: boolean, scripts: boolean, remember = false) {
  const current = session(connection);
  const ids = [...new Set(profiles.filter(id => profilesOf().some(p => p.id === id)))];
  if (!current || current.approved || !ids.length) return;
  const granted = await grantAgentAccess(connection, current.generation, current.authorization, Object.fromEntries(ids.map(id => [id, engineProfile(useBrowser.getState(), id)])), actions, actions && scripts, remember);
  if (!granted || session(connection) !== current) { if (!granted) await refreshRemembered(); return; }
  const native = await agentAccess(connection, current.generation, current.authorization, "", "", "connect");
  if (!native?.approved || session(connection) !== current) return;
  useAgentControl.setState(s => ({ sessions: s.sessions.map(a => a === current ? { ...a, ...native, approved: true } : a) }));
  await refreshRemembered();
  capture("agent_control", { action: remember ? "remembered" : "approved", profiles: ids.length, scripts: actions && scripts });
}

export async function revokeAgent(connection: number, identity = session(connection)?.identity ?? "") {
  ++viewRevision;
  useAgentControl.setState(s => ({ sessions: s.sessions.filter(a => a.connection !== connection && (!identity || a.identity !== identity)), remembered: s.remembered.filter(a => a.identity !== identity) }));
  const saved = await revokeAgentAccess(connection, identity);
  await refreshRemembered();
  if (!saved) useAgentControl.setState({ reason: "Revocation could not be saved. Agent access is blocked until storage is repaired." });
  capture("agent_control", { action: "revoked" });
}

function authorized(connection: number) {
  const current = session(connection);
  if (!current?.approved || !current.remembered && current.expires <= Date.now() || !useAgentControl.getState().enabled) throw new Error("Approve this connection in Settings → Advanced → Agents.");
  return current;
}

async function checkAuthority(agent: AgentSession, profile: string, operation: string) {
  const state = useBrowser.getState();
  if (!state.profiles[profile] || profile.startsWith("incognito")) throw new Error("Profile unavailable");
  const nativeProfile = engineProfile(state, profile);
  const native = await agentAccess(agent.connection, agent.generation, agent.authorization, profile, nativeProfile, operation);
  if (!native?.approved || native.authorization !== agent.authorization || session(agent.connection) !== agent || engineProfile(useBrowser.getState(), profile) !== nativeProfile || !useAgentControl.getState().enabled) throw new Error("Agent access expired or was revoked");
}

function tabFor(agent: AgentSession, id: unknown) {
  const state = useBrowser.getState();
  const tab = typeof id === "string" ? state.tabs[id] : undefined;
  if (!tab || !agent.profiles.includes(tab.profileId) || !isEligibleTab(state, tab.id) || !safeURL(tab.url)) throw new Error("Tab unavailable or outside approved profiles");
  return tab;
}

async function dispatch(connection: number, method: string, params: Record<string, unknown>, requestAuthorization?: string) {
  if (method === "connect") {
    const native = await agentAccess(connection, generation!, requestAuthorization ?? "", "", "", "connect");
    if (!native || closed.has(connection) || !useAgentControl.getState().enabled) throw new Error("Connection expired");
    const agent = { ...native, connection, generation: generation!, approved: !!native.approved };
    useAgentControl.setState(s => ({ sessions: [...s.sessions.filter(a => a.connection !== connection), agent] }));
    if (native.approved) capture("agent_control", { action: "reconnected", profiles: native.profiles.length, scripts: native.scripts });
    return { approved: agent.approved, instructions: "Approve this connection in Settings → Advanced → Agents." };
  }
  const agent = authorized(connection);
  if (requestAuthorization !== agent.authorization) throw new Error("Request authorization changed; retry the request");
  if (method === "list_profiles" || method === "list_tabs") {
    let available = 0;
    const result: { id: string; name?: string; profile?: string; url?: string; title?: string }[] = [];
    for (const profile of profilesOf().filter(p => agent.profiles.includes(p.id))) {
      try {
        await checkAuthority(agent, profile.id, method);
        available++;
        if (method === "list_profiles") result.push({ id: profile.id, name: profile.name });
        else for (const tab of Object.values(useBrowser.getState().tabs)) {
          try { if (tab.profileId === profile.id && tabFor(agent, tab.id)) result.push({ id: tab.id, profile: tab.profileId, url: tab.url, title: tab.title }); } catch { }
        }
      } catch { }
    }
    if (!available) throw new Error("No approved profiles are available");
    return result;
  }
  if (method === "open_tab") {
    if (!agent.actions || typeof params.profile !== "string" || !agent.profiles.includes(params.profile) || !safeURL(params.url)) throw new Error("Profile or destination not allowed");
    await checkAuthority(agent, params.profile, method);
    const state = useBrowser.getState();
    const window = Object.values(state.windows).find(w => w.kind !== "private" && agent.profiles.includes(w.profileId));
    if (!window) throw new Error("Open an approved profile in a browser window first");
    const id = state.newTab(window.id, { url: params.url as string, profileId: params.profile, background: true, gated: true });
    return { tab: id };
  }
  const tab = tabFor(agent, params.tab);
  if (method === "close_tab") {
    if (!agent.actions) throw new Error("Actions were not approved");
    await checkAuthority(agent, tab.profileId, method);
    if (tabFor(agent, tab.id).profileId !== tab.profileId) throw new Error("Tab profile changed; retry the request");
    useBrowser.getState().closeTab(tab.id);
    return { ok: true };
  }
  if (!["snapshot", "click", "fill", "press_key", "scroll", "screenshot", "navigate", "script"].includes(method)) throw new Error("Unknown agent tool");
  if (!["snapshot", "screenshot"].includes(method) && !agent.actions) throw new Error("Actions were not approved");
  if (method === "script" && (!agent.scripts || typeof params.script !== "string" || params.script.length > 16000)) throw new Error("Page scripts were not approved");
  if (method === "navigate" && !safeURL(params.destination)) throw new Error("Only HTTP and HTTPS destinations are allowed");
  if (["click", "fill", "press_key", "scroll", "script"].includes(method) && (typeof params.snapshot !== "string" || params.snapshot.length > 80)) throw new Error("Take a fresh snapshot first");
  if (["click", "fill", "press_key"].includes(method) && (typeof params.ref !== "string" || !/^\d{1,3}$/.test(params.ref))) throw new Error("Use an element ref from the snapshot");
  if (method === "fill" && (typeof params.text !== "string" || params.text.length > 16000)) throw new Error("Text too long");
  if (method === "press_key" && !["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(params.key as string)) throw new Error("Unsupported key");
  if (method === "scroll" && (typeof params.delta !== "number" || !Number.isFinite(params.delta) || Math.abs(params.delta) > 5000)) throw new Error("Scroll delta must be between -5000 and 5000");
  await checkAuthority(agent, tab.profileId, method);
  return call("engine.agentPage", { ...params, connection, authorization: agent.authorization, stableProfile: tab.profileId, generation: agent.generation, profile: engineProfile(useBrowser.getState(), tab.profileId), tab: tab.id, url: tab.url, operation: method });
}

export async function handleAgentRequest(request: ControlRequest) {
  const parsed = parseRequest(request.line);
  if ("error" in parsed) return reply(request.connection, parsed.id, { error: parsed.error });
  const { id, method, params } = parsed;
  if (generation === null || request.generation !== generation || !useAgentControl.getState().enabled) return reply(request.connection, id, error("Agent control is off"));
  if (busy.has(request.connection)) return reply(request.connection, id, error("Another action is still running"));
  busy.add(request.connection);
  const mine = generation;
  try {
    const status = await cliControlStatus();
    if (status.state !== "off" || useBrowser.getState().settings.cliControl) { await setAgentControl(false); throw new Error("Global browser control became active; scoped agents stopped"); }
    if (mine !== generation || closed.has(request.connection)) throw new Error("Connection expired");
    const result = await dispatch(request.connection, method, params, request.authorization);
    if (mine !== generation || closed.has(request.connection) || (method !== "connect" && !session(request.connection)?.approved)) return;
    reply(request.connection, id, { result });
    capture("agent_control", { action: "tool", tool: method });
  } catch (failure) {
    capture("agent_control", { action: "refused", tool: tools.has(method) ? method : "unknown" });
    reply(request.connection, id, error(failure instanceof Error ? failure.message : "Agent action failed"));
  } finally { busy.delete(request.connection); }
}

export function startAgentControl() {
  if (started) return;
  started = true;
  const initialRevision = revision;
  void refreshRemembered().then(status => { if (status.enabled && revision === initialRevision) return setAgentControl(true); });
  setInterval(() => {
    for (const agent of useAgentControl.getState().sessions) if (agent.approved && !agent.remembered && agent.expires <= Date.now()) void revokeAgent(agent.connection);
  }, 15000);
  onAgentRequest(handleAgentRequest);
  onAgentClose( ({ connection }) => {
    closed.add(connection);
    useAgentControl.setState(s => ({ sessions: s.sessions.filter(a => a.connection !== connection) }));
  });
  onCliControlChanged(status => {
    if (status.state !== "off" && useAgentControl.getState().enabled) void setAgentControl(false);
  });
  useBrowser.subscribe(s => {
    if (s.settings.cliControl && useAgentControl.getState().enabled) void setAgentControl(false);
  });
}
