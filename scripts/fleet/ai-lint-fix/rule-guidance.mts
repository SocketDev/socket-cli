/*
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

import { AI_TIER } from '@socketsecurity/lib-stable/ai/tier'

import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'

// Rules below need an AI-driven fix because the right rewrite
// depends on surrounding code structure that a regex / AST pass can't
// safely infer. Each one IS fixable — the AI step does the work.
// The deterministic linter already handled the unambiguous shapes;
// what remains is the structural-rewrite set.
export const AI_HANDLED_RULES: ReadonlySet<string> = new Set([
  'socket/inclusive-language',
  'socket/max-file-lines',
  'socket/no-fetch-prefer-http-request',
  'socket/no-malformed-bypass-marker',
  'socket/no-namespace-import',
  'socket/no-placeholders',
  'socket/no-source-sniffing',
  'socket/personal-path-placeholders',
  'socket/prefer-async-spawn',
  'socket/prefer-exists-sync',
  'socket/prefer-node-builtin-imports',
  'socket/prefer-non-capturing-group',
  'socket/prefer-normalize-path',
  'socket/prefer-undefined-over-null',
  'socket/require-regex-comment',
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
  // The right rewrite is fully determined by the pattern that fired
  // (appending a `-- reason` to a marker, `import * as` → named imports).
  'socket/inclusive-language': 'haiku',
  'socket/no-malformed-bypass-marker': 'haiku',
  'socket/no-namespace-import': 'haiku',
  'socket/no-placeholders': 'haiku',
  'socket/personal-path-placeholders': 'haiku',
  'socket/prefer-node-builtin-imports': 'haiku',
  'socket/prefer-undefined-over-null': 'haiku',
  // Control-flow / caller-chain rewrites. Need to read surrounding code +
  // reason about side effects (the `fs.access` Promise<boolean> collapse,
  // the sync→async caller chain, the fetch → httpJson error-handling
  // shape). Sonnet's reasoning is the right depth.
  'socket/no-fetch-prefer-http-request': 'sonnet',
  // Source-sniffing: rewrite a text-scan into a typed-export read or AST parse
  // (or justify-disable when the scan is genuinely necessary) — reads + reasons
  // about surrounding code, not a mechanical substitution.
  'socket/no-source-sniffing': 'sonnet',
  'socket/prefer-async-spawn': 'sonnet',
  'socket/prefer-exists-sync': 'sonnet',
  // Capture group: decide used→named vs unused→non-capturing by reading how the
  // match is consumed; normalize-path: pick the right import for a self-aliasing
  // lib. Both read surrounding code, so Sonnet's depth over Haiku's.
  'socket/prefer-non-capturing-group': 'sonnet',
  'socket/prefer-normalize-path': 'sonnet',
  // Reading a regex and writing a part-by-part breakdown comment is reasoning
  // about pattern semantics — Sonnet's the right depth (Haiku tends to write a
  // shallow restatement; Opus is overkill).
  'socket/require-regex-comment': 'sonnet',
  // Module decomposition. The model has to read the whole file, partition
  // by domain, decide what each new module exports, and rewrite imports
  // in every consumer. Real refactoring; Opus's depth pays back.
  'socket/max-file-lines': 'opus',
} as unknown as Readonly<Record<string, 'haiku' | 'opus' | 'sonnet'>>

/**
 * Map a tier label to the canonical Claude Code model ID — derived from
 * socket-lib's AI_TIER ladder (`@socketsecurity/lib-stable/ai/tier`), so a
 * global tier bump lands in ONE place (socket-lib) and every orchestrator
 * follows on the next lib-stable install.
 */
export const TIER_MODEL: Readonly<Record<'haiku' | 'opus' | 'sonnet', string>> =
  {
    __proto__: null,
    haiku: AI_TIER.haiku.model,
    sonnet: AI_TIER.sonnet.model,
    opus: AI_TIER.opus.model,
  } as Readonly<Record<'haiku' | 'opus' | 'sonnet', string>>

/**
 * Map a tier label to its reasoning-effort level (claude `--effort`). Effort
 * rides alongside the model per the CLAUDE.md token-spend rule ("match model
 * AND effort to the job") — a cheap model on max effort still burns reasoning
 * tokens a mechanical rewrite never needs. The tier ladder already encodes the
 * job's complexity, so effort tracks it: regex-shaped Haiku rewrites run `low`;
 * caller-chain Sonnet rewrites run `medium`; Opus module splits (the one tier
 * that genuinely reasons over the whole file) run `high`. The lib's
 * `spawnAiAgent` passes this through as the claude `--effort` flag; other
 * agents ignore it. Resolved via `AiEffort` from
 * `@socketsecurity/lib-stable/ai/types`.
 */
export const TIER_EFFORT: Readonly<
  Record<'haiku' | 'opus' | 'sonnet', AiEffort>
