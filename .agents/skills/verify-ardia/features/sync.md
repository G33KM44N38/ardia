# Encrypted sync

## Sub-features

Create an encrypted sync folder, pair another instance, propagate selected data, retain distinct device identities, and keep routing local.

## How to get to it (user POV)

Settings → Sync. Choose a folder and click Turn On Sync, or Enter Recovery Phrase… to join an existing folder. Pairing requires the same folder and 24 recovery words. Once enabled, Connect Another Device… and Advanced… expose pairing, Sync Now, Save Recovery Kit… and Stop Syncing….

## Driving it with the Ardia harness

The complete skill runner runs its owned `scripts/sync.mjs` in an owned temporary root. It launches two isolated native instances, creates/pairs through the production sync module, checks bookmarks both ways and a setting, distinct device IDs, local routing, and nonempty `.nns` files without fixture bookmark plaintext. Save only sanitized counts/status outside scratch.

Its `test:{reauth:"granted"}` override enables hidden fixture disclosure; it simulates owner authentication. It is not a Touch ID/password-prompt test. Both instances must be owned and ready before driving. After the helper quits, verify the instance records are no longer live and Trash the complete generated root, including fixture recovery-phrase transport files.

Pairing returns before the first asynchronous sync cycle fills the device roster. The helper waits for both current device IDs while driving sync cycles, then asserts they differ. A successful pairing response alone is not roster readiness.

For actual UI pairing, use the dedicated Sync pane in two owned instances and the visible controls above. Capture the receiving bookmark. Keep all recovery words out of logs/screenshots.

## Gotchas

A build without the native module shows Sync isn’t available in this build. If default iCloud storage is unavailable, choose a disposable local folder before Turn On Sync becomes usable. Local-folder exchange proves neither cloud-provider replication nor every UI button. Real Keychain access is not covered by the mock fixture.

History is limited to 90 days; cookies, passkeys and all extension local data are not transferred. Routing stays local. Source: `components/settings/panes/Sync.tsx:36,59,186`, `components/settings/panes/SyncSheets.tsx:128,262`, `state/sync/engine.ts:88,240`, and `state/sync/syncDoc.ts:7` under `apps/browser/src`. The personal native device-name/recovery-kit suffix still says Ardia Routing in `packages/sync/ios/SyncModule.swift:48,312`; report that product naming gap separately from this map upkeep.
