<!--
This file is the rule snippet that goes into every Socket repo's CLAUDE.md
(or the equivalent canonical instructions file). It mirrors
.claude/skills/_shared/path-guard-rule.md byte-for-byte; keep them in sync.
-->

## 1 path, 1 reference

**A path is *constructed* exactly once. Everywhere else *references* the constructed value.**

Referencing a single computed path many times is fine — that's the whole point of computing it once. What's banned is *re-constructing* the same path in multiple places, because that's where drift is born.

Three concrete shapes:

1. **Within a package** — every script, test, and lib file that needs a build path imports it from the package's `scripts/paths.mts` (or `lib/paths.mts`). No `path.join('build', mode, ...)` outside that module.

2. **Across packages** — when package B consumes package A's output, B imports A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', ...)`. The R28 yoga/ink bug — ink hand-building yoga's wasm path and missing the `wasm/` segment — is the canonical failure mode this rule prevents.

3. **Workflows, Dockerfiles, shell scripts** — they can't `import` TS, so they construct the string once and reference it everywhere downstream. Workflows: a "Compute paths" step exposes `steps.paths.outputs.final_dir`; later steps read `${{ steps.paths.outputs.final_dir }}`. Dockerfiles/shell: assign once to a variable / `ENV`, reference by name thereafter. Each canonical construction carries a comment naming the source-of-truth `paths.mts`. **Re-building** the same path in a second step is the violation, not referring to the constructed value many times.

Comments may describe path *structure* with placeholders ("`<mode>/<arch>`" or "`${BUILD_MODE}/${PLATFORM_ARCH}`") but should not encode a complete literal path string. Code execution takes priority over docs: violations in `.mts`/`.cts`, Makefiles, Dockerfiles, workflow YAML, and shell scripts are blocking. README and doc-comment violations are advisory unless they contain a fully-qualified path with no parametric placeholders.

### Three-level enforcement

- **Hook** — `.claude/hooks/path-guard/` blocks `Edit`/`Write` calls that would introduce a violation in a `.mts`/`.cts` file. Refusal at edit time stops new duplication from landing.
- **Gate** — `scripts/check-paths.mts` runs in `pnpm check`. Fails the build on any violation that isn't allowlisted in `.github/paths-allowlist.yml`.
- **Skill** — `/path-guard` audits the repo and fixes findings; `/path-guard check` reports only; `/path-guard install` drops the gate + hook + rule into a fresh repo.

The mantra is intentionally short so it sticks: **1 path, 1 reference**. When in doubt, find the canonical owner and import from it.
