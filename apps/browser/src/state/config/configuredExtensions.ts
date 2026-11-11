import { listExtensions, onExtensionActionChanged, onExtensionsChanged, onExtensionsSync, watchExtensionActions } from "../../platform/extensions";
import { addConfiguredExtensions } from "../sync/extensions";
import { errorText } from "../../lib/errors";
import { singleFlight } from "../../lib/singleFlight";
import { useBrowser } from "../browser/store";
import { openedEngineProfiles, onProfilesOpened } from "../profiles/profileLoading";
import { isQuitting } from "../app/quit";
import { capture } from "../telemetry/client";

const RETRY_MS = 1000;
const LATE_POLL_MS = 15_000;
const READY_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 60_000;

type Progress = { since: number; state: string };

let desired: string[] | null = null;
let revision = 0;
let active = false;
let report: (problems: string[]) => void = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;
let subscriptions: (() => void)[] = [];
const problems = new Map<string, string>();
const progress = new Map<string, Progress>();
const attempted = new Map<string, number>();
const keyOf = (profile: string, id: string) => JSON.stringify([profile, id]);

function failed(key: string, problem: string, outcome: string) {
  if (problems.get(key) === problem) return;
  problems.set(key, problem);
  capture("configured_extensions", { outcome, count: 1 });
}

const reconcile = singleFlight(async (flight) => {
  if (!active || isQuitting() || desired === null) return;
  clearTimeout(timer);
  timer = undefined;
  let nextPoll = Infinity;
  const version = revision;
  const ids = desired;
  if (!ids.length) {
    problems.clear();
    progress.clear();
    report([]);
    return;
  }
  const profiles = openedEngineProfiles(useBrowser.getState());
  for (const profile of attempted.keys()) if (!profiles.includes(profile)) attempted.delete(profile);
  const liveKeys = new Set(profiles.flatMap((profile) => [keyOf(profile, "ready"), ...ids.map((id) => keyOf(profile, id))]));
  for (const key of problems.keys()) if (!liveKeys.has(key)) problems.delete(key);
  for (const key of progress.keys()) if (!liveKeys.has(key)) progress.delete(key);
  for (const profile of profiles) {
    if (!active || isQuitting() || version !== revision || !openedEngineProfiles(useBrowser.getState()).includes(profile)) break;
    const readyKey = keyOf(profile, "ready");
    try {
      const current = () => active && !isQuitting() && version === revision && openedEngineProfiles(useBrowser.getState()).includes(profile);
      let result;
      if (attempted.get(profile) !== version) {
        attempted.set(profile, version);
        await watchExtensionActions(profile);
        if (!current()) { flight.repeat(); return; }
        result = await addConfiguredExtensions(profile, ids, current);
        if (!result.ready) attempted.delete(profile);
      } else {
        const installed = new Set((await listExtensions(profile)).map((extension) => extension.id));
        if (ids.some((id) => !installed.has(id) && ["kept", "installed"].includes(progress.get(keyOf(profile, id))?.state ?? ""))) {
          attempted.delete(profile);
          flight.repeat();
          continue;
        }
        result = { ready: true, results: ids.map((id) => ({ id, state: installed.has(id) ? "kept" : progress.get(keyOf(profile, id))?.state ?? "pending" })) };
      }
      if (!active || isQuitting() || version !== revision) {
        if (active && !isQuitting()) flight.repeat();
        return;
      }
      if (!openedEngineProfiles(useBrowser.getState()).includes(profile)) continue;
      if (!result.ready) {
        const waiting = progress.get(readyKey) ?? { since: Date.now(), state: "not_ready" };
        progress.set(readyKey, waiting);
        if (Date.now() - waiting.since < READY_TIMEOUT_MS) nextPoll = Math.min(nextPoll, RETRY_MS);
        else failed(readyKey, `config.json: extensions couldn't load because profile "${profile || "default"}" isn't ready`, "not_ready");
        continue;
      }
      attempted.set(profile, version);
      progress.delete(readyKey);
      problems.delete(readyKey);
      for (const { id, state } of result.results) {
        const key = keyOf(profile, id);
        const previous = progress.get(key);
        if (previous?.state !== state) capture("configured_extensions", { outcome: state, count: 1 });
        const next = { since: previous?.state === state ? previous.since : Date.now(), state };
        progress.set(key, next);
        if (state === "pending") {
          if (Date.now() - next.since < INSTALL_TIMEOUT_MS) nextPoll = Math.min(nextPoll, RETRY_MS);
          else {
            if (!problems.has(key)) failed(key, `config.json: extension "${id}" in profile "${profile || "default"}" hasn't finished downloading after 60 seconds; check the connection and Chrome Web Store availability`, "timeout");
            nextPoll = Math.min(nextPoll, LATE_POLL_MS);
          }
        } else if (state === "kept" || state === "installed") problems.delete(key);
        else if (state === "queued") {
          failed(key, `config.json: extension "${id}" in profile "${profile || "default"}" is waiting for a saved sync install; its settings and approval were preserved`, "queued");
          nextPoll = Math.min(nextPoll, LATE_POLL_MS);
        } else failed(key, `config.json: extension "${id}" in profile "${profile || "default"}" couldn't be added (${state})`, "error");
      }
    } catch (error) {
      if (!active || isQuitting() || version !== revision || !openedEngineProfiles(useBrowser.getState()).includes(profile)) continue;
      attempted.delete(profile);
      failed(readyKey, `config.json: extensions for profile "${profile || "default"}": ${errorText(error)}`, "error");
    }
  }
  if (active && version === revision) {
    report([...problems.values()]);
    if (Number.isFinite(nextPoll)) timer = setTimeout(() => {
      timer = undefined;
      void reconcile();
    }, nextPoll);
  }
}, () => active && !isQuitting());

export function configureExtensions(ids: string[]) {
  desired = ids;
  revision += 1;
  clearTimeout(timer);
  timer = undefined;
  problems.clear();
  progress.clear();
  if (active) void reconcile();
}

export function startConfiguredExtensions(onProblems: (problems: string[]) => void) {
  if (active) return;
  active = true;
  report = onProblems;
  const changed = (profile: string) => {
    if (desired?.length && openedEngineProfiles(useBrowser.getState()).includes(profile)) void reconcile();
  };
  const action = onExtensionActionChanged(({ profile, kind }) => {
    if (kind === "registry") changed(profile);
  });
  const sync = onExtensionsSync(({ profile }) => changed(profile));
  const extensions = onExtensionsChanged(({ profile }) => changed(profile));
  subscriptions = [
    () => action.remove(),
    () => sync.remove(),
    () => extensions.remove(),
    onProfilesOpened(() => void reconcile()),
    useBrowser.subscribe((s, prev) => {
      if (s.profiles !== prev.profiles) void reconcile();
    }),
  ];
  void reconcile();
}

export function resetConfiguredExtensionsForTests() {
  active = false;
  revision += 1;
  clearTimeout(timer);
  timer = undefined;
  for (const stop of subscriptions) stop();
  subscriptions = [];
  desired = null;
  problems.clear();
  progress.clear();
  attempted.clear();
  report = () => {};
}