> = {
  __proto__: null,
  haiku: AI_TIER.haiku.effort,
  sonnet: AI_TIER.sonnet.effort,
  opus: AI_TIER.opus.effort,
} as unknown as Readonly<Record<'haiku' | 'opus' | 'sonnet', AiEffort>>

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
    'Split the file along its natural seams: one tool/domain/phase per file. Name the new files descriptively (`spawn-cdxgen.mts`, `parse-arguments.mts`). Update import paths in callers. Do not introduce a barrel just to hide the split. A file in the soft band (501–1000 lines) MUST split — there is no exemption marker there. The exemption is hard-cap-only (>1000 lines): only when one genuine cohesive unit (a single parser/state-machine/table that truly cannot split, or a generated artifact) exceeds 1000 lines, add a leading max-file-lines comment of the form category-then-reason naming WHAT the file is (never the self-judgment words legitimate/ok/exempt).',
  'socket/no-placeholders':
    'Implement the placeholder. If the work is too large, do NOT delete the marker — leave the file unchanged and explain in your final reply.',
  'socket/no-fetch-prefer-http-request':
    'Replace `fetch(url, opts)` with the right helper from `@socketsecurity/lib-stable/http-request`: `httpJson` when the caller calls `.json()` on the response, `httpText` when it calls `.text()`, `httpRequest` for raw access. Add the named import.',
  'socket/no-malformed-bypass-marker':
    'A disable marker (`oxlint-disable-next-line <rule>` or `socket-lint: allow <rule>`) is missing its required `-- <reason>`. Append ` -- <reason>` where the reason states WHY the waiver is correct, read from the disabled line plus any comment directly above it (for example `// oxlint-disable-next-line socket/prefer-undefined-over-null -- spec returns null here`). Keep the marker AND the code it guards exactly as-is; only add the reason. If multiple rules are listed, justify them all. Never delete the marker or change the guarded line.',
  'socket/no-namespace-import':
    'Rewrite a namespace import (`import * as X from "..."`) to named imports with the names actually used: inspect every `X.foo` reference in the file, import exactly those (`import { foo, bar } from "..."`), and change each `X.foo` to bare `foo`. If `X` is passed as a value (for example `someApi(X)`), or the import is a test module-mock or a bare Node builtin, keep the namespace form and add a `// no-namespace-import: passed-as-value` comment instead.',
  'socket/no-source-sniffing':
    'Code that scans source/file TEXT with a regex to infer behavior (for example, regex-testing a file string for a `module.exports =` assignment or an export keyword). Prefer rewriting to import the module and read its typed export (e.g. a `defineHook` instance), or parse the AST, instead of matching raw text. If a behavior-preserving rewrite is not safely possible because the text-scan is genuinely necessary (e.g. it lints raw source that cannot be imported), append `// oxlint-disable-next-line socket/no-source-sniffing -- <reason>` with a concrete justification. Never silently weaken behavior to satisfy the rule.',
  'socket/prefer-non-capturing-group':
    'A bare `(...)` capture group fired. If its captured text IS used (referenced by group index or name, or consumed by `String.prototype.split` / `matchAll` / `replace` group references), convert it to a NAMED group `(?<name>...)` with a descriptive name. If the group exists only for precedence or quantification and its capture is never read, convert it to non-capturing `(?:...)`. Read how the regex matches are consumed to decide. Do not change what the pattern matches.',
  'socket/prefer-normalize-path':
    'A manual path-separator rewrite fired (replacing backslashes with forward slashes on a path string). Replace the hand-rolled rewrite with `normalizePath(p)` and add the import, matching the import style the file already uses for sibling lib modules: the canonical `@socketsecurity/lib/paths/normalize` in `src/`/`test/` (vitest aliases it to local source), a relative path to `paths/normalize` when the module is nearby, or the `-stable` alias `@socketsecurity/lib-stable/paths/normalize` in scripts/hooks/config. Verify the rewrite is semantically identical (normalizePath yields one forward-slash-separated representation across platforms).',
  'socket/require-regex-comment': `Add a \`//\` comment that explains the flagged regex for a junior reader who won't mentally execute it. Put it on the line directly ABOVE the regex (preferred) or trailing the same line. Break the pattern into its parts and say what each MATCHES, not just what the variable is for.

<process>
  1. Read the whole regex. Identify its parts: anchors (\`^\`/\`$\`), character classes (\`[\\s,{]\`), groups (\`(?:…)\`), quantifiers (\`*\`/\`+\`/\`?\`/\`{n}\`), alternations (\`a|b\`), escapes (\`\\d\`, \`\\.\`).
  2. Write 1–6 short lines: for each meaningful part, "<the syntax> <what it matches>". Lead with the overall intent in one phrase.
  3. Place the comment ABOVE the regex line at the same indentation. Don't restate the variable name — explain the PATTERN.
  4. Don't change the regex itself. If after reading it you judge it genuinely trivial/obvious, append \`// socket-lint: allow uncommented-regex\` on its line instead of a breakdown.
</process>

<good-fix description="A property-key matcher, broken into boundary / name / terminator.">
+ // Match a \`model\` property KEY: a boundary before the name (whitespace,
+ // comma, opening brace, or start), the literal \`model\`, then \`:\` / \`,\` / \`}\`
+ // after it — so it sees \`model: x\` and the shorthand \`model\` but not \`customModel\`.
  const hasModel = /(?:[\\s,{]|^)model\\s*[:,}]/.test(span)
</good-fix>

<bad-fix description="Restates the variable, explains nothing about the pattern.">
+ // check for model
  const hasModel = /(?:[\\s,{]|^)model\\s*[:,}]/.test(span)
</bad-fix>`,
} as unknown as Readonly<Record<string, string>>
