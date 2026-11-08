# Profiles, tabs and splits

## Sub-features

Profile switching, per-profile active tabs, creating/closing tabs, split panes and workspace persistence.

## How to get to it (user POV)

Open the profiles menu with ⇧⌘M and choose a profile. Visit a page in each profile and switch back. Open a split with ⌃⇧= or ⌃+. Close one pane and confirm the other page remains.

## Driving it with the Ardia harness

Run `verify.mjs suite` through the skill. It shares the routing fixture, switches between Personal and Work, and checks the mounted Work page. It dispatches `ac.runCommand({command:"switchProfile",arg:profileId,windowId},{strictWindow:true})` and waits for the resulting window profile; dispatch is not completion.

`ac.runCommand({command:"openSplitPane",windowId},{strictWindow:true})` creates a blank second pane beside the active tab. Read IDs from `split.slots.flatMap(slot => slot.stack ?? [slot.tabId])`. Check the original tab, new tab, native layout and saved split in `session.json`.

Close the new blank pane with `ac.runCommand({command:"closeTab",windowId},{strictWindow:true,tabId:newPaneId})`. Verify the new tab and two-pane split disappear, the original page remains mounted, and saved session state follows.

## Gotchas

One valid active anchor is enough; the command creates its other pane. At most three panes are supported. Untargeted `closeTab` may only dismiss the blank pane's new-tab interface. These checks prove user command handlers and native layout, not physical shortcuts or profile-menu clicks.

Source: `state/commands/commands.ts:70,164,215,305`, `state/splits/splits.ts:38,44,218`, `state/splits/actions.ts:15`, and `state/session/persist.ts:23,66` under `apps/browser/src`.
