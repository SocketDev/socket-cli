# no-corepack-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2).

**Trigger:** a Bash command that activates corepack to provision a package
manager — `corepack enable`, `corepack prepare` (e.g. `corepack prepare
pnpm@9 --activate`), `corepack use`, or `corepack install`. Detected by
AST-parsing the command (`commandsFor`), not a raw regex. `corepack --version`
/ `corepack --help` / `corepack disable` provision nothing and are left alone.

**Why:** corepack is verboten fleet-wide. The fleet pins pnpm in
`external-tools.json` and installs it from that exact version via download +
Subresource-Integrity — `scripts/fleet/setup/setup-tools.mjs` locally, the
SocketDev/socket-registry `setup` composite action in CI — so the bytes are
integrity-checked before they run. corepack instead fetches a package manager
from the npm registry at activation time, outside that gate, keyed off a
mutable `packageManager` field: a second, un-pinned provisioning path that
bypasses the fleet's supply-chain controls. CLAUDE.md already bans
`npx`/`dlx`/`tsx` for adjacent reasons; this guard closes the corepack hole.

**Not the `packageManager` field:** that field stays in package.json as a
declared-version RECORD, kept in lockstep with `external-tools.json` (see
`scripts/repo/tools/pnpm.mts`). This guard blocks only the corepack COMMANDS
that would act on it, never the field itself.

**Fix the message gives:**
- local bootstrap: `node scripts/fleet/setup/setup-tools.mjs`
- CI: the same step runs via the socket-registry `setup` action (no caller change)

**Bypass:** `Allow corepack bypass` typed verbatim in a recent user turn.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Bash call.
