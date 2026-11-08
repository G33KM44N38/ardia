# Ardia Fork feature map

| Feature | Map | Representative live coverage |
|---|---|---|
| URL routing | [routing](routing.md) | Real internal page click, destination profile, preserved source and saved session |
| Profiles, tabs and splits | [workspace](workspace.md) | Profile/split commands, native layout, targeted pane close and persistence |
| Bookmarks | [bookmarks](bookmarks.md) | Immediate creation, native edit/submit, open command, native tree, reuse and relaunch |
| Encrypted native sync | [sync](sync.md) | Two native instances, bidirectional bookmarks/settings, distinct devices and encrypted files |
| Migration safety | [migration](migration.md) | Offline fixture tests and native refusal before engine startup |
| MCP agent control | [agents](agents.md) | Real stdio clients, profile limits, page input, HTTP writes, screenshots and revocation |

Run `node .agents/skills/verify-ardia/scripts/maintain.mjs` from the repository root for this coverage. Each file distinguishes the exercised path from other entry points. Record additional paths as passed, failed or unverified; do not claim full UI coverage from an API proof.

Connected-account import is verified-unreachable in isolated data: it requires a real migrated, non-isolated profile and Keychain permission. Normal verification never supplies those prerequisites. Keep that limitation visible while testing the native migration guard.
