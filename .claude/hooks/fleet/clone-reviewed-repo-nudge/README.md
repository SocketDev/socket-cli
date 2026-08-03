# clone-reviewed-repo-nudge

PreToolUse(Bash) hook. **Nudges** (stderr only, never blocks) when an agent
reviews or clones an **external** GitHub repo — one not owned by the SocketDev
fleet org — toward the fleet's standard reference-clone location and the
smallest-practical clone flags.

## Why

Reviewing an external repo a file at a time through the GitHub web/API is slow
and leaves no local tree to `grep` / read / index. The fleet standardizes:

- **Where:** `~/.socket/_wheelhouse/repo-clones/<org>-<repo>/` (lowercased +
  dash-cased), resolved via `getSocketRepoClonesDir()` from
  `@socketsecurity/lib/paths/socket`. Never `~/projects/*` — the fleet's
  sibling-walk tooling (cascade `--all`, fleet-roster discovery) treats those
  as member checkouts.
- **How:** `git clone --depth=1 --single-branch --filter=blob:none <url>` —
  shallow + single-branch + blobless partial. Smallest disk footprint and
  fastest download; file blobs are fetched lazily on first access.

SocketDev-owned repos are fleet members (cloned the normal way under
`~/projects` via the cascade tooling), so they never trip this nudge.

## What it nudges

Two arms, AST-parsed (`commandsFor` / `findInvocation`, never a raw regex over
the command line):

1. **Reviewing through `gh`** — `gh repo view <owner/repo>`, `gh pr … --repo
   <owner/repo>` / `-R <owner/repo>`, where `<owner>` is not SocketDev → nudge
   to clone the repo locally first.
2. **`git clone` of an external repo missing the smallest flags** — a clone of
   a GitHub URL whose owner is not SocketDev that omits any of `--depth=1`,
   `--single-branch`, `--filter=blob:none` → nudge to add the missing flags and
   target the repo-clones dir.

The detection helpers (`parseGithubSlug`, `missingCloneFlags`,
`externalGhRepo`, `repoClonesName`) are exported for unit testing.

## Bypass

None — a nudge never blocks, so there is nothing to bypass. Ignore the stderr
line if the clone is intentional (e.g. you genuinely need full history for a
`git log`/`git bisect` investigation, which `--depth=1` precludes).
