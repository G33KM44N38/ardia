import { nativeModule, type AgentGrant, type AgentStatus, type ControlRequest, type ControlSocketStatus } from "@ardia/shell";

export type { AgentGrant, AgentStatus, ControlRequest, ControlSocketStatus };

let bound: ReturnType<typeof nativeModule<"ArdiaAutomation">> | null = null;
const Automation = () => (bound ??= nativeModule("ArdiaAutomation"));

export const startControlSocket = () => Automation().start();
export const stopControlSocket = () => Automation().stop();
export const replyOnControlSocket = (connection: number, line: string, ticket = 0) => Automation().reply(connection, line, ticket);
export const broadcastOnControlSocket = (connections: number[], line: string) => Automation().broadcast(connections, line);
export const onControlRequest = (listener: (request: ControlRequest) => void) => Automation().addListener("onRequest", listener);
export const onControlClose = (listener: (e: { connection: number }) => void) => Automation().addListener("onClose", listener);
export const onControlWritten = (listener: (e: { tickets: number[] }) => void) => Automation().addListener("onWritten", listener);

export const startAgentSocket = () => Automation().startAgents();
export const stopAgentSocket = (preservePreference = false) => Automation().stopAgents(preservePreference);
export const agentStatus = () => Automation().agentStatus();
export const agentAccess = (connection: number, generation: number, revision: string, profile: string, nativeProfile: string, operation: string) => Automation().agentAccess(connection, generation, revision, profile, nativeProfile, operation);
export const replyToAgent = (connection: number, line: string) => Automation().replyAgent(connection, line);
export const grantAgentAccess = (connection: number, generation: number, revision: string, profiles: Record<string, string>, actions: boolean, scripts: boolean, remember: boolean) => Automation().grantAgent(connection, generation, revision, profiles, actions, scripts, remember);
export const revokeAgentAccess = (connection: number, identity = "") => Automation().revokeAgent(connection, identity);
export const onAgentRequest = (listener: (request: ControlRequest) => void) => Automation().addListener("onAgentRequest", listener);
export const onAgentClose = (listener: (event: { connection: number }) => void) => Automation().addListener("onAgentClose", listener);
