# Official-to-fork migration safety

## Sub-features

Offline copy, independent data/config, backups, routing destinations remapped by unique profile name, reset sync identity, and refusal to open migrated data under unsafe scratch/mock Keychain conditions.

## How to get to it (user POV)

The explicitly authorized migration command copies data with both applications closed. Connected accounts are imported separately through Settings → General → Import and Export → Connected accounts from Ardia → Import Accounts.

## Driving it with fixture tests and the native harness

The complete skill runner gives `scripts/migrate-official.test.mjs` its own temporary root and runs eight fixture cases. It then runs the native migration guard against marker-only scratch. Expected success is refusal: the log contains `migrated data kept closed`, lacks `engine started`, and no new app process survives. Preserve that log outside scratch before cleanup.

Connected-account import is verified-unreachable in the ordinary isolated fixture. `ac.shell.officialMigrationStatus()` returns no available migration status. The button requires a personal build, matching migration marker, non-isolated migrated data and real Keychain permission. Adding the marker to scratch deliberately prevents startup, rather than enabling a safe import-button test.

## Gotchas

Never run `scripts/migrate-official.mjs --check` as fixture verification: it reads real sessions. `--apply` writes real destinations and requires separate task authorization. Normal maintenance does not import actual accounts or prove login decryption/passkeys. Scratch marker refusal short-circuits before even querying Safe Storage attributes.

The real CLI expects `/Applications/Ardia Fork.app`; bundle ID, config and backup paths intentionally retain `routing` to preserve identity/data. Legacy unit/guard helpers leave scratch behind, so use the supervised complete runner or explicitly clean their exact generated roots. Source: `scripts/migrate-official.mjs:30,80,163`, `packages/ardiacore/ios/ArdiaHost+Launch.mm:125,453`, `packages/shell/ios/KeychainModule.swift:14,88`, and `apps/browser/src/components/settings/panes/OfficialMigrationRow.tsx:24`.
