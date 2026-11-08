---
name: verify-ardia
description: Verify Ardia Fork macOS browser features in isolated native instances, including routing, profiles, bookmarks, encrypted sync, migration safety and MCP agent access. Use before delivering browser changes or reproducing feature bugs.
metadata: {"supported_os":"macos","execution_host":"any","requires":"Node.js with global WebSocket, built Ardia app, Xcode command-line tools; MCP also needs Python development files and python3-config","target_machines":"Mac"}
---

# Verify Ardia Fork

Use `$verify-ardia` from the repository root. Read [the feature map](features/README.md) and the affected feature files. Report which entry points were exercised. A command-handler proof does not prove the corresponding physical shortcut or every menu entry.

## Launch

Run all mapped representative journeys:

```sh
node .agents/skills/verify-ardia/scripts/maintain.mjs
```

An optional final argument selects a built `.app`; the default is `apps/browser/build-routing/Build/Products/Release/Ardia.app`. The runner checks its signature and refuses installed apps. If the build is missing, use `scripts/agent/build-app` as documented in `docs/agent-brief.md`. The personal developer wrapper is `bash scripts/build-routing.sh --developer --wait 120`. Use packaged JS only after rebuilding changed product JS. Verification-skill edits require no app rebuild. Preserve the approved signing configuration.

The complete run uses one long-lived CDP instance for routing, workspace and bookmarks, then relaunches its same scratch directory to check bookmark restoration. Encrypted sync needs two separate instances sharing a disposable folder. Migration safety deliberately tests a rejected startup. MCP needs a separate instance with no external debugging port, followed by an external-CDP refusal test. Each group stops when its work ends.

For just routing, run `node .agents/skills/verify-ardia/scripts/verify.mjs prove`. For routing, workspace and bookmarks together, use `verify.mjs suite`. Both accept the optional built-app argument. The helpers seed empty temporary data, skip onboarding, set `probe:true`, and launch hidden through the existing instance library.

## Doctor

For the CDP journeys, verify PID/start-time/binary ownership, listener ownership, the expected fixture store and mounted webviews, and a native window with `hasRoot` and `ready`. The runner saves doctor receipts before input and after relaunch. Native window enumeration must contain a ready window; a successful empty response is insufficient.

MCP deliberately refuses external CDP. Its doctor checks owned process identity through `attach`, the mounted source fixture, valid signature, its dedicated socket, and actual `engine.cliControlStatus.state === "off"`. Do not apply the CDP-listener requirement to this branch.

After a failed drive, capture health/state before teardown. A healthy PID does not make a wedged UI usable: reset to a known fixture or relaunch before further input. The complete runner stops on failure and retains the evidence; fix only owned harness drift during maintenance. Report product regressions separately.

## Drive

Use the affected [feature recipe](features/README.md). The primary runner clicks a real page link through CDP, runs production profile/split/bookmark commands, edits the native bookmark field and submits it, checks native bookmark storage, and relaunches the fixture without reseeding it. The owned sync and MCP helpers call production handlers and native modules; their map files state the UI journeys they do not cover.

`instance.eval` exposes `ac.store`, `ac.runCommand`, `ac.engine.call`, `ac.omnibox`, `ac.openSettings`, `ac.webviews`, `ac.sync`, and `ac.agentControl`. Its dynamic function body does not support top-level await or dynamic async functions in Hermes. Return a Promise or a `.then(...)` chain. Store assignments are fixture preparation, not evidence of user input.

Release `ac.shell` has no native dev input methods. Qualified scratch instances support `ac.engine.call("windows.dev", {window:nativeWindowNumber, action:"snapshotFrame:/absolute/path.png"})`, `ax`, `click:x,y`, `type:text`, and `keys:flags:characters:keyCode`. Use `name:argument`, never a space separator. The literal `test instances only` is refusal. Native clicks schedule input; wait for observed state before continuing. Native snapshots may omit Metal-backed page pixels; page CDP captures provide the page-content proof.

## Evidence

The complete runner prints `output/verification/maintenance/<run>/`. Its `coverage.json` points to the UI and MCP proof directories. Check the files actually exist after cleanup, including results, actions, PNGs and cleanup receipts. Inspect the relevant images before reporting success. Sync preserves sanitized counts/results only; its fixture recovery-phrase transport files stay in disposable scratch.

Routing proof covers actual page-click routing and persisted placement. The workspace proof covers command handlers, native split layout and saved split state. Bookmarks use native-tree and relaunch checks, since bookmarks are absent from `session.json`. Native sync proves encryption and local-folder exchange, not a cloud provider. Migration guard refusal is a positive safety result; it does not prove real account import or login decryption.

Scratch Keychain and authentication overrides do not prove real Keychain access or Touch ID. Scratch CDP clicks bypass the native physical-mouse gate. MCP inputs use DOM events. Keep user profiles, credentials, cookies and recovery words outside verification. `migrate-official.mjs --check` reads real data and is not a fixture dry-run.

## Cleanup

Primary helpers quit only their recorded PID after ownership checks, validate the temporary path and ownership token, and remove only their generated scratch. The complete runner gives sync and legacy migration helpers an owned temporary root, quits any remaining recorded instances, and moves that root to Trash. It also tracks MCP client processes, waits for their exit, and verifies retained proof files rather than trusting a success flag alone.

Cleanup runs on failed iterations too. Evidence lives outside scratch and survives teardown. A remaining unowned or unverifiable process is a blocker; never kill by process name or delete caller-supplied data. Fixture instances can be resumed only through their owned records while still useful to the run.

## Helpers

Executable entry points, relative to this skill:

- `scripts/verify.mjs prove [built-app]`: routing only.
- `scripts/verify.mjs suite [built-app]`: routing, workspace and bookmark journeys in one fixture, with restoration.
- `scripts/maintain.mjs [built-app]`: every mapped representative journey with supervised cleanup and retained coverage.
- `scripts/sync.mjs [built-app]`: two-instance native sync with asynchronous device-roster readiness. Use an owned TMPDIR and clean its reported work root.
- `scripts/agents.mjs [built-app]`: the no-CDP MCP journey, with painted large-capture fixtures and awaited client shutdown.

`scripts/journeys.mjs` is the imported UI-journey library, not a separate command. The complete runner invokes existing migration scripts without editing them. Its owned sync/MCP helpers derive from repository proofs and fix asynchronous roster readiness and the window/paint-dependent screenshot precondition without changing product code. Missing native modules or build tools are prerequisites to report, not dependencies to install automatically.
