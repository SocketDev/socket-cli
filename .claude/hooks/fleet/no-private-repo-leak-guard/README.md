# no-private-repo-leak-guard

PreToolUse hook that BLOCKS a `gh` command whose outbound text names a
private repository while the write target is a public (or unverifiable)
repo. Enforcement twin of `private-name-nudge`, which only reminds.

## Why

A review reply on a public PR walked through a private repo's internal file
paths and queue configuration. `private-name-nudge` fired its reminder and
the agent posted anyway — a nudge is attention priming, not enforcement.
Private repo names, internal paths, and architecture details on a public
surface disclose infrastructure that is deliberately non-public. This guard
makes the rule refuse the call instead of asking nicely.

## How

On a `Bash` tool call the guard:

1. Extracts every piece of outbound prose from the parsed `gh` segments:
   `--body`/`--title`/`--notes` values (and `-b`/`-t`), `--body-file` /
   `--notes-file` contents, and `gh api` `-f`/`-F` field values under prose
   keys (`body`, `title`, `notes`, `description`, `message`, `text`, and
   GraphQL `query` documents), including `@file` indirection. No prose, no
   verdict.
2. Resolves the write targets (`--repo`/`-R`, `gh api repos/o/n/…` paths,
   GraphQL `repository(owner:…, name:…)` literals). If every resolved target
   is a private repo, the post is internal conversation and passes. A target
   that cannot be resolved, such as a GraphQL call addressed only by node id,
   is treated as public — strict by default.
3. Loads the repo rosters for the trusted owners (the targets' owners and
   the cwd origin's owner) via `gh repo list <owner> --json name,visibility`,
   cached at `~/.socket/_state/private-repo-roster.json` (0600, in a 0700
   dir) with a 24h TTL. The roster is runtime-derived on purpose: a
   checked-in denylist of private repo names would itself be the leak this
   guard exists to stop. GitHub's `INTERNAL` visibility counts as private.
4. Blocks when the prose contains a qualified `owner/repo` (or `#123` /
   `@sha` / github.com URL) reference that resolves private, or a bare
   private-repo name on a word boundary. Bare matching skips names shorter
   than 4 characters and single lowercase words that read as ordinary
   English or generic software nouns (`docs`, `deploy`, `runner`, …); a name
   carrying a hyphen, dot, or digit is always treated as a slug. Every name
   the bare tier declines still blocks in qualified form.
5. Fails CLOSED when no roster can be loaded: the post needs the network
   anyway, so a working `gh` is a fair precondition. A cached roster past
   its TTL counts as absent — certifying prose against a day-old view of the
   org is the failure this guard exists to prevent.

## Layout

`index.mts` is the orchestrator only. The parts are split so each is
testable on its own:

- `outbound-prose.mts` — what the command publishes, and where it writes.
- `roster.mts` — which repository names under an owner are private.
- `leak-scan.mts` — the qualified and bare two-tier matcher.

Specs live at
`test/repo/integration/hooks/no-private-repo-leak-guard.test.mts`.

## Fix

Remove the private reference entirely. Describe the fact without naming the
repo or its internal paths — "checked server-side", "our shared template".
Do not substitute a placeholder that hints at the name.

## Bypass

The user types `Allow private-leak bypass` verbatim in a recent turn.
