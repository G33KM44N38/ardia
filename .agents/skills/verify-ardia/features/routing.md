# URL routing

## Sub-features

Ordered Contains and Is equal to rules; profile, tab-group, Most Recent Profile and Little Ardia destinations; default external destination; internal clicks, typed URLs, external links, rule editing, ordering and removal.

## How to get to it (user POV)

Settings → Links → Air Traffic Control → New Route. Choose the match, pattern and destination. The rule menu offers Move Up, Move Down and Remove Route. Open links from other apps in sets the external fallback. Test page links, address-bar input and another application's links as separate entry points.

## Driving it with CDP and the Ardia harness

Run the skill's `verify.mjs prove`, or `verify.mjs suite` to share its instance with workspace/bookmark checks. It clicks the real `#route-work` anchor through CDP pressed/released input. Expect the Work destination DOM, an actual HTTP request, unchanged Personal source URL, and destination placement saved in `session.json`.

For the editor, use `ac.openSettings("links")` as navigation setup. Stable labels are `URL match of route 1`, `URL pattern of route 1`, `Open route 1 in`, and `Open links from other apps in`. Anchors are `links.routes` and `links.otherApps`. Operate the actual controls with the supported scratch-native driver, then reopen Settings and check persistence.

For address input, open the address bar, get an ID from `ac.omnibox.ids()`, call `ac.omnibox.get(id).type(url)`, and submit in a separate evaluation with `ac.omnibox.get(id).submit()`. This is handler-level input. Exercise external dispatch only against an owned test instance. `ac.actions.openUrls` merely creates tabs and is not an external-routing proof.

## Gotchas

The first matching rule with a surviving destination wins; a deleted destination is skipped. Contains searches the whole URL case-insensitively. Equality ignores scheme, query, fragment, trailing slashes and case. Only HTTP/HTTPS URLs and nonblank patterns match. There are at most 512 rules.

Scratch CDP clicks bypass the native physical-mouse gate. The default proof does not cover the editor, physical gestures, typed/external dispatch, command-click, cancellation, private windows or every destination type. Source: `components/settings/panes/Links.tsx`, `lib/linkRouting.ts:118`, `state/linkRouting/actions.ts:82`, `state/littleArdia/actions.ts:87`, and `state/linkRouting/placement.ts` under `apps/browser/src`.
