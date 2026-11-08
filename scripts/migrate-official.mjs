#!/usr/bin/env node
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const officialId = "com.ardia.browser";
const personalId = "com.kylian.ardia.routing";
const locks = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"]);
const syncState = /^(sync\.json|sync-state\.nns|sync-journal(?:[.-].*)?\.nns|sync-key-.*)$/;
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const canonicalPath = (path) => {
  let existing = resolve(path);
  const rest = [];
  while (!existsSync(existing)) {
    rest.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing) throw new Error("No existing parent for path");
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
};

export function routedSession(source, personal, now = Date.now()) {
  if (!Number.isInteger(source.version) || source.version < 9 || source.version > 11) throw new Error("Unsupported official session version");
  if (!source.profiles || !Array.isArray(source.profileOrder) || !Array.isArray(source.tabs)) throw new Error("Invalid official session");
  const result = structuredClone(source);
  const routing = structuredClone(personal.settings?.linkRouting);
  if (!routing || !Array.isArray(routing.routes)) throw new Error("The personal session has no routing rules");
  const profileMap = new Map();
  let added = 0;
  const destination = (value) => {
    if (!value || !["profile", "recent", "little"].includes(value.kind)) throw new Error("Unsupported routing destination");
    if (!value.profileId) return value;
    if (profileMap.has(value.profileId)) return { ...value, profileId: profileMap.get(value.profileId) };
    const profile = personal.profiles?.[value.profileId];
    if (!profile?.name) throw new Error("A route refers to a missing personal profile");
    const matches = Object.values(result.profiles).filter((p) => p.name === profile.name);
    if (matches.length > 1) throw new Error("Several official profiles have the same destination name");
    let id = matches[0]?.id;
    if (!id) {
      id = `routing-import-${randomUUID()}`;
      result.profiles[id] = { id, name: profile.name, color: profile.color, icon: profile.icon ?? null, createdAt: now };
      result.profileOrder.push(id);
      added++;
    }
    profileMap.set(value.profileId, id);
    return { ...value, profileId: id };
  };
  routing.routes = routing.routes.map((route) => ({ ...route, destination: destination(route.destination) }));
  routing.defaultDestination = destination(routing.defaultDestination);
  result.settings = { ...result.settings, linkRouting: routing };
  if (result.settingsMeta) delete result.settingsMeta.linkRouting;
  return { session: result, added, routes: routing.routes.length };
}

function independentCopy(source, destination, { skipSync = false } = {}) {
  const root = realpathSync(source);
  cpSync(root, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    mode: constants.COPYFILE_FICLONE,
    filter(path) {
      const name = basename(path);
      const parts = relative(root, path).split(/[\\/]/);
      if ((parts.length <= 2 && locks.has(name)) || (skipSync && parts.length === 1 && (syncState.test(name) || name === "shared-folders.json"))) return false;
      if (lstatSync(path).isSymbolicLink() && !inside(root, realpathSync(path))) throw new Error("A profile symlink points outside its data folder");
      return true;
    },
  });
}

