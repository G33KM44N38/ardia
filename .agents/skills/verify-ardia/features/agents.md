# MCP agent control

## Sub-features

Connection approval, selected profiles, read-only access, actions, separately approved page scripts, page tools, per-agent revoke, one-hour expiry, reconnect approval and global Stop.

## How to get to it (user POV)

Settings → Show advanced settings → Advanced → Agents. Turn off command-line control and restart without an external DevTools port. Enable Allow agent connections, connect an MCP client, choose profiles and action/script permissions, then click Approve connection. Revoke one connection here or stop all agents with the browser's Stop control.

## Driving it with MCP and the Ardia harness

The complete skill runner runs its owned `scripts/agents.mjs` against fresh isolated data with no external CDP port. It checks native control is off, then uses two real stdio MCP clients. It exercises preapproval refusal, profile limits, read-only refusal, real fill/click and HTTP writes, stale refs, denied scripts/privileged targets, insecure HTTP snapshots, screenshot limits, revoke/reconnect, and global/external control exclusion.

Inspect its retained `actions.json`, `result.json`, page/settings PNGs, `screenshot-limits.json`, `saved.json` and `cleanup.json`. The supervisor checks those files remain after teardown and reaps tracked MCP children. Fixture approvals use the production approval function; they are not approval-button clicks.

For the separate approval UI journey, observe current native settings state and labels: Allow {profile}, Allow agent actions, Allow agent scripts, Approve connection and Revoke access. Use fresh accessibility/screenshot positions, then verify the client's next tool request follows the resulting grant. Never reuse a previous run's window number or coordinates.

## Gotchas

The oversized screenshot journey requires enough visible image data to exceed the native cap. The owned helper uses a large window and painted pixelated-noise fixtures, and requires an actual size refusal followed by a successful tool on the same approved connection. A valid smaller screenshot is not a product failure.

The CDP launch/doctor used by other browser checks cannot serve scoped MCP; external debugging is deliberately refused. Check the owned PID/start time/binary, mounted source, dedicated socket and actual native CLI status instead. The helper starts a second external-CDP instance only for its negative test.

If the named helper is absent, its first invocation compiles an executable using existing Python development files, python3-config, clang and macOS SDK. Report missing tools without installing them. Direct test clients must receive owned scratch data; their default directory belongs to the installed application.

Inputs use DOM events, not physical mouse events or native shortcuts. Uploads and cross-origin iframe control are unsupported. Agent names are self-reported; this is browser authorization, not an OS sandbox against arbitrary same-user programs. Approved scripts can leave work running after revoke. The standard proof leaves positive script execution, a real one-hour expiry wait, native approval/revoke clicks and the browser Stop button unverified.

Source: `apps/browser/src/state/automation/agentControl.ts:27,46,115`, `apps/browser/src/components/settings/panes/Agents.tsx:8`, `apps/browser/src/components/window/CliControlPill.tsx:18`, `packages/shell/ios/ControlSocket.swift:24`, `packages/ardiacore/ios/ArdiaHost.mm:257`, and `apps/cli/ardia_cli/mcp.py:13`.
