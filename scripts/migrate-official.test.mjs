import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isArdiaProcess, migrate, routedSession } from "./migrate-official.mjs";

test("both browser apps and their helpers prevent an offline migration", () => {
  assert.equal(isArdiaProcess("/Applications/Ardia.app/Contents/MacOS/Ardia"), true);
  assert.equal(isArdiaProcess("/Applications/Ardia Routing.app/Contents/Frameworks/Chromium Framework.framework/Helpers/Ardia Helper.app/Contents/MacOS/Ardia Helper"), true);
  assert.equal(isArdiaProcess("/tmp/build/Ardia.app/Contents/MacOS/Ardia"), true);
  assert.equal(isArdiaProcess("/tmp/Renamed.app/Contents/MacOS/Ardia"), true);
  assert.equal(isArdiaProcess("/Applications/Crest.app/Contents/MacOS/Crest"), false);
});

const original = () => ({ version: 9, profiles: {
  default: { id: "default", name: "Personal", color: "plum" },
  realPersonal: { id: "realPersonal", name: "_perso", color: "blue" },
}, profileOrder: ["default", "realPersonal"], tabs: [{ id: "kept-tab", profileId: "realPersonal", url: "https://fixture.invalid/" }],
settings: { restoreSession: true }, windows: [{ id: "kept-window", profileId: "realPersonal" }] });

const personal = () => ({ version: 11, profiles: {
  default: { id: "default", name: "_perso", color: "plum" },
  work: { id: "work", name: "_babacoiffure", color: "orange" },
}, settings: { linkRouting: { routes: [
  { id: "one", match: "contains", pattern: "_perso", destination: { kind: "profile", profileId: "default" } },
  { id: "two", match: "contains", pattern: "babacoiffure", destination: { kind: "profile", profileId: "work" } },
], defaultDestination: { kind: "recent" } } } });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ardia-migration-test-"));
  const paths = Object.fromEntries(["source", "destination", "sourceConfig", "destinationConfig", "backups"].map((name) => [name, join(root, name)]));
  for (const name of ["source", "destination", "sourceConfig", "destinationConfig"]) mkdirSync(paths[name]);
  writeFileSync(join(paths.source, "session.json"), JSON.stringify(original()));
  writeFileSync(join(paths.destination, "session.json"), JSON.stringify(personal()));
  writeFileSync(join(paths.sourceConfig, "config.json"), '{"settings":{"restoreSession":true}}');
  writeFileSync(join(paths.destinationConfig, "config.json"), '{"personal":true}');
  return { root, ...paths, assertStopped() {} };
}

test("routes follow profile names instead of reusing the official default id", () => {
  const source = original();
  const { session, added } = routedSession(source, personal(), 123);
  assert.equal(added, 1);
  assert.equal(session.settings.linkRouting.routes[0].destination.profileId, "realPersonal");
  const work = session.profiles[session.settings.linkRouting.routes[1].destination.profileId];
  assert.equal(work.name, "_babacoiffure");
  assert.deepEqual(session.tabs, source.tabs);
  assert.deepEqual(session.windows, source.windows);
  assert.equal(source.settings.linkRouting, undefined);
});

test("ambiguous names and future session formats fail before a migration starts", () => {
  const source = original();
  source.profiles.duplicate = { id: "duplicate", name: "_perso" };
  assert.throws(() => routedSession(source, personal()), /Several official profiles/);
  assert.throws(() => routedSession({ ...original(), version: 12 }, personal()), /Unsupported official/);
});

