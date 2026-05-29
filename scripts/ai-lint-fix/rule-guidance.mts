/**
 * @file Rule allowlist + per-rule prompt guidance for the AI-fix orchestrator.
 *   Kept separate from `cli.mts` because:
 *
 *   1. The data is large (~200 LOC of prompt text) and changes independently from
 *      the orchestrator logic.
 *   2. Editing a prompt is a content review, not a code review — having it in its
 *      own file makes that distinction visible.
 *   3. Adding / removing a rule is a one-file edit here; the orchestrator just
 *      imports `AI_HANDLED_RULES` + `RULE_GUIDANCE` and works with whatever's
 *      defined. Invariant: every entry in `AI_HANDLED_RULES` must have a
 *      matching key in `RULE_GUIDANCE`. The orchestrator iterates findings,
 *      filters to AI-handled rules, then looks up the guidance text per rule
 *      id. A missing guidance entry would render an empty `<rule>` block — the
 *      lint runner's `validate-template.mts` could enforce this if drift ever
 *      becomes a concern.
 */

// Rules below need an AI-driven fix because the right rewrite
// depends on surrounding code structure that a regex / AST pass can't
// safely infer. Each one IS fixable — the AI step does the work.
// The deterministic linter already handled the unambiguous shapes;
// what remains is the structural-rewrite set.
export const AI_HANDLED_RULES: ReadonlySet<string> = new Set([
  'socket/inclusive-language',
  'socket/max-file-lines',
  'socket/no-fetch-prefer-http-request',
  'socket/no-placeholders',
  'socket/personal-path-placeholders',
  'socket/prefer-async-spawn',
  'socket/prefer-exists-sync',
  'socket/prefer-node-builtin-imports',
  'socket/prefer-undefined-over-null',
])

/**
 * Capability tier per rule. The orchestrator picks the highest-tier model among
 * a per-file batch's rules so a single Haiku-only file goes cheap, a mixed
 * batch gets Sonnet, and any `max-file-lines` finding triggers Opus (module
 * splits are real refactoring).
 *
 * Why per-rule rather than per-file or per-finding:
 *
 * - Per-finding would spawn N AI calls per file. Wasteful.
 * - Per-file flat would route everything to Sonnet defensively. Wasteful too.
 * - Per-rule + escalation matches the actual cost surface: simple regex-shaped
 *   rewrites (identifier rename, null→undefined, fs.X → X) work fine on Haiku;
 *   control-flow + caller-chain rewrites (fetch→httpJson, sync→async, fs.access
 *   → existsSync) need Sonnet; module decomposition needs Opus.
 *
 * Tier order: `claude-haiku-4-5` < `claude-sonnet-4-6` < `claude-opus-4-8`. Add
 * new rules to the right bucket when adding to AI_HANDLED_RULES.
 */
export const RULE_MODEL_TIER: Readonly<
  Record<string, 'haiku' | 'opus' | 'sonnet'>
> = {
  __proto__: null,
  // Identifier renames, single-token substitutions, namespace rewrites.
  // The right rewrite is fully determined by the pattern that fired.
  'socket/inclusive-language': 'haiku',
  'socket/no-placeholders': 'haiku',
  'socket/personal-path-placeholders': 'haiku',
  'socket/prefer-node-builtin-imports': 'haiku',
  'socket/prefer-undefined-over-null': 'haiku',
  // Control-flow / caller-chain rewrites. Need to read surrounding code +
  // reason about side effects (the `fs.access` Promise<boolean> collapse,
  // the sync→async caller chain, the fetch → httpJson error-handling
  // shape). Sonnet's reasoning is the right depth.
  'socket/no-fetch-prefer-http-request': 'sonnet',
  'socket/prefer-async-spawn': 'sonnet',
  'socket/prefer-exists-sync': 'sonnet',
  // Module decomposition. The model has to read the whole file, partition
  // by domain, decide what each new module exports, and rewrite imports
  // in every consumer. Real refactoring; Opus's depth pays back.
  'socket/max-file-lines': 'opus',
} as unknown as Readonly<Record<string, 'haiku' | 'opus' | 'sonnet'>>

