# Encrypted sync

## Sub-features

Enable sync, pair a second instance, propagate bookmarks/settings, keep device identities distinct, and keep routing local.

## How to get to it (user POV)

Settings → General → Sync. Enable sync in one instance and pair the other using its recovery phrase and the same chosen folder.

## Driving it with the Ardia harness

Supplementary native check: `node scripts/verify-routing-sync.mjs`. It launches two isolated native instances, pairs through the native sync module, checks bookmarks both ways and settings propagation, distinct device IDs, local routing, and absence of fixture bookmark plaintext in encrypted files. It quits owned instances in `finally`; its printed scratch directory remains for inspection. Use `trash` for that explicit scratch path after reviewing it.

For the UI journey use two scratch instances and an authorized native driver to operate the actual Sync controls. Capture both visible states and the receiving bookmark after pairing. Keep recovery phrases out of logs and screenshots. Inspect `state/sync/engine.ts` and `components/settings/panes/SyncSheets.tsx` for current controls.

## Gotchas

The script uses internal fixture actions and proves native sync, not UI pairing. Mock Keychain does not verify real account access. Sync does not transfer every cookie, passkey, or extension datum. Never pair a fixture with the user's real sync folder. Routing intentionally stays local.
