# no-registry-mutation-in-repo-script-nudge

PreToolUse nudge (advisory — never blocks). Flags a Write / Edit / MultiEdit to
a `scripts/repo/**` script that embeds a direct registry mutation (`publish` /
`deprecate` / `unpublish`, via npm / pnpm / yarn).

## Why

A one-off registry op is either a one-time bootstrap — which belongs in scratch
(`os.tmpdir()`), run once and discarded — or a recurring release, which belongs
in the OIDC publish workflow (`npm-publish.yml` →
`scripts/fleet/npm-publish.mts`). Neither belongs hand-committed under
`scripts/repo/`, which is for tooling that runs more than once. (The acorn
dot-rename bootstrap was wrongly written there and had to be removed after use.)

## Detection

A quoted package-manager token (`'npm'` / `'pnpm'` / `'yarn'`) AND a quoted
mutation verb (`'publish'` / `'deprecate'` / `'unpublish'`) in the about-to-land
content of a `scripts/repo/**` script. Best-effort — args assembled from a
variable escape it. Read-only calls (`view`, `whoami`) never match, and
`scripts/fleet/`, the sanctioned publisher's home, is never scanned.

Doctrine: the CLAUDE.md `plan-storage` bullet.
