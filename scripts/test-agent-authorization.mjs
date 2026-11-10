#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";

const scratch = mkdtempSync("/tmp/ardia-authorization-test-");
const binary = `${scratch}/agent-authorization-tests`;
execFileSync("swiftc", ["packages/shell/ios/PrivateAgentFile.swift", "packages/shell/ios/AgentAuthorization.swift", "packages/shell/ios/ControlSocket.swift", "packages/shell/ios/ControlConnection.swift", "packages/shell/ios/ControlOutput.swift", "scripts/fixtures/agent-authorization/main.swift", "-o", binary], { cwd: resolve(import.meta.dirname, ".."), stdio: "inherit", timeout: 60000 });
execFileSync(binary, [scratch], { stdio: "inherit", timeout: 30000 });