export function migrate({ source, destination, sourceConfig, destinationConfig, backups, assertStopped, now = Date.now() }) {
  source = realpathSync(source);
  destination = resolve(destination);
  if (lstatSync(destination).isSymbolicLink()) throw new Error("The personal data folder must not be a symlink");
  destination = realpathSync(destination);
  backups = canonicalPath(backups);
  for (const [a, b] of [[source, destination], [source, backups], [destination, backups]]) {
    if (inside(a, b) || inside(b, a)) throw new Error("Data and backup folders must be separate");
  }
  assertStopped();
  const official = readJson(join(source, "session.json"));
  const personal = readJson(join(destination, "session.json"));
  const merged = routedSession(official, personal, now);
  const backup = join(backups, `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  const savedOfficial = join(backup, "official-data");
  independentCopy(source, savedOfficial);
  const stage = join(backup, "prepared-data");
  independentCopy(savedOfficial, stage, { skipSync: true });
  writeFileSync(join(stage, "session.json"), JSON.stringify(merged.session, null, 2) + "\n", { mode: 0o600 });
  const marker = { version: 1, source: officialId, migratedAt: now, connectedAccounts: "pending" };
  writeFileSync(join(stage, "official-migration.json"), JSON.stringify(marker, null, 2) + "\n", { mode: 0o600 });
  const configStage = join(backup, "prepared-config");
  if (existsSync(sourceConfig)) {
    const savedConfig = join(backup, "official-config");
    independentCopy(sourceConfig, savedConfig);
    independentCopy(savedConfig, configStage);
  } else mkdirSync(configStage);
  const configPath = join(configStage, "config.json");
  if (existsSync(configPath)) {
    const config = readJson(configPath);
    if (config.settings?.linkRouting !== undefined || config.settings?.openLinksInLittleArdia !== undefined) {
      config.settings.linkRouting = merged.session.settings.linkRouting;
      delete config.settings.openLinksInLittleArdia;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    }
  }
  const summary = { backup, profiles: Object.keys(merged.session.profiles).length, sourceProfiles: Object.keys(official.profiles).length,
    addedProfiles: merged.added, tabs: official.tabs.length, routes: merged.routes, sync: "off" };
  writeFileSync(join(backup, "migration.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  assertStopped();
  let dataSaved = false, dataPublished = false, configSaved = false, configPublished = false;
  try {
    renameSync(destination, join(backup, "previous-personal-data"));
    dataSaved = true;
    renameSync(stage, destination);
    dataPublished = true;
    mkdirSync(dirname(destinationConfig), { recursive: true });
    if (existsSync(destinationConfig)) {
      if (lstatSync(destinationConfig).isSymbolicLink()) throw new Error("The personal config folder must not be a symlink");
      renameSync(destinationConfig, join(backup, "previous-personal-config"));
      configSaved = true;
    }
    renameSync(configStage, destinationConfig);
    configPublished = true;
  } catch (error) {
    if (configPublished) renameSync(destinationConfig, configStage);
    if (configSaved) renameSync(join(backup, "previous-personal-config"), destinationConfig);
    if (dataPublished) renameSync(destination, stage);
    if (dataSaved) renameSync(join(backup, "previous-personal-data"), destination);
    throw error;
  }
  return summary;
}

export const isArdiaProcess = (line) => /(?:^|\/)Ardia(?: Routing)?\.app\/Contents\//.test(line.trim()) || /\/Contents\/MacOS\/Ardia$/.test(line.trim());

function assertStopped() {
  const processes = execFileSync("ps", ["-ax", "-o", "comm="], { encoding: "utf8" });
  if (processes.split("\n").some(isArdiaProcess))
    throw new Error("Quit both Ardia and Ardia Fork before migration");
  const seen = new Set();
  for (const line of processes.split("\n")) {
    if (!line.includes("/Chromium Framework.framework/")) continue;
    const app = /^(.*?\.app)\/Contents\//.exec(line.trim())?.[1];
    if (!app || seen.has(app)) continue;
    seen.add(app);
    let id;
    try { id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", join(app, "Contents/Info.plist")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { continue; }
    if (id === officialId || id === personalId) throw new Error("Quit Ardia's remaining helper processes before migration");
  }
}

function assertSigned(app) {
  const plist = join(app, "Contents/Info.plist");
  const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", plist], { encoding: "utf8" }).trim();
  if (id !== personalId) throw new Error("The destination app has the wrong identity");
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
  const detail = execFileSync("sh", ["-c", 'codesign -dv --verbose=2 "$1" 2>&1', "_", app], { encoding: "utf8" });
  if (!/^TeamIdentifier=[A-Z0-9]{10}$/m.test(detail)) throw new Error("A developer-signed build is required to preserve encrypted browser data");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !["--check", "--apply"].includes(process.argv[2])) throw new Error("Usage: node scripts/migrate-official.mjs --check|--apply");
    const home = homedir();
    const support = join(home, "Library/Application Support");
    const options = { source: join(support, officialId), destination: join(support, personalId),
      sourceConfig: join(home, ".config/ardia"), destinationConfig: join(home, ".config/ardia-routing"),
      backups: join(support, "Ardia Routing Backups"), assertStopped };
    assertSigned("/Applications/Ardia Fork.app");
    assertStopped();
    if (process.argv[2] === "--check") {
      const result = routedSession(readJson(join(options.source, "session.json")), readJson(join(options.destination, "session.json")));
      console.log(JSON.stringify({ ready: true, profiles: Object.keys(result.session.profiles).length, routes: result.routes, addedProfiles: result.added }));
    } else console.log(JSON.stringify(migrate(options), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
