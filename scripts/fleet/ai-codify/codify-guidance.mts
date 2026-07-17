/*
 * @file Surface allowlist + per-surface authoring guidance + capability tiers
 *   for the ai-codify orchestrator (sibling of ai-lint-fix/rule-guidance.mts).
 *   Kept separate from `cli.mts` for the same reasons rule-guidance.mts is:
 *
 *   1. The guidance is large prose that changes independently from the
 *      orchestrator logic — editing it is a content review, not a code review.
 *   2. Adding / retiring a surface is a one-file edit here; cli.mts just imports
 *      `CODIFY_SURFACES`, the tier maps, and `SURFACE_GUIDANCE` and works with
 *      whatever's defined. Invariant: every entry in `CODIFY_SURFACES` has a
 *      matching key in both `SURFACE_TIER` and `SURFACE_GUIDANCE`. What this
 *      codifies, and where it stops: codifying-disciplines decides WHICH
 *      surface a gap needs (the "Choosing the surface" decision in its
 *      SKILL.md). This module owns HOW to author each surface once chosen — the
 *      file conventions, the ceremony (CLAUDE.md citation, settings wiring,
 *      check registration), the mandatory test, and which model/effort tier the
 *      authoring warrants. The `agents-doc` surface (a terse CLAUDE.md bullet +
 *      a docs/agents.md detail doc) is delegated to `codify-rule.mts` rather
 *      than authored here — that script already owns the 40KB-budget +
 *      defer-to-docs split via AI_PROFILE.create, so ai-codify shells out to it
 *      instead of duplicating the prompt.
 */

import { AI_TIER } from '@socketsecurity/lib-stable/ai/tier'

import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'

/**
 * The enforcement surfaces ai-codify knows how to author. A codification gap
 * resolves to one (or, for defense-in-depth, several) of these. `agents-doc` is
 * the documentation surface — handled by codify-rule.mts, listed here so the
 * orchestrator can route to it uniformly.
 */
export type CodifySurface =
  | 'agents-doc'
  | 'check'
  | 'hook-guard'
  | 'hook-nudge'
  | 'lint-rule'

export const CODIFY_SURFACES: ReadonlySet<CodifySurface> = new Set([
  'agents-doc',
  'check',
  'hook-guard',
  'hook-nudge',
  'lint-rule',
] as const)

/**
 * Capability tier per surface. Authoring a hook or a lint rule is real
 * multi-file engineering (new dir, index + README + package.json + test, then
 * the CLAUDE.md citation + settings/registration wiring) — Opus on high. A
 * check script is a single self-contained file mirroring an existing template
 * (scanForX → fail listing hits) — Sonnet on medium is the right depth. The
 * `agents-doc` surface is delegated to codify-rule.mts, which pins its own
 * tier; the entry here is the tier ai-codify passes through when it shells
 * out.
 *
 * Tier order: `claude-haiku-4-5` < `claude-sonnet-4-6` < `claude-opus-4-8`.
 * Pairing effort with the model is the CLAUDE.md token-spend rule — a cheap
 * model left on the session default still burns reasoning a mechanical job
 * never needs, and a premium model on low effort under-thinks a hard one.
 */
export const SURFACE_TIER: Readonly<
  Record<CodifySurface, 'haiku' | 'opus' | 'sonnet'>
> = {
  __proto__: null,
  // Documentation edit (terse bullet + detail doc) — delegated to
  // codify-rule.mts, which runs it on sonnet/medium.
  'agents-doc': 'sonnet',
  // Single self-contained script that mirrors an existing check template.
  check: 'sonnet',
  // New hook dir + full ceremony. Real authoring; Opus depth pays back.
  'hook-guard': 'opus',
  'hook-nudge': 'opus',
  // New oxlint rule (AST visitor) + rule test + plugin registration. The
  // deepest authoring surface — reasoning over the AST shape to match.
  'lint-rule': 'opus',
} as unknown as Readonly<Record<CodifySurface, 'haiku' | 'opus' | 'sonnet'>>

/**
 * Map a tier label to the canonical Claude Code model ID — derived from
 * socket-lib's AI_TIER ladder (`@socketsecurity/lib-stable/ai/tier`), the same
 * source ai-lint-fix's TIER_MODEL derives from, so the two orchestrators stay
 * in lockstep structurally and a model-generation roll is one socket-lib edit.
 */
