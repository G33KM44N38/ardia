#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/instance.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(process.argv[2] ?? join(repo, "apps/browser/build-routing/Build/Products/Release/Ardia.app"));
const data = mkdtempSync(join(tmpdir(), "ardia-migration-guard-test-"));
await assert.rejects(launch(app, { data, js: "none", ready: false, startTimeout: 2000,
  files: { "official-migration.json": { version: 1, source: "com.ardia.browser", connectedAccounts: "pending" } },
}), /didn't listen/);
assert.match(readFileSync(join(data, "app.out.log"), "utf8"), /migrated data kept closed/);
console.log(JSON.stringify({ result: "passed", check: "migrated data refuses mock-keychain startup", data }));
