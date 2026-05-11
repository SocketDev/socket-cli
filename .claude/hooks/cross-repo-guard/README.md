# cross-repo-guard

A **Claude Code hook** that runs before `Edit` or `Write` tool calls
and **blocks** edits that introduce a path reference from one fleet
repo into another.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool. It can either
> **prime** (write to stderr, exit 0, model carries on) or **block**
> (exit 2, edit never happens). This one blocks.

## What it catches

Two forbidden shapes — both name another fleet repo by path:

| Form | Example | Why it's bad |
|------|---------|--------------|
| Cross-repo relative | `require('../../socket-lib/dist/effects/text-shimmer.js')` | Assumes `ultrathink/` and `socket-lib/` are sibling clones. Breaks in CI sandboxes, fresh checkouts, and any non-standard layout. |
| Cross-repo absolute | `require('/Users/jdalton/projects/socket-lib/dist/effects/ultra.js')` | Leaks the author's local directory layout into the committed tree. Same brittleness. |

## What to do instead

Import via the published npm package — every fleet repo is a real
workspace dep:

```ts
// ✗ WRONG (cross-repo relative)
import { applyShimmer } from '../../socket-lib/dist/effects/text-shimmer.js'

// ✗ WRONG (cross-repo absolute)
import { applyShimmer } from '/Users/<user>/projects/socket-lib/dist/effects/text-shimmer.js'

// ✓ RIGHT
import { applyShimmer } from '@socketsecurity/lib/effects/text-shimmer'
```

If the package isn't published or the version mismatches, vendor the
code into the consuming repo. Never bridge with a path-based
require/import that escapes the repo.

## Scope

- **Fires** on `Edit` and `Write` calls.
- **Exempts**: this hook's own source, the git-side scanner
  (`.git-hooks/_helpers.mts`), the canonical `CLAUDE.md` fleet block
  (which documents fleet repos by name), `.gitmodules`, lockfiles, and
  Claude memory files.
- **Exempts** lines tagged `// socket-hook: allow cross-repo` (or `#`
  / `/*` for non-TS files). The bare `// socket-hook: allow` form also
  works for blanket suppression.

## Fleet repo list

The hook recognizes these names as fleet repos:

```
claude-code
socket-addon
socket-btm
socket-cli
socket-lib
socket-packageurl-js
socket-registry
socket-wheelhouse
socket-sdk-js
socket-sdxgen
socket-stuie
ultrathink
```

To add a new fleet repo, update the list in `index.mts` AND in the
companion git-side scanner in `.git-hooks/_helpers.mts` (`FLEET_REPO_NAMES`)
— keep the two in sync.

## Wiring

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/cross-repo-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This README and the hook itself live in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/cross-repo-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
