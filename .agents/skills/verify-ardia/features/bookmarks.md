# Bookmarks

## Sub-features

Bookmark a page, edit its name, open it, and remove it; retain bookmarks across restart.

## How to get to it (user POV)

Visit a page and press ⌘D. Confirm the bookmark dialog, then open the bookmark from the sidebar or bookmarks menu.

## Driving it with the Ardia harness

Seed one mounted local page. Invoke `ac.runCommand({command:"bookmarkPage",windowId})` as command-level input. Inspect `ac.menus.useBookmarkDialog.getState()` for dialog state, then use an authorized native driver for dialog confirmation. Observe the bookmark title/URL, open it through the actual bookmark control, and verify loaded page content. Capture action and visible result, then restart the owned fixture and check persistence. Read `apps/browser/src/state/bookmarks/actions.ts` for the current dialog contract.

## Gotchas

Not covered by the routing helper. Calling `addBookmark` directly proves state/sync behavior only, not the bookmark UI. Seed a normal page rather than a blank tab. Do not substitute direct insertion when dialog driving is unavailable; report that journey unverified.
