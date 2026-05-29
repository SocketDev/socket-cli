# uses-sha-verify-guard

PreToolUse hook that blocks Edit/Write tool calls introducing GitHub URL pins that aren't full 40-char SHAs reachable in their referenced repo.

## What it enforces

Every GitHub URL pin across the fleet needs a full 40-char commit SHA that resolves. Truncated SHAs (`3d33ecebbb` — 10 chars), version tags (`v1.2.3`), branch names (`main`), and SHAs that don't resolve via `gh api repos/<owner>/<repo>/commits/<sha>` are all blocked.

Three surfaces:

| Surface                                                    | Required pin shape                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.github/workflows/*.yml` + `.github/actions/*/action.yml` | `uses: <owner>/<repo>(/<path>)?@<40-hex>`                                                            |
| `.gitmodules`                                              | BOTH `# <name>-<version> sha256:<64-hex>` comment AND `ref = <40-hex>` field per `[submodule]` block |
| `package.json`                                             | `git+https://github.com/<owner>/<repo>(.git)?#<40-hex>` for any GitHub-URL dep specifier             |

The `.gitmodules` content-hash (`sha256:`) and the `ref =` (commit SHA) are both required — the comment is the upstream-archive content-hash pin (drift-watch signal); the `ref` is what `git submodule update` checks out.

## Why a hook

Typing a truncated SHA into a `uses:` line is a silent fail. The action resolver may quietly succeed against a "close enough" ref, or fail at runtime in CI long after the bad edit landed. The hook catches it at edit time, before the bad pin reaches the commit. It's a companion to `gitmodules-comment-guard` (which enforces the `# <name>-<version>` shape but not SHA correctness).

## Caching

`gh api` results are cached at `~/.claude/uses-sha-verify-cache.json` keyed by `<owner>/<repo>@<sha>` with a 7-day TTL. A SHA reachable yesterday is reachable today; re-querying every edit is wasteful and rate-limit-prone.

## Bypass

Type the canonical phrase `Allow uses-sha-verify bypass` verbatim in a recent user turn. Per the fleet bypass-phrase convention.

## Fail-open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session.
