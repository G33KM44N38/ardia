import type { EventSubscription } from "expo-modules-core";

export type ControlSocketStatus = { state: "on" | "off"; generation: number; path: string; reason?: string };
export type ControlRequest = { connection: number; generation: number; line: string };

export type AutomationNative = {
  startAgents(): Promise<ControlSocketStatus>;
  stopAgents(): Promise<void>;
  replyAgent(connection: number, line: string): void;
  grantAgent(connection: number, generation: number, profiles: string[], actions: boolean, scripts: boolean): Promise<boolean>;
  revokeAgent(connection: number): Promise<void>;
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
