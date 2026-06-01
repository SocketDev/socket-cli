# Never fork fleet-canonical files locally

Fleet-canonical files (anything tracked by `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts`) MUST be edited in `socket-wheelhouse/template/...` and cascaded out. Never branched locally in a downstream fleet repo.

## Canonical surfaces

These directories and files cascade fleet-wide. They are **not** repo-local:

- `.config/fleet/oxlint-plugin/`: plugin index + rules
- `.git-hooks/`: commit-msg / pre-commit / pre-push entry shims + .mts helpers (git invokes the shims when `core.hooksPath` is set to this directory; wired by `scripts/install-git-hooks.mts` at `pnpm install` time)
- `.claude/hooks/`: PreToolUse / PostToolUse hooks
- `.claude/skills/fleet/_shared/`: shared skill helpers
- `CLAUDE.md` fleet block (between `BEGIN/END FLEET-CANONICAL` markers)
- `docs/claude.md/fleet/`: fleet-canonical CLAUDE.md offshoot references (applies to every socket-\* repo)
- `docs/claude.md/wheelhouse/`: docs about the wheelhouse cascade mechanism itself (this file lives here)
- Downstream repos may add their own `docs/claude.md/<repo>/` subdirectory for repo-specific docs. Those are NOT fleet-canonical.
- Anything else listed in the sync manifest

If unsure, check `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts`. Tracked = canonical.

## How to apply

If a downstream repo needs a behavior change in one of these files:

1. Edit the file in `socket-wheelhouse/template/...`.
2. Commit the template change.
3. Run `node scripts/sync-scaffolding/cli.mts --target <downstream-repo> --fix` to cascade.

Do NOT edit the local copy in the downstream repo and rely on cascades to "preserve" your edits via `git checkout HEAD --` workarounds. That creates drift the sync mechanism then has to dance around, blocking other improvements from reaching that file in that repo.

## Spotting drift to lift

If you spot a useful predicate / helper / test / behavior in a fleet-canonical file in a downstream repo that is **not** in the template, that is a bug. Lift it up first, then re-cascade.

The fix is mechanical:

1. Diff the downstream version vs the template version.
2. Identify the additions (if there are any subtractions, those are also drift; usually they need to be added back to the downstream repo via a cascade).
3. Add the additions to the template.
4. Commit + push the template.
5. Re-cascade the downstream repo (overwrites its local copy with the now-superset canonical version).

## Why this matters

Local forks turn into "drift to preserve" hacks. Every cascade subagent has to be told to skip the locally-forked file, which makes the cascade fragile. Worse, those forks block fleet-wide improvements from reaching the forked repo: when the template's version of the file gets a real upgrade (e.g. a new fix predicate, a new exception case), the downstream repo's local copy never gets it.

The fleet's value is the shared canon. Branching locally splits the canon and erodes the value.

## Trust the wheelhouse (don't verify in downstream)

Companion behavior to the no-fork rule: **don't read, grep, or debug wheelhouse-canonical files in a downstream repo to verify what they contain or how they behave**.

- **DO NOT** grep a downstream repo's copy of `.config/fleet/oxlint-plugin/`, `.claude/hooks/fleet/`, `.git-hooks/`, `docs/claude.md/fleet/`, or the `CLAUDE.md` fleet block to check what's in it. Read from `socket-wheelhouse/template/...` instead.
- **DO NOT** debug the behavior of a cascaded hook by reading its downstream copy. The cascade overwrites those files; their content is the wheelhouse's content. Read upstream.
- **DO** treat any divergence as the downstream being stale. The wheelhouse is the oracle.

This matters because:

1. The downstream copy may already be a few cascade-steps behind the wheelhouse. Reading it gives stale information.
2. A "verify the bypass landed" loop in downstream is double work — once to read the file, once to act on it — when the wheelhouse already has the answer.
3. Per-session re-derivation of "what does this canonical file do?" burns tokens for zero net learning vs. just trusting that the wheelhouse + the cascade are correct.

When the user says "the wheelhouse has X," X is true. Act on it without verification.

If a cascaded file genuinely seems wrong, the fix lives in `socket-wheelhouse/template/...`, never in the downstream copy. Open the template file in `socket-wheelhouse/`, read it there, edit it there, cascade.

## Composite-file exception: CLAUDE.md is part-canonical, part-repo

**Don't apply the no-fork or trust-the-wheelhouse rules blindly to `CLAUDE.md`.** It's a composite file:

```
# CLAUDE.md
  ← preamble (repo-owned: header + the doc-shape blurb)
<!-- BEGIN FLEET-CANONICAL -->
  ← canonical block (wheelhouse-owned: byte-identical across the fleet)
<!-- END FLEET-CANONICAL -->
## 🏗️ Project-Specific
  ← postamble (repo-owned: architecture, commands, domain rules)
```

- The **canonical block** between `BEGIN/END FLEET-CANONICAL` markers IS fleet-canonical. Apply the no-fork rule + the trust-the-wheelhouse rule there. Edit only in `socket-wheelhouse/template/CLAUDE.md` and cascade.
- The **preamble** (file header, fleet/repo split blurb) and the **postamble** (`🏗️ Project-Specific` section after the END marker) are **repo-owned**. You CAN and SHOULD edit them in a downstream repo.

### When to trim preamble + postamble

CLAUDE.md is whole-file capped at 40 KB (enforced by `claude-md-size-guard`). The canonical block grows over time as the wheelhouse adds rules. When the canonical block grows, the cascade pushes that growth to every downstream repo, eating headroom in each repo's combined CLAUDE.md.

When a downstream repo's combined CLAUDE.md size approaches (or exceeds) 40 KB, trim **the repo-owned sections**, not the canonical block:

1. **Postamble first** — move detail to `docs/claude.md/repo/<topic>.md`. The CLAUDE.md `🏗️ Project-Specific` section should keep the headline invariants + a one-line reference to the docs file, not the full detail.
2. **Preamble next** — if it's grown to multi-paragraph prose explaining the fleet/repo split, compact to a one-paragraph summary. The canonical block speaks for itself; the preamble doesn't need to.
3. **Never trim the canonical block in a downstream repo.** That's a fleet-fork; the cascade will revert it next run, or worse, the cascade-splice mechanism will refuse to apply.

### Why trimming the repo-owned parts is not a fork

A "fork" creates **divergence between the downstream's canonical copy and the wheelhouse's version of the same canonical content**. Trimming a downstream's `🏗️ Project-Specific` section doesn't fork anything — that content NEVER existed in the wheelhouse template's canonical block. Each repo's postamble is unique to that repo.

The cascade's `extractFleetBlock` + `spliceFleetBlock` only touches the content between the BEGIN/END markers. Preamble + postamble pass through untouched. So a postamble trim is a local edit to local content, not a divergence from the shared canon.

### What the cascade does and doesn't replace

| Section                                   | Cascade behavior                                    |
| ----------------------------------------- | --------------------------------------------------- |
| Preamble (before `BEGIN FLEET-CANONICAL`) | Passes through untouched                            |
| Canonical block                           | Replaced with wheelhouse template's canonical block |
| Postamble (after `END FLEET-CANONICAL`)   | Passes through untouched                            |

So if the cascade pushes a downstream CLAUDE.md back over 40 KB, the fix is to trim the downstream's preamble or postamble — never the canonical block. The cascade preserves what you've trimmed there.
