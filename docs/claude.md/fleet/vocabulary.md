# Operator vocabulary

Fixed meanings for the operator's shorthand. Treat these as the operative
instruction the moment the phrase appears — no clarifying question needed.

## Command phrases

- **"commit as you go"** — make **surgical commits as you go**: `git commit -o <named-paths>` (or `git add <file>` then commit named paths), never `git add -A` / `.` / a broad sweep. Commit each logical chunk as it completes; don't batch.
- **"land it"** — commit **and push to the default branch** (`main`, falling back to `master`). Not a side branch, not commit-only-locally. "Landed" means on origin's default branch.
- **"update <socket-pkg>" / "use <socket-pkg>"** — for any socket package (`socket-lib`, `socket-registry`, `socket-sdk-js`, …), this **includes the `-stable` alias form** (`@socketsecurity/lib-stable`, `@socketsecurity/registry-stable`, …). The bare name is shorthand for the package in all its consumed forms.

## Writing

- **No "honest" / "honestly" as a framing word** in plans, docs, commit bodies, or prose. State the claim directly; the framing adds nothing. (The `prose-antipattern-guard` flags hedging adverbs; this is the same discipline applied to a filler frame.)

## Operational

- **A dirty / stale `pnpm-lock.yaml` is not a blocker** — it's regenerable. Run `pnpm i` (or `pnpm run update` then `pnpm i`) when it matters (before a frozen-lockfile CI step or a release prep wave). Don't pause, ask, or hand-restore around lockfile dirtiness. `pnpm install --lockfile-only` is instant (no proxy) and tells you whether the lockfile is actually stale before any full install.
