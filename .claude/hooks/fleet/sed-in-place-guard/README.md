# sed-in-place-guard

PreToolUse(Bash) hook. **Blocks** in-place stream edits: `sed -i` /
`--in-place` (and `gsed`), `perl -pi` / `ruby -pi` flag clusters, and gawk's
`-i inplace`.

## Why

In-place stream edits address the file by line number or pattern captured at
an EARLIER read. The file drifts underneath the session — another actor
commits, a formatter reflows, an earlier edit shifts offsets — and the edit
then lands on the wrong region **silently**: no uniqueness check, no failure
signal. Live example that motivated this guard: a `sed -i '' '2755,2757d'`
aimed at a stale HTML comment deleted the body of an unrelated CSS rule,
because the line numbers were read two turns (and one concurrent commit)
earlier.

The sanctioned paths fail loud instead:

- **Edit tool** — anchors on exact current content; errors on a mismatch or a
  non-unique anchor.
- **Write** — whole-file rewrites of a file just read.
- **Scripted bulk edits** — python/node with asserted unique content anchors
  (`assert old in s`) before replacing. Never line numbers.

Read-only sed (`sed -n '1,60p'`, filters in pipelines) passes untouched.

## Trigger

`Bash` commands whose token stream contains one of the editor names followed
by an in-place flag cluster, including through `find … -exec` and `xargs`.

## Bypass

Type `Allow sed-in-place bypass` verbatim in a recent user turn (single-use)
— for the genuine cases, e.g. a generated file too large for the Edit tool.