test("migration preserves encrypted fixture files, backups and source data but resets sync identity", () => {
  const f = fixture();
  mkdirSync(join(f.source, "Chromium", "Default"), { recursive: true });
  const encrypted = Buffer.from([0, 1, 128, 255, 42]);
  writeFileSync(join(f.source, "Chromium", "Default", "Login Data"), encrypted);
  symlinkSync("/fixture/lock", join(f.source, "Chromium", "SingletonLock"));
  writeFileSync(join(f.source, "sync.json"), '{"deviceId":"official-device"}');
  writeFileSync(join(f.source, "sync-journal-1.nns"), "official journal");
  writeFileSync(join(f.source, "shared-folders.json"), '{"folders":{"default":{"path":"official-shared-folder"}}}');
  writeFileSync(join(f.source, "Chromium", "Default", "sync.json"), "extension settings");
  const before = readFileSync(join(f.source, "session.json"));
  const oldPersonal = readFileSync(join(f.destination, "session.json"));
  const result = migrate(f);
  assert.deepEqual(readFileSync(join(f.source, "session.json")), before);
  assert.deepEqual(readFileSync(join(result.backup, "official-data", "session.json")), before);
  assert.deepEqual(readFileSync(join(result.backup, "previous-personal-data", "session.json")), oldPersonal);
  assert.deepEqual(readFileSync(join(f.destination, "Chromium", "Default", "Login Data")), encrypted);
  assert.equal(existsSync(join(f.destination, "Chromium", "SingletonLock")), false);
  assert.equal(existsSync(join(f.destination, "sync.json")), false);
  assert.equal(existsSync(join(f.destination, "sync-journal-1.nns")), false);
  assert.equal(existsSync(join(f.destination, "shared-folders.json")), false);
  assert.equal(readFileSync(join(f.destination, "Chromium", "Default", "sync.json"), "utf8"), "extension settings");
  writeFileSync(join(f.destinationConfig, "config.json"), "changed independently");
  assert.equal(readFileSync(join(f.sourceConfig, "config.json"), "utf8"), '{"settings":{"restoreSession":true}}');
  assert.equal(readFileSync(join(result.backup, "official-config", "config.json"), "utf8"), '{"settings":{"restoreSession":true}}');
});

test("a browser opening during the copy leaves the existing destination untouched", () => {
  const f = fixture();
  let checks = 0;
  f.assertStopped = () => { if (++checks === 2) throw new Error("browser is running"); };
  const before = readFileSync(join(f.destination, "session.json"));
  assert.throws(() => migrate(f), /browser is running/);
  assert.deepEqual(readFileSync(join(f.destination, "session.json")), before);
});

test("failure to publish config restores the previous personal data", () => {
  const f = fixture();
  f.destinationConfig = join(f.root, "config-link");
  symlinkSync(f.sourceConfig, f.destinationConfig);
  const before = readFileSync(join(f.destination, "session.json"));
  assert.throws(() => migrate(f), /must not be a symlink/);
  assert.deepEqual(readFileSync(join(f.destination, "session.json")), before);
});

test("a backup path through a symlink cannot enter the official source", () => {
  const f = fixture();
  const link = join(f.root, "backup-link");
  symlinkSync(f.source, link);
  const before = readFileSync(join(f.source, "session.json"));
  assert.throws(() => migrate({ ...f, backups: join(link, "not-created") }), /must be separate/);
  assert.equal(existsSync(join(f.source, "not-created")), false);
  assert.deepEqual(readFileSync(join(f.source, "session.json")), before);
});

test("legacy config cannot replace the preserved routing destination", () => {
  const f = fixture();
  const custom = personal();
  custom.settings.linkRouting.defaultDestination = { kind: "profile", profileId: "default" };
  writeFileSync(join(f.destination, "session.json"), JSON.stringify(custom));
  writeFileSync(join(f.sourceConfig, "config.json"), '{"settings":{"openLinksInLittleArdia":false}}');
  migrate(f);
  const config = JSON.parse(readFileSync(join(f.destinationConfig, "config.json"), "utf8"));
  assert.equal(config.settings.openLinksInLittleArdia, undefined);
  assert.deepEqual(config.settings.linkRouting.defaultDestination, { kind: "profile", profileId: "realPersonal" });
});