export const TIER_MODEL: Readonly<Record<'haiku' | 'opus' | 'sonnet', string>> =
  {
    __proto__: null,
    haiku: AI_TIER.haiku.model,
    opus: AI_TIER.opus.model,
    sonnet: AI_TIER.sonnet.model,
  } as Readonly<Record<'haiku' | 'opus' | 'sonnet', string>>

/**
 * Map a tier label to its reasoning-effort level (claude `--effort`). Effort
 * rides with the model per the CLAUDE.md token-spend rule; both come from the
 * same AI_TIER row, so the pair can never drift apart here.
 */
export const TIER_EFFORT: Readonly<
  Record<'haiku' | 'opus' | 'sonnet', AiEffort>
> = {
  __proto__: null,
  haiku: AI_TIER.haiku.effort,
  opus: AI_TIER.opus.effort,
  sonnet: AI_TIER.sonnet.effort,
} as unknown as Readonly<Record<'haiku' | 'opus' | 'sonnet', AiEffort>>

/**
 * Resolve a surface to its { model, effort } tier. Unknown surface → sonnet
 * (the historical default), so a future surface added to CODIFY_SURFACES
 * without a SURFACE_TIER entry degrades safely rather than throwing.
 */
export function tierFor(surface: CodifySurface): {
  effort: AiEffort
  model: string
  tier: 'haiku' | 'opus' | 'sonnet'
} {
  const tier = SURFACE_TIER[surface] ?? 'sonnet'
  return { effort: TIER_EFFORT[tier], model: TIER_MODEL[tier], tier }
}

/**
 * Per-surface authoring guidance — the file conventions + ceremony for the
 * surface, rendered into the prompt. Concise and low-freedom: one canonical
 * shape per surface. The agent already knows WHAT discipline to enforce (passed
 * in the prompt); this tells it HOW to lay the surface down so it matches the
 * fleet and passes the relevant guards on the first try.
 */
