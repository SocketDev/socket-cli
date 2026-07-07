---
name: migrating-rule-packs
description: Run a code migration (zod → typebox, fetch → http-request, lib → lib-stable, etc.) as a rule-pack-driven autonomous loop across many target files in parallel. Runs a Workflow that streams the target files through a transform → build/fix/check/test pipeline, one worktree-isolated agent per file, with a feedback channel that rewrites PR-review comments back into the rule files. Use when a migration touches 10+ files with a deterministic transformation, when each target file is independently transformable, or when human-led serial editing would dominate the wall-clock time. The skill packages the four pieces a rule-pack migration needs: a rule-pack format, an autonomous per-file build/fix/check/test loop, parallel worktree execution, and a feedback channel that rewrites PR-review comments back into the rule files.
user-invocable: true
allowed-tools: Workflow, Read, Edit, Write, Grep, Glob, Bash(git worktree:*), Bash(git branch:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git log:*), Bash(git diff:*), Bash(node:*), Bash(pnpm:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(mkdir:*), Bash(rm:*), Bash(mv:*), Bash(cp:*)
model: claude-sonnet-4-6
context: fork
---

# migrating-rule-packs

Codify the agentic-migration pattern Salesforce reported in their _how engineering became agentic_ post: markdown rule files + a reference implementation + an autonomous build/fix/check/test loop + parallel worktree spawns + PR-review feedback rewritten back into the rules. The autonomous per-file loop runs as a `Workflow` — a `pipeline()` over the target files, one worktree-isolated agent per file streaming transform → build/fix/check/test. The wheelhouse already has the canonical-and-cascade shape this pattern depends on; this skill names the pattern so it stops being recreated ad-hoc per migration.

🚨 **This skill is for mechanical migrations, not redesigns.** If you don't have a deterministic transformation that runs the same way on every target file, you don't have a rule-pack migration — you have a refactor that wants human judgment per call site. Use the `refactor-cleaner` agent or hand-edit instead. Rule-packs assume "given input shape A, produce output shape B" with finite exception cases.

## When to use

- Type-system migrations: zod → typebox, ajv → typebox, valibot → typebox.
- API migrations: bare `fetch()` → `@socketsecurity/lib-stable/http-request` helpers, `node:child_process` → lib `spawn`, raw `fs.rm` → `safeDelete`.
- Import-path lifts: `@socketsecurity/lib` → `@socketsecurity/lib-stable` (in `scripts/**` + `.claude/hooks/**`).
- Patch-format conversions: legacy `Socket Security:` headers → `# @<project>-versions: vX.Y.Z` + `# @description: ...`.
- Cross-fleet variant-analysis fixes: same shape found in N repos, fixed N times.

## When NOT to use

- One-off design changes that need per-call-site human judgment.
- Migrations where the transformation depends on runtime behavior the rules can't statically detect.
- Single-file changes — the parallel worktree overhead isn't worth it under ~5 target files.
- Migrations whose target shape isn't stable yet (the rules are wet cement; pin them first via a reference implementation).

## The four pieces

### 1. The rule pack

A rule pack is a directory of markdown files at:

    <repo>/.claude/migrations/<migration-name>/rules/*.md

The directory is **untracked by default** — same as `.claude/plans/`. The rule pack is per-migration working memory, not a fleet artifact. Promote stable patterns to lint rules or hooks once the migration completes.

Each rule file is one transformation. Shape:

```markdown
# Rule: <short name>

## Pattern (before)

\`\`\`ts
import { z } from 'zod'
const Schema = z.object({ name: z.string(), age: z.number().optional() })
\`\`\`

## Replacement (after)

\`\`\`ts
import { Type, type Static } from '@sinclair/typebox'
const Schema = Type.Object({ name: Type.String(), age: Type.Optional(Type.Number()) })
type Schema = Static<typeof Schema>
\`\`\`

## When the rule applies

- The file imports from `'zod'`.
- The schema is built via `z.object(...)` (not `z.union(...)` — that's a separate rule).

## When the rule does NOT apply

- The schema is consumed by a library that requires zod specifically (rare; cite the library when this triggers).
- The schema uses `.refine()` — typebox has no direct equivalent; the rule defers to a hand-edit.

## Reference implementation

PR #<N> in <repo> applied this rule to <path/to/file.ts>. The diff is the canonical example.
```

The skill author writes the rule pack first, lands a reference PR by hand, then unleashes the autonomous loop on remaining target files using the reference as ground truth.

### 2 + 3. The autonomous per-file loop: author a `Workflow`

The per-file loop is built as `lib/run-migration.mts` — a bounded-concurrency worker pool over the target files (each a fresh worktree off `origin/<default-branch>` on a `migration/<name>-<slug>` branch). The target files are independent units that each stream through the same transform → verify stages, and the per-file agents MUTATE files in parallel, so they run worktree-isolated. The intelligence is contained: the locked-down agent's ONLY job is "apply the rule pack to this one file"; everything else (survey, gate verdict, commit/push/PR) is deterministic code. This section is the architecture the runner implements:

1. **Resolve the target set first (plain code, no agents).** Survey the target files (`rg` the before-pattern across the migration scope), load the rule-pack markdown, resolve the default branch per CLAUDE.md's _Default branch fallback_ recipe. Build the per-file work items.
2. **`phase('Migrate')` — `pipeline(targetFiles, transform, buildFixCheckTest)`.** Each target file streams through two stages, both as `agent()` with `isolation: 'worktree'` (a fresh worktree off `origin/<default-branch>` on a `migration/<migration-name>-<target-slug>` branch, mirroring cascade's convention at `<repo>/.claude/worktrees/<migration-name>/<target-slug>/`):
   - **`transform`** — self-prompt with the rule-pack as context; apply the rules to the one target file, returning a `TRANSFORM_SCHEMA` (`{ file, rulesApplied: string[], exceptions: [{ rule, why }] }`).
   - **`buildFixCheckTest`** — the validation gate: loop `pnpm run build && pnpm run check && pnpm run test` up to 3 attempts; on failure append `result.stderr` to the agent's rule-context and retry; on success `git add <file>` + commit + push the branch + open the PR. Returns a `RESULT_SCHEMA` (`{ file, status: landed|exception, attempts, prUrl?, failureMode? }`). `pipeline()` gives per-item streaming — file N+1 starts its transform while file N is still in build/check/test — without a barrier across files.
   - The `pipeline()` runtime caps concurrency; default 5 in-flight worktree agents (higher risks lock-stepped pnpm/cargo runs hammering shared caches; lower under-utilizes). Tune per migration. If the migration accumulates (the rule-pack keeps growing as PRs land), make the pipeline budget-aware / loop-until-done: re-survey for newly-matching files after each rule-pack update and feed them back through.
3. **Barrier → report.** Collect every item's `RESULT_SCHEMA`, `.filter(Boolean)`, and surface any `status: exception` files as per-file findings the human handles. Worktrees are cleaned up after the PR lands or by `cleaning-ci`'s sibling cleanup hook.

Return `{ landed, exceptions, prUrls }` from the script. The `RESULT_SCHEMA` replaces re-parsing each Agent's free-text exit — every file returns validated landed/exception status the report reads directly. The validation gate stays the same: if `pnpm run check` doesn't catch the regression, the rule needs a tighter assertion.

### 4. PR-review feedback as rule rewrites

Every merged PR's review comments get rewritten back into the rule files as a NEW commit on the rule-pack. This is the feedback loop that makes the rule pack improve over time — the human reviewer's diff suggestions become the next iteration's "When the rule does NOT apply" entries.

Workflow:

1. Reviewer leaves an inline comment on a migration PR ("don't use Type.Number() for IDs — use Type.Integer() with constraints").
2. Skill operator updates the relevant rule file with the new exception.
3. Remaining open migration PRs receive the rule-pack update via `git pull` in their worktrees; they re-run the loop from scratch.

The rule pack is wet cement until the migration completes; the last PR's rules are the final form. After the migration lands, the operator may promote the stable rules to an oxlint rule or a `.claude/hooks/` guard (per CLAUDE.md _Compound lessons_).

## How to invoke

The operational runner is `lib/run-migration.mts` — it owns the deterministic machinery (survey, worktree-per-file, the locked-down per-file transform, the build/fix/check/test gate, the per-file commit/push/PR, the report). The two pieces that need a human stay with you: writing the rule pack + reference PR (genuine judgment), and reviewing each PR + folding inline comments back into the rules (the feedback loop).

Per-migration flow:

1. **Author rules + reference PR (you).** Write `<repo>/.claude/migrations/<name>/rules/*.md` (one transformation per file, shape in [§1](#1-the-rule-pack)). Hand-port one file, land it, cite its SHA in every rule. The runner reads whatever `*.md` lives in `--rules`, so the rules ARE the ground truth.
2. **Run the loop:**

   ```sh
   node .claude/skills/fleet/migrating-rule-packs/lib/run-migration.mts \
     --name zod-to-typebox \
     --rules .claude/migrations/zod-to-typebox/rules \
     --survey 'z\.(object|union|literal|enum|tuple|array)' \
     --scope packages \
     --repo SocketDev/socket-mcp
   ```

   It surveys the target set, then for each file spawns a worktree-isolated, locked-down agent (`spawnAiAgent` + `AI_PROFILE.verify` — four-flag lockdown, `permissionMode: acceptEdits`, never the raw `claude` CLI) that applies the rule pack and self-runs the gate; the runner re-asserts `build → check → test` in plain code (the agent's self-report is a lead, not the verdict), then deterministically commits + pushes + opens the PR. `--dry-run` runs the transform + gate but never lands. `--concurrency` (default 5), `--attempts` (default 3), `--model`, `--effort` tune the run. Exits non-zero while any file is in `exception` status.
3. **Review + fold feedback (you).** Review each PR, merge the clean ones. Inline review comments become new "When the rule does NOT apply" entries in the rule files (the [§4](#4-pr-review-feedback-as-rule-rewrites) loop); re-run the runner to pick up newly-matching files against the updated rules.

## Acceptance for the skill itself

- This SKILL.md exists ✓ (you're reading it).
- The operational runner `lib/run-migration.mts` is built ✓ and the SKILL thin-wraps it.
- The first real migration runs through it end-to-end; record the actual speedup vs. estimated serial time wherever the operator tracks it.

## Precedent

The cascade orchestrator (`template/.claude/skills/fleet/cascading-fleet/lib/cascade-template.mts`) already does parallel-worktree execution across the fleet. Pattern is "lift cascade's runtime for migrations" — same worktree convention, same per-target commit shape, different inner loop.

Related fleet skills:

- `cascading-fleet` — propagate one wheelhouse SHA to every fleet repo (this skill's parent pattern).
- `refactor-cleaner` (agent) — for non-mechanical refactors that need per-call-site human judgment.
- `looping-quality` — for in-repo cleanup waves; rule-pack migrations are the cross-repo / cross-file generalization.

## What NOT to do

- **Don't** invoke this skill without a reference PR landed first. The reference PR is ground truth; without it, the autonomous loop has nothing to validate against.
- **Don't** parallel-cap above 5 by default. Lock-stepped pnpm/cargo runs hammer shared caches.
- **Don't** mark a migration done if any target file landed in "exception (human handles)" status — those are the rule-pack's tells about coverage gaps. Either land the exception by hand (and update the rules), or accept the migration as partial.
- **Don't** delete the per-repo rule pack after the migration lands — promote the stable patterns to an oxlint rule or hook, but leave the `.claude/migrations/<name>/` directory as historical context for the next analogous migration.
