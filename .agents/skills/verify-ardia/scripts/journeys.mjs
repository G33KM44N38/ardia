import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function eventually(test, sleep, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await test()) return;
    await sleep(100);
  }
  throw new Error(`${label} did not reach its expected state`);
}

export async function doctor(ctx, name) {
  assert.ok(ctx.instance.alive, "Owned instance is not alive");
  assert.deepEqual(ctx.listenerPids(ctx.instance.port), [ctx.instance.pid]);
  const native = await ctx.instance.eval('return ac.engine.call("windows.list",{})');
  assert.ok(Array.isArray(native) && native.some(w => w.hasRoot && w.ready), "No ready native browser window");
  const state = await ctx.instance.eval('const s=ac.store.getState();return {windows:Object.keys(s.windows),profiles:Object.keys(s.profiles),webviews:ac.webviews.size}');
  assert.ok(state.windows.includes("verify-window") && state.profiles.includes("default"));
  ctx.save(`doctor-${name}.json`, { owned: true, pid: ctx.instance.pid, started: ctx.instance.started, port: ctx.instance.port, native, state });
  return native.find(w => w.hasRoot && w.ready).window;
}

async function native(ctx, action) {
  const result = await ctx.instance.eval(`return ac.engine.call("windows.dev",{window:${ctx.window},action:${JSON.stringify(action)}})`);
  ctx.actions.push({ nativeAction: action, result });
  ctx.save("suite-actions.json", ctx.actions);
  assert.notEqual(result, "test instances only", "Native input requires a qualified scratch build");
  return result;
}

async function capture(ctx, name) {
  const path = join(ctx.evidence, name);
  assert.equal(await native(ctx, `snapshotFrame:${path}`), "ok");
  assert.ok(existsSync(path) && readFileSync(path).length > 100);
}

async function command(ctx, command, arg, tabId) {
  ctx.actions.push({ command, ...(arg ? { arg } : {}), ...(tabId ? { tabId } : {}), input: "application command handler" });
  await ctx.instance.eval(`ac.runCommand(${JSON.stringify({ command, windowId: "verify-window", ...(arg ? { arg } : {}) })},${JSON.stringify({ strictWindow: true, ...(tabId ? { tabId } : {}) })});return true`);
}

async function switchProfile(ctx, profile) {
  await command(ctx, "switchProfile", profile);
  await eventually(() => ctx.instance.eval(`return ac.store.getState().windows["verify-window"].profileId===${JSON.stringify(profile)}`), ctx.sleep, `Switch to ${profile}`);
}

async function savedSession(ctx, test, label) {
  await eventually(() => {
    const state = JSON.parse(readFileSync(join(ctx.data, "session.json"), "utf8"));
    return test(state);
  }, ctx.sleep, label);
}

export async function workspace(ctx) {
  ctx.window = await doctor(ctx, "workspace");
  await switchProfile(ctx, "default");
  await switchProfile(ctx, "verify-work");
  await eventually(() => ctx.instance.eval('const s=ac.store.getState(),w=s.windows["verify-window"];return !!w.activeTabIds["verify-work"] && ac.webviews.has(w.activeTabIds["verify-work"])'), ctx.sleep, "Work webview mounted");
  await switchProfile(ctx, "default");
  await command(ctx, "openSplitPane");
  let state;
  await eventually(async () => {
    state = await ctx.instance.eval('const s=ac.store.getState();return {tabs:Object.keys(s.tabs),splits:Object.values(s.splits),windows:s.windows}');
    return state.splits.some(s => s.slots.flatMap(slot => slot.stack ?? [slot.tabId]).includes("verify-source"));
  }, ctx.sleep, "Split created");
  const split = state.splits.find(s => s.slots.flatMap(slot => slot.stack ?? [slot.tabId]).includes("verify-source"));
  const ids = split.slots.flatMap(slot => slot.stack ?? [slot.tabId]);
  assert.equal(ids.length, 2);
  const added = ids.find(id => id !== "verify-source");
  assert.ok(added && state.tabs.includes(added));
  await savedSession(ctx, s => s.splits.some(x => x.id === split.id), "Split persisted");
  await capture(ctx, "workspace-split.png");
  await command(ctx, "closeTab", undefined, added);
  await eventually(() => ctx.instance.eval(`const s=ac.store.getState();return !s.tabs[${JSON.stringify(added)}] && !s.splits[${JSON.stringify(split.id)}] && !!s.tabs["verify-source"] && ac.webviews.has("verify-source")`), ctx.sleep, "Close pane without closing source");
  await savedSession(ctx, s => !s.splits.some(x => x.id === split.id) && !s.tabs.some(t => t.id === added), "Closed split persisted");
  ctx.save("workspace.json", { passed: true, split, addedPane: added, sourcePreserved: true, scope: "Profile-switch and split command handlers, native layout, session persistence" });
}

async function nativeTree(ctx) {
  return ctx.instance.eval('return ac.engine.call("bookmarks.tree",{profile:""})');
}

