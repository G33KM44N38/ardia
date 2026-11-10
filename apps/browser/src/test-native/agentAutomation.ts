import type { AgentGrant, AutomationNative } from "@ardia/shell";

export const agentSocket = {
  sessions: new Map<number, AgentGrant>(), remembered: [] as AgentGrant[], scopes: new Map<string, Record<string, string>>(), identities: new Map<number, string>(),
  deny: false, generation: 0, running: false, replies: [] as { connection: number; line: string }[], grants: [] as unknown[],
  beforeAccess: null as (() => Promise<void>) | null, beforeGrant: null as (() => Promise<void>) | null,
};
let serial = 0;
export const agentAutomation: Pick<AutomationNative, "startAgents" | "stopAgents" | "agentStatus" | "agentAccess" | "replyAgent" | "grantAgent" | "revokeAgent"> = {
  startAgents: async () => { agentSocket.running = true; return { state: "on", generation: ++agentSocket.generation, path: "/data/ArdiaAgents.sock" }; },
  stopAgents: async () => { agentSocket.running = false; agentSocket.sessions.clear(); },
  agentStatus: async () => ({ enabled: false, remembered: agentSocket.remembered, storageFailed: false }),
  agentAccess: async (connection, generation, revision, profile, nativeProfile, operation) => {
    if (operation !== "connect") await agentSocket.beforeAccess?.();
    if (agentSocket.deny || generation !== agentSocket.generation) return null;
    if (operation === "connect" && !agentSocket.sessions.has(connection)) {
      const identity = agentSocket.identities.get(connection) ?? "";
      const saved = identity && agentSocket.remembered.find(g => g.identity === identity);
      agentSocket.sessions.set(connection, saved ? { ...saved } : { identity, name: "Agent", authorization: `pending-${++serial}`, approved: false, profiles: [], actions: false, scripts: false, remembered: false, expires: 0, canRemember: !!identity });
    }
    const grant = agentSocket.sessions.get(connection);
    if (!grant || operation !== "connect" && (!grant.approved || grant.authorization !== revision || agentSocket.scopes.get(revision)?.[profile] !== nativeProfile)) return null;
    return grant;
  },
  replyAgent: (connection, line) => { agentSocket.replies.push({ connection, line }); },
  grantAgent: async (...args) => {
    await agentSocket.beforeGrant?.();
    agentSocket.grants.push(args);
    const [connection, generation, revision, profiles, actions, scripts, remember] = args;
    const old = agentSocket.sessions.get(connection);
    if (!old || old.authorization !== revision || generation !== agentSocket.generation) return false;
    const grant = { ...old, authorization: `approved-${++serial}`, approved: true, profiles: Object.keys(profiles), actions, scripts, remembered: remember, expires: remember ? 0 : Date.now() + 3600000 };
    agentSocket.scopes.set(grant.authorization, profiles);
    agentSocket.sessions.set(connection, grant);
    if (remember) agentSocket.remembered.push(grant);
    return true;
  },
  revokeAgent: async (connection, identity) => {
    for (const [id, grant] of agentSocket.sessions) if (id === connection || identity && grant.identity === identity) agentSocket.sessions.delete(id);
    agentSocket.remembered = agentSocket.remembered.filter(g => g.identity !== identity);
    return true;
  },
};
