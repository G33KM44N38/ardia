# Profiles, tabs, and splits

## Sub-features

Profile switching, per-profile tabs, creating/closing tabs, split panes, restoring the workspace.

## How to get to it (user POV)

Open the profiles menu with ⇧⌘M and select a profile. Open a page in each profile and switch back. Open a split with ⌃⇧= or ⌃+. Close a pane and confirm the other page remains.

## Driving it with the Ardia harness

Launch a scratch fixture with two profiles and at least two local page tabs. Use `ac.runCommand({command:"switchProfile",arg:profileId,windowId})` for a command-level switch. For splits inspect the current `openSplitPane` command contract in `apps/browser/src/state/commands/commands.ts` before invoking it. Observe window profile, active tab IDs, mounted webviews, and rendered page contents after each action. Save before/after evidence and confirm the saved session retains the intended workspace.

## Gotchas

These are source-derived journeys, not covered by the routing helper. Commands do not prove native shortcuts. A split needs valid mounted tabs; missing tabs fail the precondition. Store assignments only prepare fixtures. Source: `state/commands/commandCatalog.ts`, `state/commands/commands.ts`, `state/browser/actions.ts`.
