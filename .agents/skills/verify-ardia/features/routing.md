# URL routing

## Sub-features

Ordered URL rules, match types, profile destinations, default destination, internal clicks, typed URLs, external links, rule editing and removal.

## How to get to it (user POV)

Settings → Links → Air Traffic Control → New Route. Choose a match, enter the URL pattern, and select a destination. Use the rule menu to Move Up, Move Down, or Remove Route. The external default is under Open links from other apps in. Open a matching link from a page, the address bar, and another application as separate journeys.

## Driving it with CDP and the Ardia harness

Run the skill's `verify.mjs prove`. It proves the internal page-click entry point on two scratch profiles. Expect a Work destination tab, unchanged Personal source, local HTTP request, and persisted destination.

For the editor use `ac.openSettings("links")` as navigation setup, then an authorized native driver. Stable labels are `URL match of route 1`, `URL pattern of route 1`, `Open route 1 in`, and `Open links from other apps in`; anchors are `links.routes` and `links.otherApps`. Edit through the controls and verify saved rules after reopening Settings. Source: `apps/browser/src/components/settings/panes/Links.tsx`.

For handler-level address input, get an ID from `ac.omnibox.ids()`, call `ac.omnibox.get(id).type(url)`, then call `ac.omnibox.get(id).submit()` in a separate evaluation so React commits. Inspect `components/omnibox/devDriver.ts` for the current signature. Assert destination profile and source preservation. Exercise external dispatch only against an owned test instance; do not invoke the system default browser and risk the user's session.

## Gotchas

First matching rule wins. A missing destination profile is a fixture failure. Private windows and same-profile navigation need their own cases. CDP scratch clicks bypass the native physical-input gate; they do not prove it. Editor, command-click, cancellation, ordering, typed and external entry points are not covered by the default helper. Source owners: `state/linkRouting/actions.ts`, `state/linkRouting/placement.ts`, `lib/linkRouting.ts`.
