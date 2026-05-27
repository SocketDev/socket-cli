# no-non-fleet-push-guard

PreToolUse(Bash) hook that blocks `git push` to a repository outside the
fleet.

## Why

The fleet's git-side pre-push hook only exists in repos that installed
the fleet hook chain. A non-fleet repo (a personal checkout, a sibling
project like `depot`) has no such hook, so a stray `cd /…/depot && git
push` sails straight through. The block has to live agent-side, before
the command runs, and resolve the target repo against the fleet roster.

Past incident: an agent `cd`-ed into `depot` (not a fleet repo) and
pushed a fleet-convention change to its `main`. The push succeeded
because depot has no fleet pre-push hook. This guard is the response.

## What it blocks

| Command shape                              | Resolves target via | Block? |
| ------------------------------------------ | ------------------- | ------ |
| `git push` (in a fleet repo cwd)           | process cwd         | no     |
| `git push` (in a non-fleet repo cwd)       | process cwd         | yes    |
| `cd /path/to/depot && git push`            | leading `cd`        | yes    |
| `git -C /path/to/depot push`               | `-C` flag           | yes    |
| `echo "git push"` / commit msg saying push | (not a push)        | no     |
| `git push` where `origin` is unresolvable  | (fail open)         | no     |

Fleet membership is the broad set in
[`_shared/fleet-repos.mts`](../_shared/fleet-repos.mts) (`FLEET_REPO_NAMES`),
which includes `ultrathink` and other members the narrower cascade
roster (`cascading-fleet/lib/fleet-repos.json`) omits. Gating on the
broad set is deliberate: a fleet member is pushable even if it isn't a
cascade target.

## Target-directory resolution

In priority order:

1. `git -C <dir> push …` — the explicit `-C` dir.
2. A leading `cd <dir>` in the command chain (`cd X && git push`),
   resolved against the process cwd for relative paths.
3. The hook's process cwd.

Then `git -C <dir> remote get-url origin` → slug via `slugFromRemoteUrl`
→ `isFleetRepo(slug)`.

## Fail-open

Any resolution ambiguity (no `git push` found, dir unreadable, no
`origin`, unparseable remote URL) → allow. Under-blocking is recoverable
(the operator reverts a stray push); a false block wedges a valid
workflow. The guard only fires when it can positively identify a
non-fleet origin slug.

## Bypass

Type the canonical phrase in a new message:

    Allow non-fleet-push bypass

Use for a genuine push to a personal / non-fleet repo you own.

## Detection: shell parser, not regex

`git push` detection goes through the shared shell parser
([`_shared/shell-command.mts`](../_shared/shell-command.mts), which wraps
`shell-quote`), not a regex. The parser splits the command line into
segments and reads the binary + subcommand at each position, so it sees
through:

- `&&` / `||` / `;` / `|` chains (`cd /x && git push`)
- `$(…)` command substitution (`git push $(echo origin)`)
- quoted bodies (`git commit -m "git push later"` is NOT a push)
- global options before the subcommand (`git -C /x push`)

Remaining limits of any static parser (shared with
`gh-token-hygiene-guard`): a binary fully sourced from a variable
(`g=git; $g push`) can't be statically resolved to `git` — the parser
FLAGS it as opaque (`hasOpaqueInvocation`) but this guard doesn't act on
that today; and an alias or wrapper script that pushes is out of scope.
