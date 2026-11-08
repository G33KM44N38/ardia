import { create } from "zustand";
import { startAgentSocket, stopAgentSocket, replyToAgent, grantAgentAccess, revokeAgentAccess, onAgentRequest, onAgentClose, type ControlRequest } from "../../platform/automation";
import { call } from "../../platform/engine";
import { cliControlStatus, onCliControlChanged } from "../../platform/cli";
import { engineProfile } from "../browser/model";
import { useBrowser } from "../browser/store";
import { isEligibleTab } from "./automationWindows";
import { parseRequest } from "./automationMethods";
import { capture } from "../telemetry/client";

export type AgentSession = { connection: number; generation: number; name: string; profiles: string[]; actions: boolean; scripts: boolean; approved: boolean; expires: number };
export const useAgentControl = create<{ enabled: boolean; reason: string | null; sessions: AgentSession[] }>()(() => ({ enabled: false, reason: null, sessions: [] }));
let generation: number | null = null;
let revision = 0;
let started = false;
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
  await stopAgentSocket();
  if (!enabled || mine !== revision) return;
  const status = await cliControlStatus();
  if (mine !== revision) return;
  if (useBrowser.getState().settings.cliControl || status.state !== "off") {
    useAgentControl.setState({ reason: "Turn off command-line control and restart without a DevTools port before enabling scoped agents." });
    return;
  }
  const socket = await startAgentSocket();
  if (mine !== revision) { await stopAgentSocket(); return; }
  generation = socket.state === "on" ? socket.generation : null;
  useAgentControl.setState({ enabled: generation !== null, reason: socket.reason ?? null });
}

export async function approveAgent(connection: number, profiles: string[], actions: boolean, scripts: boolean) {
  const current = session(connection);
  const ids = profiles.filter(id => profilesOf().some(p => p.id === id));
  if (!current || current.approved || !ids.length) return;
  const granted = await grantAgentAccess(connection, current.generation, ids.map(id => engineProfile(useBrowser.getState(), id)), actions, actions && scripts);
  if (!granted || session(connection) !== current) return;
  useAgentControl.setState(s => ({ sessions: s.sessions.map(a => a === current ? { ...a, profiles: ids, actions, scripts: actions && scripts, approved: true, expires: Date.now() + 3600000 } : a) }));
  capture("agent_control", { action: "approved", profiles: ids.length, scripts: actions && scripts });
}

export async function revokeAgent(connection: number) {
  useAgentControl.setState(s => ({ sessions: s.sessions.filter(a => a.connection !== connection) }));
  await revokeAgentAccess(connection);
  capture("agent_control", { action: "revoked" });
}

function authorized(connection: number) {
  const current = session(connection);
  if (!current?.approved || current.expires <= Date.now() || !useAgentControl.getState().enabled) throw new Error("Approve this connection in Settings → Advanced → Agents. Approval lasts one hour.");
  return current;
}

function tabFor(agent: AgentSession, id: unknown) {
  const state = useBrowser.getState();
  const tab = typeof id === "string" ? state.tabs[id] : undefined;
  if (!tab || !agent.profiles.includes(tab.profileId) || !isEligibleTab(state, tab.id) || !safeURL(tab.url)) throw new Error("Tab unavailable or outside approved profiles");
  return tab;
}

async function dispatch(connection: number, method: string, params: Record<string, unknown>) {
  if (method === "connect") {
    const existing = session(connection);
    if (!existing) {
      const name = typeof params.name === "string" ? params.name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").slice(0, 60).trim() : "Agent";
      useAgentControl.setState(s => ({ sessions: [...s.sessions, { connection, generation: generation!, name: name || "Agent", profiles: [], actions: false, scripts: false, approved: false, expires: 0 }] }));
    }
    return { approved: !!session(connection)?.approved, instructions: "Approve this connection in Settings → Advanced → Agents." };
  }
  const agent = authorized(connection);
  if (method === "list_profiles") return profilesOf().filter(p => agent.profiles.includes(p.id)).map(p => ({ id: p.id, name: p.name }));
  if (method === "list_tabs") return Object.values(useBrowser.getState().tabs).filter(t => {
    try { return !!tabFor(agent, t.id); } catch { return false; }
  }).map(t => ({ id: t.id, profile: t.profileId, url: t.url, title: t.title }));
  if (method === "open_tab") {
    if (!agent.actions || typeof params.profile !== "string" || !agent.profiles.includes(params.profile) || !safeURL(params.url)) throw new Error("Profile or destination not allowed");
    const state = useBrowser.getState();
    const window = Object.values(state.windows).find(w => w.kind !== "private" && agent.profiles.includes(w.profileId));
    if (!window) throw new Error("Open an approved profile in a browser window first");
    const id = state.newTab(window.id, { url: params.url as string, profileId: params.profile, background: true, gated: true });
    return { tab: id };
  }
  const tab = tabFor(agent, params.tab);
  if (method === "close_tab") {
    if (!agent.actions) throw new Error("Actions were not approved");
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
  return call("engine.agentPage", { ...params, connection, generation: agent.generation, profile: engineProfile(useBrowser.getState(), tab.profileId), tab: tab.id, url: tab.url, operation: method });
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
    const result = await dispatch(request.connection, method, params);
    if (mine !== generation || (method !== "connect" && !session(request.connection)?.approved)) return;
    reply(request.connection, id, { result });
    capture("agent_control", { action: "tool", tool: method });
  } catch (failure) {
    reply(request.connection, id, error(failure instanceof Error ? failure.message : "Agent action failed"));
  } finally { busy.delete(request.connection); }
}

export function startAgentControl() {
  if (started) return;
  started = true;
  setInterval(() => {
    for (const agent of useAgentControl.getState().sessions) if (agent.approved && agent.expires <= Date.now()) void revokeAgent(agent.connection);
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
