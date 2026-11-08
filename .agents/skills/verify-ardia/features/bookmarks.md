# Bookmarks

## Sub-features

Create/reuse a bookmark, edit its name/folder, open it, remove it, and retain it across relaunch.

## How to get to it (user POV)

Visit a page and press ⌘D. The bookmark is created immediately and the Bookmark Added editor opens. Done, dismissal and Escape save edits; Remove deletes the bookmark. Open it from the bookmarks bar or menu.

## Driving it with the Ardia harness

Run `verify.mjs suite` through the skill. Wait for the loaded fixture page and `ac.store.getState().bookmarksReady[""]`. Invoke `ac.runCommand({command:"bookmarkPage",windowId},{strictWindow:true,tabId})`. Assert that a URL bookmark already exists and `ac.menus.useBookmarkDialog.getState().open.bookmarkId` identifies it.

The owned helper captures the editor and its accessibility tree. In the qualified scratch native window, `keys:1048576:a:0` selects the Name field's text, `type:Verification bookmark` types a replacement, and `keys:0:\r:36` submits Return. Observe the edited title and closed dialog. Record native test input as synthetic AppKit events, not physical keyboard input.

Poll `ac.engine.call("bookmarks.tree",{profile:""})` for native persistence. The helper opens a new tab through its command, dispatches `openBookmark` with the bookmark ID, resolves that tab's actual DevTools target and checks its page DOM. Re-bookmarking must reuse the same ID. Quit/relaunch the same owned directory without reseeding and check the native tree and restored store again.

## Gotchas

Bookmarks are absent from `session.json`; `bookmarks-cache.json` is only a cache. A store-only insertion or cached value does not prove native persistence. Hidden-window autofocus may leave the caret at the end instead of selecting the original name, so select all explicitly before typing. Check the native responder is a text field before input.

The suite does not click the bookmarks-bar button or test Remove/folder selection. Those separate UI journeys use the visible bookmark's title as its accessibility label, and the editor's Remove/New Folder/Done controls. Source: `state/bookmarks/actions.ts:88`, `state/bookmarks/engineSync.ts:70`, `components/bookmarks/BookmarkDialog.tsx:44,68`, `components/bookmarks/BarItem.tsx:91`, and `state/session/persist.ts:122` under `apps/browser/src`.
