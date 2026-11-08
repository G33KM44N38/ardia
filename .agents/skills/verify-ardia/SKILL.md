---
name: verify-ardia
description: Verify Ardia macOS browser features in isolated native instances, reproduce routing or workspace bugs, and capture actions, screenshots, and persisted results before delivery.
metadata: {"supported_os":"macos","execution_host":"any","requires":"Node.js with global WebSocket, Xcode command-line tools, built Ardia app","target_machines":"Mac"}
---

# Verify Ardia

Use `$verify-ardia` for changes to the macOS browser. Work from the repository root. Read [the feature map](features/README.md), then the file for each affected feature. Source-described journeys remain unverified until exercised; one passing journey does not cover every entry point.

## Launch

For the complete isolated routing proof:

```sh
node .agents/skills/verify-ardia/scripts/verify.mjs prove
```

An optional final argument selects a built `.app`. The default is `apps/browser/build-routing/Build/Products/Release/Ardia.app`. If missing, build through `scripts/agent/build-app` as documented in `docs/agent-brief.md`; the personal build wrapper is `bash scripts/build-routing.sh --developer --wait 120`. Do not change signing to repair a verification failure.

The helper creates an empty temporary directory, seeds two profiles and a source tab, skips onboarding, enables the Release harness with `probe:true`, and launches hidden through `scripts/lib/instance.mjs`. Ready requires the fixture window in the store and its mounted webview. It uses packaged JS (`js:"none"`); rebuild after changing JS before claiming the new code passed.

For another mapped journey, import `launch` and `session` from `scripts/lib/instance.mjs` in a bounded script. Use a fresh `mkdtemp` directory, `probe:true`, `onboarded:true`, and readiness for the actual mounted fixture. Put teardown in `finally`. Never attach to an installed app or a real profile. Do not use `fresh:true` with an existing path.

## Doctor

The helper checks PID/start-time/binary ownership, the CDP listener PID, valid code signing, both fixture profiles, routing configuration, and native window enumeration. It writes `doctor.json` before input. Failures stop the journey.

For a custom journey, check `instance.alive`, `instance.stillOwned()`, `listenerPids(instance.port)`, `instance.targets()`, and the expected mounted state via `instance.eval`. Re-run these read-only checks when input behaves unexpectedly. `return true` alone is insufficient readiness.

## Drive

The helper serves a local HTML fixture and clicks its real `#route-work` anchor using CDP `Input.dispatchMouseEvent` pressed/released. It verifies a Work-profile destination, the preserved Personal source tab, actual HTTP receipt, destination DOM, and the saved `session.json`.

Use `instance.page(urlPart)` for page DOM/input and close every CDP connection. `instance.eval` exposes `ac.store`, `ac.engine.call`, `ac.runCommand`, `ac.omnibox`, `ac.openSettings`, and `ac.webviews`. Store writes are fixture preparation, never proof of a user action. Commands and omnibox drivers exercise component/command handlers; label them as such rather than native clicks or typing.

Release `ac.shell` has no native dev input/snapshot methods. `windows.dev` may return the literal `test instances only`; that is a refusal, not success. Use an authorized native driver if a journey requires native controls and report a blocker if unavailable.

## Evidence

The helper prints an absolute directory under `output/verification/ardia/`. It contains before/after page PNGs, action coordinates and selector, doctor results, resulting tab/profile state, HTTP requests, persistence assertion, logs, and cleanup receipt. Inspect both images before reporting success. They show web content, not browser chrome.

Scratch instances use a mock Keychain and bypass the native physical-mouse gate. This proof covers page-click routing, not that security gate, the Settings editor, real account decryption, external-link dispatch, or native keyboard behavior. Report those separately. Never collect real cookies, passwords, recovery words, or unrelated profile content.

For each changed feature, record its action and resulting visible state plus relevant persisted/network side effects. Do not replace a listed journey with internal setters to make it pass. A migration `--check` reads real user data; it is not a fixture dry-run.

## Cleanup

The helper closes its HTTP server, quits only the PID it launched using ownership checks, validates its temporary path and ownership token, and removes only that generated scratch directory. It does so after failures too. Evidence remains outside scratch; `cleanup.json` confirms process exit, scratch removal, and retained results.

Custom journeys follow the same ownership checks. Never kill by process name or delete a caller-supplied directory. Preserve evidence after teardown. If cleanup fails, report the exact owned instance and do not claim completion.

## Helpers

Executable helper: `scripts/verify.mjs` relative to this skill. Its supported command is `prove [built-app]`, shown above; launch, doctor, drive, evidence, and cleanup run together. Other feature recipes live in the map. Supplementary scripts there test native behavior or units and do not replace UI journeys.

Maintain changed journeys with `$maintain-verification-skill` after feature changes.
