# markdown-filename-guard

PreToolUse Edit/Write hook that blocks markdown files with non-canonical filenames.

## What it enforces

| Filename shape                                                                                                                                                                                                                             | Allowed at                                                | Notes                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| `README.md`, `LICENSE`                                                                                                                                                                                                                     | anywhere                                                  | Special-cased by GitHub.                                      |
| `AUTHORS.md`, `CHANGELOG.md`, `CITATION.md`, `CLAUDE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `CONTRIBUTORS.md`, `COPYING`, `CREDITS.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `NOTICE.md`, `SECURITY.md`, `SUPPORT.md`, `TRADEMARK.md` | repo root, `docs/` (top level), or `.claude/` (top level) | The SCREAMING_CASE allowlist. GitHub renders these specially. |
| `lowercase-with-hyphens.md`                                                                                                                                                                                                                | inside `docs/` or `.claude/` (any depth)                  | All other docs.                                               |

Blocked:

- Custom SCREAMING_CASE filenames (`NOTES.md`, `MY_DESIGN.md`, etc.) — rename to `notes.md` / `my-design.md`.
- `.MD` extension — use `.md`.
- `camelCase.md` / `snake_case.md` / `Spaces In Filename.md` — convert to lowercase-with-hyphens.
- Lowercase-hyphenated docs at repo root — move to `docs/` or `.claude/`.

## Why

SCREAMING_CASE doc filenames optimize for "noticeable in a repo root" but read as shouty + opaque inside body text and TOC links. Lowercase-with-hyphens reads naturally and matches the rest of the fleet's slug-style identifiers (URLs, CSS classes, CLI flags, package names). The narrow SCREAMING_CASE allowlist is the set GitHub renders specially — adding more dilutes the signal.

The fleet's `scripts/validate/markdown-filenames.mts` does the same check at commit time (per repo, not template-canonical); this hook catches it earlier, at edit time, so the model gets immediate feedback when it picks a wrong name.

## Companion files

- `index.mts` — the hook itself.
- `test/index.test.mts` — node:test specs (15 cases).
- `package.json` — workspace declaration so `taze` can see the hook's deps.
- `tsconfig.json` — fleet-canonical TS config.

## Adding a new allowed filename

If GitHub adds a new specially-rendered file (e.g. `FUNDING.md`), update `ALLOWED_SCREAMING_CASE` in `index.mts` and the table above. Don't add custom project-specific SCREAMING_CASE filenames here — those break the convention.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session. The `scripts/validate/markdown-filenames.mts` gate at commit time is the second line of defense.
