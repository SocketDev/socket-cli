/* oxlint-disable socket/inclusive-language -- AI-fix rule guidance documents the legacy terms each rule scans for. */

/**
 * @fileoverview Rule allowlist + per-rule prompt guidance for the
 * AI-fix orchestrator.
 *
 * Kept separate from `cli.mts` because:
 *
 *   1. The data is large (~200 LOC of prompt text) and changes
 *      independently from the orchestrator logic.
 *   2. Editing a prompt is a content review, not a code review —
 *      having it in its own file makes that distinction visible.
 *   3. Adding / removing a rule is a one-file edit here; the
 *      orchestrator just imports `AI_HANDLED_RULES` + `RULE_GUIDANCE`
 *      and works with whatever's defined.
 *
 * Invariant: every entry in `AI_HANDLED_RULES` must have a matching
 * key in `RULE_GUIDANCE`. The orchestrator iterates findings, filters
 * to AI-handled rules, then looks up the guidance text per rule id.
 * A missing guidance entry would render an empty `<rule>` block — the
 * lint runner's `validate-template.mts` could enforce this if drift
 * ever becomes a concern.
 */

// Rules below need an AI-driven fix because the right rewrite
// depends on surrounding code structure that a regex / AST pass can't
// safely infer. Each one IS fixable — the AI step does the work.
// The deterministic linter already handled the unambiguous shapes;
// what remains is the structural-rewrite set.
export const AI_HANDLED_RULES: ReadonlySet<string> = new Set([
  // master/slave — context decides main/primary/controller vs
  // replica/worker. Other forms (whitelist/blacklist/etc.) auto-fix.
  'socket/inclusive-language',
  // Literal username in a user-home path. In source: substitute a
  // placeholder / env-var / delete. In WASM or generated bundles:
  // the bundler is leaking the path — fix the build config.
  'socket/personal-path-placeholders',
  // fs.access / fs.stat existence checks. AI rewrites the try/catch
  // → if/else and preserves metadata calls when the result is
  // destructured. Wrapper-name shapes (fileExists / pathExists /
  // isFile / isDir) auto-fix deterministically.
  'socket/prefer-exists-sync',
  // node:fs default/namespace where references are "weird" (computed
  // access, passed as a value, reassigned). Plain `fs.X` shapes
  // auto-fix via scope rename.
  'socket/prefer-node-builtin-imports',
  // spawnSync where the call site isn't already in async context or
  // its return value is consumed (assignment, property access).
  // await/expression-statement shapes auto-fix.
  'socket/prefer-async-spawn',
  // null whose surrounding type annotation also mentions null. AI
  // flips BOTH the annotation and the value in lockstep through the
  // function signatures / interfaces / return types involved.
  // Cross-file ripple is handled by per-file passes on the next run.
  'socket/prefer-undefined-over-null',
  // File splitting needs to choose natural seams.
  'socket/max-file-lines',
  // Placeholder finishes need actual implementation.
  'socket/no-placeholders',
  // No-fetch needs httpJson/httpText/httpRequest decision based on
  // how the response is consumed.
  'socket/no-fetch-prefer-http-request',
])

/**
 * Per-rule guidance — concise, low-freedom (one canonical rewrite
 * per rule). Built per Anthropic's prompt-engineering best practices:
 * direct instructions, XML structure, examples per rule.
 *
 * Each entry is rendered into the prompt as `<rule id="...">…</rule>`
 * inside a `<rules>` block. Claude sees only the rules that fired in
 * the current file, so noise stays low.
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
  'socket/prefer-async-spawn': `Replace \`node:child_process\` spawn calls with their \`@socketsecurity/lib-stable/spawn\` equivalents. The lib re-exports BOTH names so a sync caller keeps using \`spawnSync\` and only the import source changes; only convert sync → async when the enclosing function is already async (or can be safely made async) AND every caller of that function is async-ready.

<process>
  1. List every spawn-family callsite in the file: \`spawnSync(\`, \`spawn(\`, \`child_process.spawnSync(\`, \`cp.spawnSync(\`. Note which names are actually used.
  2. For each callsite, decide: (a) keep sync semantics — use \`spawnSync\` from the lib (drop-in, same args, same return shape \`{ status, stdout, stderr }\`); or (b) convert to async — use \`spawn\` from the lib (returns a Promise of \`{ code, stdout, stderr }\`, requires \`await\`, requires async enclosing context, return shape uses \`.code\` not \`.status\`). Default to (a) unless you can verify (b) is safe — sync → async is a contract change.
  3. Update the import line. If every callsite stays sync: \`import { spawnSync } from '@socketsecurity/lib-stable/spawn'\`. If every callsite becomes async: \`import { spawn } from '@socketsecurity/lib-stable/spawn'\`. If mixed: \`import { spawn, spawnSync } from '@socketsecurity/lib-stable/spawn'\`.
  4. Self-verify before stopping: re-read the file. Confirm EVERY \`spawnSync(\` callsite is satisfied by the new import (either the name is in the import list OR you converted that callsite to \`await spawn(\`). A file with \`import { spawn } from '@socketsecurity/lib-stable/spawn'\` and a body containing \`spawnSync(\` is broken — fix it before you declare done.
</process>

<good-fix description="Sync caller; safest path is keeping sync semantics by importing spawnSync from the lib.">
- import { spawnSync } from 'node:child_process'
+ import { spawnSync } from '@socketsecurity/lib-stable/spawn'

  function run(cmd) {
    const r = spawnSync(cmd, [], { encoding: 'utf8' })
    return r.status === 0
  }
</good-fix>

<bad-fix description="What you must NOT do: rename the import without updating callsites.">
- import { spawnSync } from 'node:child_process'
+ import { spawn } from '@socketsecurity/lib-stable/spawn'

  function run(cmd) {
    const r = spawnSync(cmd, [], { encoding: 'utf8' })  // ❌ spawnSync is no longer imported — runtime ReferenceError
    return r.status === 0
  }
</bad-fix>

<good-fix description="Async caller; can switch to lib's async spawn AND update return-shape access.">
- import { spawnSync } from 'node:child_process'
+ import { spawn } from '@socketsecurity/lib-stable/spawn'

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
