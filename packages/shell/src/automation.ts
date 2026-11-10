import type { EventSubscription } from "expo-modules-core";

export type ControlSocketStatus = { state: "on" | "off"; generation: number; path: string; reason?: string };
export type ControlRequest = { connection: number; generation: number; line: string; authorization?: string };

export type AgentGrant = { identity: string; name: string; profiles: string[]; actions: boolean; scripts: boolean; authorization: string; expires: number; remembered: boolean; approved?: boolean; canRemember?: boolean };
export type AgentStatus = { enabled: boolean; remembered: AgentGrant[]; storageFailed: boolean };

export type AutomationNative = {
  startAgents(): Promise<ControlSocketStatus>;
  stopAgents(preservePreference: boolean): Promise<void>;
  agentStatus(): Promise<AgentStatus>;
  agentAccess(connection: number, generation: number, revision: string, profile: string, nativeProfile: string, operation: string): Promise<AgentGrant | null>;
  replyAgent(connection: number, line: string): void;
  grantAgent(connection: number, generation: number, revision: string, profiles: Record<string, string>, actions: boolean, scripts: boolean, remember: boolean): Promise<boolean>;
  revokeAgent(connection: number, identity: string): Promise<boolean>;
  addListener(name: "onAgentRequest", listener: (e: ControlRequest) => void): EventSubscription;
  addListener(name: "onAgentClose", listener: (e: { connection: number }) => void): EventSubscription;
  start(): Promise<ControlSocketStatus>;
  stop(): Promise<void>;
  reply(connection: number, line: string, ticket: number): void;
  broadcast(connections: number[], line: string): void;
  addListener(name: "onRequest", listener: (e: ControlRequest) => void): EventSubscription;
  addListener(name: "onClose", listener: (e: { connection: number }) => void): EventSubscription;
  addListener(name: "onWritten", listener: (e: { tickets: number[] }) => void): EventSubscription;
};
