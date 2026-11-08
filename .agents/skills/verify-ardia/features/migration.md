# Official-to-routing migration

## Sub-features

Copy a closed official session, preserve routing destinations, create backups, isolate data and config, reject unsafe mock-Keychain startup after migration.

## How to get to it (user POV)

The explicit migration command copies official data only with both applications closed. Connected-account import is Settings → General → Import and Export → Connected accounts from Ardia → Import Accounts.

## Driving it with fixture tests and the native harness

Run `node --test scripts/migrate-official.test.mjs` for fixture migration cases, then `node scripts/verify-routing-migration-guard.mjs` for the native startup rejection. Inspect each script before running and record its output. The native guard must reject a migrated marker under mock/scratch Keychain before the engine starts. These checks supplement a separately authorized real migration; they do not prove the Import Accounts button or real encrypted-login decryption.

## Gotchas

Never run `scripts/migrate-official.mjs --check` as a fixture probe: it reads real data. `--apply` writes real migration destinations and needs task authorization. Never share live databases or use a real migrated directory as scratch. Successful startup and copied encrypted records do not prove every login decrypts. Developer teams differ, so official passkey access cannot be assumed. Source: `scripts/migrate-official.mjs`, `packages/ardiacore/ios/ArdiaHost+Launch.mm`.