/**
 * Map a tier label to the canonical Claude Code model ID. Centralized here so a
 * global tier bump (Haiku 4.5 → 4.6, Sonnet 4.6 → 5.0, etc.) is a single-file
 * edit and won't drift across the orchestrator + the docs.
 */
export const TIER_MODEL: Readonly<Record<'haiku' | 'opus' | 'sonnet', string>> =
  {
    __proto__: null,
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-8',
  } as Readonly<Record<'haiku' | 'opus' | 'sonnet', string>>

/**
 * Pick the highest tier present in a per-file batch's rule set. Returns a tier
 * label; the caller resolves it to a model via `TIER_MODEL`. Default (no
 * recognized rules in batch) is `sonnet` — the historical baseline.
 *
 * `ruleIds` is a concrete array (not `Iterable<string>`) so the loop can use
 * the cached-length for-loop idiom the fleet's `prefer-cached-for-loop` lint
 * rule enforces. Callers in cli.mts already build a string[] via
 * `findings.map(f => f.ruleId).filter(...)`.
 */
export function escalateTier(
  ruleIds: readonly string[],
): 'haiku' | 'opus' | 'sonnet' {
  let highest: 'haiku' | 'opus' | 'sonnet' = 'haiku'
  let sawAny = false
  for (let i = 0, { length } = ruleIds; i < length; i += 1) {
    const tier = RULE_MODEL_TIER[ruleIds[i]!]
    if (!tier) {
      continue
    }
    sawAny = true
    if (tier === 'opus') {
      return 'opus'
    }
    if (tier === 'sonnet') {
      highest = 'sonnet'
    }
  }
  // No recognized rules → fall back to sonnet (historical default).
  return sawAny ? highest : 'sonnet'
}

/**
 * Per-rule guidance — concise, low-freedom (one canonical rewrite per rule).
 * Built per Anthropic's prompt-engineering best practices: direct instructions,
 * XML structure, examples per rule.
 *
 * Each entry is rendered into the prompt as `<rule id="...">…</rule>` inside a
 * `<rules>` block. Claude sees only the rules that fired in the current file,
 * so noise stays low.
 */
