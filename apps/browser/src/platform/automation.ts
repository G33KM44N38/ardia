import { nativeModule, type ControlRequest, type ControlSocketStatus } from "@ardia/shell";

export type { ControlRequest, ControlSocketStatus };

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
export const stopAgentSocket = () => Automation().stopAgents();
export const replyToAgent = (connection: number, line: string) => Automation().replyAgent(connection, line);
export const grantAgentAccess = (connection: number, generation: number, profiles: string[], actions: boolean, scripts: boolean) => Automation().grantAgent(connection, generation, profiles, actions, scripts);
export const revokeAgentAccess = (connection: number) => Automation().revokeAgent(connection);
export const onAgentRequest = (listener: (request: ControlRequest) => void) => Automation().addListener("onAgentRequest", listener);
export const onAgentClose = (listener: (event: { connection: number }) => void) => Automation().addListener("onAgentClose", listener);
