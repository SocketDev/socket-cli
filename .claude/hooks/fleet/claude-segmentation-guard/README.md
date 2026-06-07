# claude-segmentation-guard

PreToolUse Edit/Write hook that blocks new files/directories at dangling top-level paths under `.claude/{agents,commands,hooks,skills}/`.

## Why

Every entry under those four directories must live under one of:

- `<kind>/fleet/<name>/` — wheelhouse-canonical entries (the wheelhouse template ships an entry with this name).
- `<kind>/repo/<name>/` — repo-only entries (everything else).
- `<kind>/_<name>/` — internals folder (`_shared` and friends).

Top-level dangling entries like `.claude/skills/foo/SKILL.md` shadow the canonical `.claude/skills/fleet/foo/SKILL.md` copy and break skill resolution in unpredictable ways.

Left unchecked, dangling top-level entries accumulate across the fleet — duplicate top-level skill directories shadow their `fleet/<name>/` counterparts and break resolution. The cleanup script (`node scripts/fleet/check/claude-dirs-are-segmented.mts --fix`) resolves them in bulk; this hook prevents the regression at edit time.

## What it blocks

Edit/Write on any path matching `.claude/<kind>/<name>/...` where `<kind>` is `agents | commands | hooks | skills` and `<name>` is NOT one of `fleet | repo | _*`.

| Path                                                | Result |
| --------------------------------------------------- | ------ |
| `.claude/skills/foo/SKILL.md`                       | block  |
| `.claude/agents/foo.md`                             | block  |
| `.claude/hooks/foo/index.mts`                       | block  |
| `.claude/skills/fleet/foo/SKILL.md`                 | pass   |
| `.claude/skills/repo/foo/SKILL.md`                  | pass   |
| `.claude/skills/_shared/util.mts`                   | pass   |
| `.claude/skills/_internal/x.mts`                    | pass   |
| `template/.claude/skills/foo/SKILL.md` (wheelhouse) | block  |

## How

The hook reads the Claude Code PreToolUse JSON payload from stdin, runs the regex `\.claude/(?<kind>agents|commands|hooks|skills)/(?<entry>[^/]+)` on `tool_input.file_path`, and exits 2 if the captured `entry` segment is not `fleet`, `repo`, or `_`-prefixed.

The stderr message names the offending path and the two allowed destinations (`fleet/<name>/` or `repo/<name>/`), plus the autofix command for cleaning up entries already on disk.

Fails open on malformed payloads or unknown errors (exit 0).

## Bypass

None. The autofix is always available: `node scripts/fleet/check/claude-dirs-are-segmented.mts --fix` moves dangling entries into the right subdir based on the wheelhouse-canonical fleet/ set.

## Test

```sh
pnpm test
```