export const SURFACE_GUIDANCE: Readonly<Record<CodifySurface, string>> = {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- null-prototype object literal.
  __proto__: null,
  'agents-doc': `Do NOT author this surface directly. The documentation surface (a terse one-line CLAUDE.md bullet pointing at a detail doc under docs/agents.md/{fleet,repo}/) is owned by scripts/fleet/codify-rule.mts, which keeps the CLAUDE.md edit under the 40KB whole-file cap and the per-section ≤8-line cap by pushing all prose into the doc. The orchestrator shells out to that script; you should not see this guidance unless a routing bug sent you here — stop and report it.`,
  check: `Author a single self-contained fleet check at scripts/fleet/check/<assertion-name>.mts, then register it in scripts/fleet/check.mts.

<conventions>
  - Name the file as an ASSERTION (\`<thing>-is-<property>.mts\`, e.g. \`hook-dirs-are-not-husks.mts\`) — the check-names-are-assertions gate enforces this.
  - Mirror an existing check's shape (read scripts/fleet/check/hook-dirs-are-not-husks.mts as the canonical template): a header comment (what / why / what fails / usage), pure exported scan functions (\`scanForX(repoRoot): Hit[]\`), a \`main()\` that logs hits + sets \`process.exitCode = 1\` on findings, and the entrypoint guard \`if (isMainModule(import.meta.url)) { main() }\`.
  - Import REPO_ROOT from '../paths.mts'; logger from '@socketsecurity/lib-stable/logger/default'.
  - Register it in scripts/fleet/check.mts as \`() => run('node', ['scripts/fleet/check/<name>.mts'])\` with a 2-4 line comment naming the discipline + the motivating incident generically (no dates/SHAs — the dated-citation rule).
  - If the check has non-trivial pure logic, write a vitest test at test/repo/unit/check/<name>.test.mts (a dead-export fixture that fails + a clean one that passes) and run it with \`pnpm test test/repo/unit/check/<name>.test.mts\`. Fleet-script tests cascade in lock-step; see docs/agents.md/fleet/test-layout.md.
</conventions>`,
  'hook-guard': `Author a new BLOCKING hook at .claude/hooks/{fleet,repo}/<name>-guard/ (a -guard BLOCKS; if it only nudges, use hook-nudge instead — never both for one concern).

<ceremony>
  1. BEFORE index.mts: add the \`(\`.claude/hooks/<name>-guard/\`)\` citation to the matching CLAUDE.md rule line — the new-hook-claude-md-guard requires the citation to exist first.
  2. index.mts: a PreToolUse hook. Use the shared helpers — \`withEditGuard\`/\`withBashGuard\` from ../_shared/payload.mts (they drain stdin, gate the tool, narrow the command/file, fail open), \`bypassPhrasePresent\` from ../_shared/transcript.mts, the AST parser from ../_shared/shell-command.mts for Bash commands (never raw regex on the command line). Export the pure decision helpers so the test can import them. Run main()/the guard call ONLY behind the entrypoint guard \`if (process.argv[1] && import.meta.url === \\\`file://\\\${process.argv[1]}\\\`)\` — a bare top-level call hangs the test on import (hook-main-is-entrypoint-guarded check).
  3. README.md: document the trigger + the bypass phrase (\`Allow <X> bypass\`).
  4. package.json + tsconfig.json: copy a sibling hook's (workspace package; \`pnpm install\` + commit the lockfile in the same change or CI's frozen-install fails).
  5. settings wiring: add the hook to .claude/settings.json under the right event (PreToolUse).
  6. test: a VITEST test at test/repo/{unit,integration}/hooks/<name>-guard.test.mts (NOT co-located — hook tests are wheelhouse-only and live under test/repo/) that imports the source by relative path ending in ../../../../template/base/.claude/hooks/{fleet,repo}/<name>-guard/index.mts. Cover both arms (blocks on the bad shape, passes the good shape, honors the bypass phrase, fails open on a malformed payload). Run with \`pnpm test test/repo/{unit,integration}/hooks/<name>-guard.test.mts\`. See docs/agents.md/fleet/test-layout.md.
  Block exit code 2; pass/fail-open exit 0.
</ceremony>`,
  'hook-nudge': `Author a new NON-BLOCKING hook at .claude/hooks/{fleet,repo}/<name>-nudge/ (a -nudge NUDGES, exit 0 always; if it should BLOCK, use hook-guard instead). Same ceremony as a guard (CLAUDE.md citation first, shared helpers, entrypoint guard, README, package.json/tsconfig, settings wiring, and a VITEST test at test/repo/{unit,integration}/hooks/<name>-nudge.test.mts importing the source via ../../../../template/base/... — run with \`pnpm test <path>\`; see docs/agents.md/fleet/test-layout.md) with two differences:
  - It writes its nudge to stderr and ALWAYS exits 0 — it never blocks the turn.
  - A Stop-event reminder must exit DETERMINISTICALLY (no lingering stdin listeners / timers); end main() with an explicit resolve and run it behind the entrypoint guard. Reuse ../_shared/stop-nudge.mts (runStopReminder) when the nudge fires on Stop.`,
  'lint-rule': `Author a new oxlint rule in the fleet plugin at .config/fleet/oxlint-plugin/fleet/<rule-name>/ plus its registration and test.

<conventions>
  - Default the rule to \`"error"\`, never \`"warn"\` (CLAUDE.md "Lint rules: errors over warnings"). Ship a deterministic autofix (\`fixable: 'code'\`) when the rewrite is unambiguous.
  - Mirror an existing rule's shape (an AST visitor with create(context) returning node-type handlers). Read a sibling rule under .config/fleet/oxlint-plugin/fleet/ as the template.
  - Register the rule in the plugin's rule index AND add it to the fleet oxlintrc so it actually runs.
  - Write a VITEST test at test/repo/{unit,integration}/lint-rules/<rule-name>.test.mts (NOT co-located — lint-rule tests are wheelhouse-only and live under test/repo/) that imports the rule by relative path ending in ../../../../template/base/.config/fleet/oxlint-plugin/fleet/<rule-name>/index.mts. Run with \`pnpm test test/repo/{unit,integration}/lint-rules/<rule-name>.test.mts\`. See docs/agents.md/fleet/test-layout.md.
  - The rule is defense-in-depth ALONGSIDE a hook/CLAUDE.md line when the discipline is also edit-time-visible — name the companion surfaces; do not assume the lint rule alone is enough.
</conventions>`,
} as unknown as Readonly<Record<CodifySurface, string>>
