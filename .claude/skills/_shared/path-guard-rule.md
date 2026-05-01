<!--
Shared snippet — the canonical "1 path, 1 reference" rule text.
Synced byte-identical across the Socket fleet via socket-repo-template's
sync-scaffolding.mts (SHARED_SKILL_FILES).

This file is the source of truth for the rule's wording. Three artifacts
embed (or paraphrase) it:

  1. CLAUDE.md — every Socket repo's instructions to Claude.
  2. .claude/hooks/path-guard/README.md — what the hook blocks.
  3. .claude/skills/path-guard/SKILL.md — what the skill enforces.

If the wording changes here, re-run `node scripts/sync-scaffolding.mts
--all --fix` from socket-repo-template to propagate.
-->

## 1 path, 1 reference

**A path is *constructed* exactly once. Everywhere else *references* the constructed value.**

Referencing a single computed path many times is fine — that's the whole point of computing it once. What's banned is *re-constructing* the same path in multiple places, because that's where drift is born. Three concrete shapes:

1. **Within a package** — every script, test, and lib file that needs a build path imports it from the package's `scripts/paths.mts` (or `lib/paths.mts`). No `path.join('build', mode, ...)` outside that module.

2. **Across packages** — when package B consumes package A's output, B imports A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', ...)`. The R28 yoga/ink bug — ink hand-building yoga's wasm path and missing the `wasm/` segment — is the canonical failure mode this rule prevents.

3. **Workflows, Dockerfiles, shell scripts** — they can't `import` TS, so they construct the string once and reference it everywhere downstream. Workflows: a "Compute paths" step exposes `steps.paths.outputs.final_dir`; later steps read `${{ steps.paths.outputs.final_dir }}`. Dockerfiles/shell: assign once to a variable, reference by name thereafter. Each canonical construction carries a comment naming the source-of-truth `paths.mts` so the YAML can't drift from TS without a flagged change. **Re-building** the same path in a second step is the violation, not referring to the constructed value many times.

Comments that re-state a full path are forbidden. The import statement IS the comment. Docs and READMEs may describe the structure ("output goes under the Final dir") but should not encode a complete `build/<mode>/<platform-arch>/out/Final/binary` string — encoded paths get parsed by tools and silently rot.

Code execution takes priority over docs: violations in `.mts`/`.cts`, Makefiles, Dockerfiles, workflow YAML, and shell scripts are blocking. README and doc-comment violations are advisory unless they contain a fully-qualified path with no parametric placeholders.

### Three-level enforcement

- **Hook** — `.claude/hooks/path-guard/` blocks `Edit`/`Write` calls that would introduce a violation in a `.mts`/`.cts` file. Refusal at edit time stops new duplication from landing.
- **Gate** — `scripts/check-paths.mts` runs in `pnpm check`. Fails the build on any violation that isn't allowlisted.
- **Skill** — `/path-guard` audits the repo and fixes findings; `/path-guard check` reports only; `/path-guard install` drops the gate + hook + rule into a fresh repo.

The mantra is intentionally short so it sticks: **1 path, 1 reference**. When in doubt, find the canonical owner and import from it.