export const RULE_GUIDANCE: Readonly<Record<string, string>> = {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- null-prototype object literal.
  __proto__: null,
  // oxlint-disable-next-line socket/inclusive-language -- rule guidance string documents the legacy terms it scans for.
  'socket/inclusive-language':
    'Replace `master`/`slave` with the contextually correct term: `main` (branch), `primary`/`controller` (process), `replica`/`worker`/`secondary`/`follower` (subordinate). Read the surrounding code to pick the right one. Do not autofix when an external API field name forces the legacy term — leave a `// inclusive-language: external-api` comment instead.',
  'socket/personal-path-placeholders':
    "Two scenarios. (1) Source code / docs / tests: replace literal usernames in user-home paths with the canonical placeholder — `<user>` for /Users/ and /home/, `<USERNAME>` for C:\\Users\\. Env-var forms (`$HOME`, `${USER}`, `%USERNAME%`) are also acceptable. (2) WASM / generated bundles / minified output: a literal username inside compiled output means the bundler is leaking the developer's path. Trace back to the build config (esbuild / rolldown / webpack `sourcemap`, `sourceRoot`, `__dirname` baking, fs.realpath calls in plugins) and fix THAT — do not chase the string in the artifact.",
  'socket/prefer-exists-sync':
    'Rewrite `fs.access` / `fs.stat` existence-checks to `existsSync(p)` from `node:fs`. Common shapes: `try { await fs.access(p); return true } catch { return false }` → `return existsSync(p)`. `await fs.access(p).then(() => true).catch(() => false)` → `existsSync(p)`. `if (await fs.stat(p))` → `if (existsSync(p))`. When the stat result is destructured for metadata (`s.size`, `s.mtime`, `s.isDirectory()`), KEEP the stat call and add a one-line comment stating intent — that is not an existence check. Trace back through callers: if the caller awaited a Promise<boolean>, the rewrite collapses to a sync boolean and the await becomes a no-op (safe).',
  'socket/prefer-node-builtin-imports':
    "Rewrite `import fs from 'node:fs'` / `import * as fs from 'node:fs'` to `import { … } from 'node:fs'` with the names actually used in the file. Change every `fs.X` reference to bare `X`. If `fs` is passed as a value (e.g. `someApi(fs)`), keep the namespace import and add a `// prefer-node-builtin-imports: passed-as-value` comment.",
  'socket/prefer-async-spawn': `Replace \`node:child_process\` spawn calls with their \`@socketsecurity/lib-stable/process/spawn/child\` equivalents. The lib re-exports BOTH names so a sync caller keeps using \`spawnSync\` and only the import source changes; only convert sync → async when the enclosing function is already async (or can be safely made async) AND every caller of that function is async-ready.

<process>
  1. List every spawn-family callsite in the file: \`spawnSync(\`, \`spawn(\`, \`child_process.spawnSync(\`, \`cp.spawnSync(\`. Note which names are actually used.
  2. For each callsite, decide: (a) keep sync semantics — use \`spawnSync\` from the lib (drop-in, same args, same return shape \`{ status, stdout, stderr }\`); or (b) convert to async — use \`spawn\` from the lib (returns a Promise of \`{ code, stdout, stderr }\`, requires \`await\`, requires async enclosing context, return shape uses \`.code\` not \`.status\`). Default to (a) unless you can verify (b) is safe — sync → async is a contract change.
  3. Update the import line. If every callsite stays sync: \`import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'\`. If every callsite becomes async: \`import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\`. If mixed: \`import { spawn, spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'\`.
  4. Self-verify before stopping: re-read the file. Confirm EVERY \`spawnSync(\` callsite is satisfied by the new import (either the name is in the import list OR you converted that callsite to \`await spawn(\`). A file with \`import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\` and a body containing \`spawnSync(\` is broken — fix it before you declare done.
</process>

<good-fix description="Sync caller; safest path is keeping sync semantics by importing spawnSync from the lib.">
- import { spawnSync } from 'node:child_process'
+ import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

  function run(cmd) {
    const r = spawnSync(cmd, [], { encoding: 'utf8' })
    return r.status === 0
  }
</good-fix>

<bad-fix description="What you must NOT do: rename the import without updating callsites.">
- import { spawnSync } from 'node:child_process'
+ import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

  function run(cmd) {
    const r = spawnSync(cmd, [], { encoding: 'utf8' })  // ❌ spawnSync is no longer imported — runtime ReferenceError
    return r.status === 0
  }
</bad-fix>

<good-fix description="Async caller; can switch to lib's async spawn AND update return-shape access.">
- import { spawnSync } from 'node:child_process'
+ import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

  async function run(cmd) {
    const r = await spawn(cmd, [], { stdio: 'pipe' })
    return r.code === 0  // .code, not .status
  }
</good-fix>`,
  'socket/prefer-undefined-over-null':
    'In the target file, flip BOTH the value and the surrounding type annotation in lockstep: `let x: string | null = null` → `let x: string | undefined = undefined`. Apply to function-parameter annotations, return-type annotations, generic-parameter constraints, interface / type-alias members. For tight-equality checks in the same file: `x === null` → `x === undefined` (loose `x == null` already covers both — leave loose-equality alone). DO NOT edit other files; if a caller in another file depends on the type, the lint rule will fire there on the next run and a separate AI-fix subprocess will pick it up. Skip the finding if the type is a third-party API contract you cannot change (e.g. a return type from a library).',
  'socket/max-file-lines':
    'Split the file along its natural seams: one tool/domain/phase per file. Name the new files descriptively (`spawn-cdxgen.mts`, `parse-arguments.mts`). Update import paths in callers. Do not introduce a barrel just to hide the split. If the file is a single legitimate parser/state-machine/table, add a leading `// max-file-lines: legitimate parser` comment instead of splitting.',
  'socket/no-placeholders':
    'Implement the placeholder. If the work is too large, do NOT delete the marker — leave the file unchanged and explain in your final reply.',
  'socket/no-fetch-prefer-http-request':
    'Replace `fetch(url, opts)` with the right helper from `@socketsecurity/lib-stable/http-request`: `httpJson` when the caller calls `.json()` on the response, `httpText` when it calls `.text()`, `httpRequest` for raw access. Add the named import.',
} as unknown as Readonly<Record<string, string>>
