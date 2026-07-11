# Normalize path before match

A path-like variable must be normalized via `normalizePath()` (from
`@socketsecurity/lib/paths/normalize`) or `toUnixPath()` before any
separator-sensitive operation is applied to it. Operating on an un-normalized
path with `/` literals or dual-separator regexes produces different results
across darwin/linux (`/`) and win32 (`\`) and is a latent cross-platform bug.

## The rule

Prove normalization in scope before:

- **Regex match/exec/test/replace on a path variable** — `re.test(filePath)` where
  `filePath` isn't already assigned from `normalizePath()` or `toUnixPath()`.
- **String separator ops** — `.split('/')`, `.startsWith('/')`, `.endsWith('/')`,
  `.includes('/')` on a path-like variable.

"Proven normalized" means there is an assignment `const filePath =
normalizePath(raw)` (or `toUnixPath`) in the 20-line window before the usage.

## Enforcement surfaces

| Surface | File | What it catches |
| --------- | ------ | ----------------- |
| Lint rule (write-time) | `socket/normalize-path-before-match` | Un-normalized path ops in any edited `.ts`/`.mts` source |
| Belt check (commit-time) | `scripts/fleet/check/paths-are-normalized-before-match.mts` | Backlog scan of all committed source files |
| Stop hook (save-time) | `.claude/hooks/fleet/path-regex-normalize-nudge/` | Dual-separator regex writes (overlapping surface; keep both) |

The lint rule auto-fixes by wrapping the path argument in `normalizePath(…)`.
The check script is text-based (no full AST); a small false-positive rate is
acceptable because the lint rule is the authoritative gate.

## Shared git helper

`scripts/fleet/_shared/git-porcelain.mts` exports `gitPorcelain(cwd)` and
`parsePorcelain(raw)`. `parsePorcelain` uses `stdioString: false` to avoid
lib-stable's default trim, which strips the leading-space status char from `M
path` entries and corrupts the status column. New callers that need untrimmed
porcelain should import from this shared module; `land-work.mts` has its own
inlined copy (predates the module) and is NOT migrated here to avoid touching
the hook-owned file.

## Path-like heuristics

A variable is considered path-like when its name matches:

```
(?:^|_)(?:path|file|dir|cwd|root|src|dest|target|from|to|base|entry|output|input|abs|rel)(?:_|$)
| Path$ | File$ | Dir$
```

This is deliberately conservative — short one-letter names (`p`, `f`) are not
caught. Use `normalizePath` at the input boundary and carry the result into
downstream code.