export async function bookmarks(ctx) {
  ctx.window = await doctor(ctx, "bookmarks");
  await switchProfile(ctx, "default");
  await eventually(() => ctx.instance.eval('return !!ac.store.getState().bookmarksReady[""]'), ctx.sleep, "Default bookmarks loaded");
  await command(ctx, "bookmarkPage", undefined, "verify-source");
  let bookmark;
  await eventually(async () => {
    bookmark = await ctx.instance.eval('const s=ac.store.getState(),dialog=ac.menus.useBookmarkDialog.getState().open;return dialog && {dialog,node:s.bookmarks.nodes[dialog.bookmarkId]}');
    return bookmark?.node?.url === `${ctx.base}/source`;
  }, ctx.sleep, "Immediate bookmark creation and editor");
  const id = bookmark.node.id;
  await capture(ctx, "bookmark-editor.png");
  writeFileSync(join(ctx.evidence, "bookmark-editor-ax.txt"), await native(ctx, "ax"));
  await ctx.sleep(300);
  assert.match(await native(ctx, "responder"), /Text|Field/);
  await native(ctx, "keys:1048576:a:0");
  await native(ctx, "type:Verification bookmark");
  await ctx.sleep(200);
  writeFileSync(join(ctx.evidence, "bookmark-typed-ax.txt"), await native(ctx, "ax"));
  ctx.actions.push({ input: "native test key events", target: "Bookmark Added Name field", text: "Verification bookmark" });
  await native(ctx, "keys:0:\r:36");
  await eventually(() => ctx.instance.eval(`return !ac.menus.useBookmarkDialog.getState().open && ac.store.getState().bookmarks.nodes[${JSON.stringify(id)}]?.title==="Verification bookmark"`), ctx.sleep, "Bookmark edited with native field and Return");
  await eventually(async () => JSON.stringify(await nativeTree(ctx)).includes("Verification bookmark"), ctx.sleep, "Native bookmark persisted");
  ctx.save("bookmark-native-tree.json", await nativeTree(ctx));
  const before = await ctx.instance.eval('return Object.keys(ac.store.getState().tabs)');
  await command(ctx, "newTab");
  const opened = (await ctx.instance.eval('return Object.keys(ac.store.getState().tabs)')).find(t => !before.includes(t));
  assert.ok(opened);
  await command(ctx, "openBookmark", id);
  await eventually(() => ctx.instance.eval(`return ac.store.getState().tabs[${JSON.stringify(opened)}]?.url===${JSON.stringify(ctx.base + "/source")} && ac.webviews.has(${JSON.stringify(opened)})`), ctx.sleep, "Bookmark opened in new tab");
  const targets = await ctx.instance.eval(`return ac.engine.call("engine.cliTabTargets",{tabIds:[${JSON.stringify(opened)}]})`);
  assert.ok(targets[opened]?.targetId);
  const page = await ctx.instance.page(t => t.id === targets[opened].targetId);
  try {
    await eventually(() => page.eval('document.querySelector("h1")?.textContent==="Personal profile"'), ctx.sleep, "Opened bookmark page rendered");
    writeFileSync(join(ctx.evidence, "bookmark-opened.png"), Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  } finally { page.close(); }
  await command(ctx, "bookmarkPage", undefined, opened);
  assert.equal(await ctx.instance.eval('return ac.menus.useBookmarkDialog.getState().open?.bookmarkId'), id);
  await native(ctx, "keys:0:\r:36");
  await eventually(() => ctx.instance.eval('return !ac.menus.useBookmarkDialog.getState().open'), ctx.sleep, "Reuse dialog dismissed");
  await ctx.instance.quit();
  assert.ok(!ctx.instance.stillOwned());
  ctx.instance = await ctx.launch(ctx.app, { data: ctx.data, js: "none", probe: true, onboarded: true,
    ready: { test: 'return !!ac.store.getState().windows["verify-window"] && !!ac.store.getState().bookmarksReady[""]' },
  });
  ctx.window = await doctor(ctx, "restored-bookmarks");
  await eventually(async () => JSON.stringify(await nativeTree(ctx)).includes("Verification bookmark"), ctx.sleep, "Bookmark survives relaunch");
  assert.equal(await ctx.instance.eval(`return ac.store.getState().bookmarks.nodes[${JSON.stringify(id)}]?.title`), "Verification bookmark");
  ctx.save("bookmarks.json", { passed: true, id, immediateCreation: true, nativeEditorInput: true, nativePersistence: true, relaunch: true, reuseWithoutDuplicate: true, openedTab: opened, scope: "Bookmark command, native edit and submit, open command, native tree and relaunch; bar-button clicks and Remove unverified" });
}

export async function migrationUI(ctx) {
  await doctor(ctx, "migration-ui");
  const status = await ctx.instance.eval('return ac.shell.officialMigrationStatus()');
  assert.equal(status, null);
  await ctx.instance.eval('ac.openSettings("general");return true');
  await eventually(() => ctx.instance.eval('return ac.shell.windowIds().then(ids=>ids.includes("settings"))'), ctx.sleep, "General settings window mounted");
  await ctx.sleep(400);
  await ctx.instance.eval('ac.settingsSearch.revealSetting({id:"general.officialAccounts",pane:"general",section:"Import and Export"});return true');
  await ctx.sleep(1200);
  const windows = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", `ObjC.import('CoreGraphics');JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll,0))).filter(w=>w.kCGWindowOwnerPID===${ctx.instance.pid}).map(w=>({id:w.kCGWindowNumber,title:w.kCGWindowName})))`], { encoding: "utf8" }));
  const settings = windows.find(w => w.title === "Settings");
  assert.ok(settings);
  const original = ctx.window;
  ctx.window = settings.id;
  try {
    const ax = await native(ctx, "ax");
    assert.match(ax, /Import Accounts/);
    assert.match(ax, /Migrate your official browser data first/);
    writeFileSync(join(ctx.evidence, "migration-import-ax.txt"), ax);
    await capture(ctx, "migration-import-unavailable.png");
  } finally { ctx.window = original; }
  ctx.save("migration-ui.json", { status: "verified-unreachable", routeAttempted: "Settings → General → Import and Export → Connected accounts from Ardia", nativeStatus: status, prerequisite: "Non-isolated migrated data and real Keychain permission; Import Accounts is disabled in this isolated fixture" });
}
