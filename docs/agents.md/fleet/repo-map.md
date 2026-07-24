# Repo-map — orient by skeleton, read the span

Re-reading context across turns is the dominant model-spend surface: a whole-file
read accumulates in context and is re-read on every later turn. Repo-map is the
retrieval substrate that answers it — orient by a token-cheap symbol skeleton,
then read only the one line span you actually need.

## The engine

`scripts/fleet/gen/repo-map.mts` emits a symbol skeleton for a file or
directory: one header line per file plus one line per top-level symbol,
`Lstart-Lend  <signature>`. Deterministic and read-only apart from `--write`.

```sh
# Print a skeleton to stdout.
node scripts/fleet/gen/repo-map.mts <file|dir> [<file|dir>…]
# (Re)build the on-disk cache.
node scripts/fleet/gen/repo-map.mts --write .
# Refresh only git-touched files.
node scripts/fleet/gen/repo-map.mts --write --changed
```

Default mode prints the skeleton to stdout with a `source → skeleton` savings
summary on stderr (on the shared hook libs the skeleton is ~8% of source size).
Model-agnostic — it is the substrate the "RAG + repo-map" retrieval answer points
at, not a Claude-only tool.

## Spend-delta measurement

The engine reports bytes, not provider billing. Bytes are a repeatable lower-bound
proxy for context spend: source bytes approximate a whole-file read and skeleton
bytes approximate the orientation read. Do not describe this as observed token or
dollar savings without paired transcript data.

Run the same command before and after map changes and keep the stderr summary:

```sh
node --experimental-strip-types scripts/fleet/gen/repo-map.mts scripts/fleet
```

Baseline captured 2026-07-16 on the wheelhouse fleet scripts:

| corpus | whole source | skeleton | proxy reduction |
| --- | ---: | ---: | ---: |
| `scripts/fleet` | 2,869 KB | 218 KB | 92.4% |

This confirms that the landed map materially reduces the orientation payload. A
real session-spend study still needs paired transcripts with and without the
nudge/cache; record the model, session count, and token totals here when available.

## The cache

`--write` persists each file's skeleton to `.repo-map/<relpath>.skel`, mirroring
the source tree, plus a greppable `.repo-map/index.txt` roll-up (every file with
its line/symbol counts + the aggregate savings). Flags:

- `--changed` — only (re)skeleton git-touched sources (tracked diff vs `HEAD` +
  untracked); the cheap incremental refresh. Skips the index rewrite so a partial
  pass never clobbers the full index with a sparse one.
- `--out <dir>` — cache dir (default `.repo-map`).

`.repo-map/` is **gitignored and generated** — it belongs to the gh-release
bundle, never the byte-identical commit cascade. It never needs hand-editing;
it is always regenerable from source.

## The workflow

1. `/map <path>` — the fleet `map` skill, a thin wrapper over the engine — or run
   the engine directly. To seed/rebuild the whole cache, run the saved
   `refresh-repo-map` workflow (full `--write .` build + a coverage/top-savings
   report).
2. Read the skeleton — a fresh `.repo-map/<file>.skel` when the cache is warm,
   else generate one — to find the symbol and its span.
3. Read ONLY that span with `offset`/`limit` (a symbol at `201-253` →
   `Read(file, offset=201, limit=53)`). A full read stays correct only when you
   are about to edit the file and need exact surrounding bytes.

## Wired into the harness

Two hooks make the cache actually get used, not just exist:

- `read-orientation-nudge` (PreToolUse, advisory — never blocks) fires when a
  whole-file `Read` of a LARGE source file (≥6 KB, no `offset`/`limit`) is about
  to land. When a **fresh** cached skeleton exists (`.repo-map/<rel>.skel`, mtime
  at/after the source's) it points straight at that ready-made file; otherwise it
  suggests `gen/repo-map --write`. It skips scoped reads, small files, non-source
  files, and unreadable paths — a full read is still correct when you need exact
  byte context for an edit.
- `repo-map-refresh` (SessionStart, fail-open) detached-spawns `--write
  --changed` at session start to keep the cache warm, but only when `.repo-map/`
  already exists — a fresh clone pays no first-build; seed it once via the
  `refresh-repo-map` workflow.

## Tiering

Engine, skill, workflow, and both hooks are fleet-tier — cascaded to every member
so the orient-first discipline holds fleet-wide. The engine is the single owner;
the skill and hooks are thin wrappers that defer to it. Fix parsing/behavior in
`gen/repo-map.mts`, not in the wrappers.
