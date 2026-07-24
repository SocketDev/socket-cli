#!/usr/bin/env node
/*
 * @file Single source of truth for wiring fleet `socket/*` oxlint rules. Each
 *   rule is its own directory `.config/fleet/oxlint-plugin/fleet/<id>/` (holding
 *   `index.mts` + `package.json` + `test/<id>.test.mts`, mirroring
 *   `.claude/hooks/fleet/<name>/`); that dir inventory is canonical and
 *   everything that references a rule by id is derived from it:
 *
 *   1. `.config/fleet/oxlint-plugin/index.mts` — the plugin's import list + `rules: {}`
 *      registry. Every rule dir gets a camelCase default import
 *      (`./fleet/<id>/index.mts`) and a kebab-id registry entry; both blocks
 *      are sorted by rule id. Only those two regions are rewritten — the file's
 *      `@file` doc, the `@type` JSDoc, the `meta` block, and `export default
 *      plugin` are left byte-for-byte.
 *   2. `.config/fleet/oxlintrc.json` — the top-level `rules` block. Every rule
 *      gets a `socket/<id>: "error"` activation. Activations for rules no
 *      longer present are dropped. Non-socket rules, the `overrides` block
 *      (which carries intentional per-path socket disables), `ignorePatterns`,
 *      and existing key ordering are all preserved — missing socket rules are
 *      spliced into the existing run of socket rules, alpha-sorted among
 *      themselves, and nothing else moves. Run modes:
 *
 *   - default (write): edit index.mts + oxlintrc.json in place.
 *   - `--check`: exit non-zero if either would change (no write). Used by the
 *     pre-commit hook + sync-scaffolding so a half-wired rule can't land. What
 *     this does NOT generate: per-rule test files. A rule without a
 *     `test/repo/{unit,integration}/lint-rules/<id>.test.mts` is reported (it's a coverage gap the
 *     author must fill); the body can't be auto-written. `--check` treats a
 *     missing test as a failure so the triad (rule + registration + test) stays
 *     complete. Underscore-prefixed dirs are private helpers, not rules —
 *     excluded from every derivation. Why a generator instead of hand-editing
 *     three places: rules drifted — a rule was present + imported but never
 *     activated in oxlintrc, so it sat silently dormant fleet-wide. Deriving
 *     the wiring from the dir inventory makes "add a rule dir" the only manual
 *     step.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// prefer-async-spawn: sync-required — this is a sequential CLI generator that
// formats its output inline before the drift comparison; no concurrency.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { LINT_RULE_TEST_DIRS, REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const PLUGIN_DIR = path.join(REPO_ROOT, '.config', 'fleet', 'oxlint-plugin')
// Each rule is its own dir under the cascaded `fleet/` tier (mirrors
// .claude/hooks/fleet/<name>/): fleet/<id>/index.mts + fleet/<id>/test/.
const FLEET_RULES_DIR = path.join(PLUGIN_DIR, 'fleet')
const INDEX_PATH = path.join(PLUGIN_DIR, 'index.mts')
const OXLINTRC_PATH = path.join(REPO_ROOT, '.config', 'fleet', 'oxlintrc.json')
// The TEMPLATE-canonical mirrors of the two generated files. The wheelhouse
// dogfoods its own output, so `.config/fleet/` is a dir-mirror: template/base/
// is the source, the live tree is a copy. Both must carry the same rule
// registration — the RuleTester imports the TEMPLATE plugin index (its
// PLUGIN_INDEX resolves under template/base/), so a rule registered only in the
// live index is an UNKNOWN rule to the test → 0 findings (this misdiagnosed
// #198). Reconcile both here so template never lags live. Wheelhouse-only:
// members have no template/base/, so these paths simply don't exist there.
const TEMPLATE_INDEX_PATH = path.join(
  REPO_ROOT,
  'template',
  'base',
  '.config',
  'fleet',
  'oxlint-plugin',
  'index.mts',
)
const TEMPLATE_OXLINTRC_PATH = path.join(
  REPO_ROOT,
  'template',
  'base',
  '.config',
  'fleet',
  'oxlintrc.json',
)
const SOCKET_PREFIX = 'socket/'

// Run a generated source string through the format wrapper's pipe mode
// (stdin → stdout) so the regenerated text matches the committed,
// oxfmt-formatted style. Without this, the generator's own line-wrapping
// differs from oxfmt's, so a freshly regenerated index.mts/oxlintrc.json
// reports as drift on every run even when no rule changed (and a write
// commits a 100+-line reformat). Applied to BOTH the write path and the
// `--check` comparison so the two never diverge. Routed through
// `pnpm run format --stdin-filepath=<name>` — the package.json script owns
// the binary + config; no bare oxfmt invocation. `filename` only tells the
// parser which grammar to use (.mts vs .json); the file isn't read. Returns
// the input unchanged on any failure, so a broken formatter degrades to the
// prior (unformatted) behavior rather than crashing the sync.
function formatViaOxfmt(source: string, filename: string): string {
  const result = spawnSync(
    'pnpm',
    ['run', '--silent', 'format', `--stdin-filepath=${filename}`],
    { cwd: REPO_ROOT, input: source, encoding: 'utf8' },
  )
  // Wrapper layers (pnpm's `> script` banner, the Socket Firewall shim's
  // "Protected by …" header and "=== Socket Firewall ===" trailer) write
  // noise to the SAME stdout stream as the formatted text, on both ends —
  // strip known banner lines so they can never be written into a
  // regenerated source file.
  const BANNER_LINE_RE =
    /^(?:=+ *Socket Firewall *=+.*|>.*|Protected by Socket Firewall.*|\$ .*)$/
  const formatted = String(result.stdout ?? '')
    .split('\n')
    .filter(line => !BANNER_LINE_RE.test(line))
    .join('\n')
  if (result.status !== 0 || !formatted) {
    return source
  }
  // oxfmt's stdin mode omits the trailing newline that its file mode (and the
  // committed files) keep; normalize to exactly one so the formatted output
  // matches on-disk style instead of introducing a no-final-newline drift.
  return `${formatted.replace(/\n+$/, '')}\n`
}

// Rules deliberately registered in the plugin but NOT activated at `error` in
// oxlintrc's top-level `rules` block. Keyed by rule id with a one-line reason
// so the generator skips activation without flagging drift. (Per-PATH disables
// live in oxlintrc's `overrides`, which this generator never touches.) Empty
// today — every rule file is active fleet-wide. Add an entry (id → reason) to
// intentionally hold a rule dormant, e.g. one that depends on an oxlint engine
// feature not yet available at the catalog-pinned version.
const DORMANT_RULES: Readonly<Record<string, string>> = Object.assign(
  Object.create(null),
  {
    'no-lib-barrel-import':
      'gated until the fleet-wide @socketsecurity/lib[-stable]/errors → /errors/message migration completes; activating at error now red-walls the unmigrated fleet repos (~967 sites). Flip active per-repo after each migrates.',
  },
) as Record<string, string>

/**
 * Kebab-case rule id → camelCase import identifier.
 */
function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())
}

/**
 * Every rule id under fleet/ (a rule = a dir holding index.mts; kebab-case, no
 * `_`-prefixed helper dirs), sorted.
 */
function ruleIds(): string[] {
  return (
    readdirSync(FLEET_RULES_DIR, { withFileTypes: true })
      .filter(
        d =>
          d.isDirectory() &&
          !d.name.startsWith('_') &&
          existsSync(path.join(FLEET_RULES_DIR, d.name, 'index.mts')),
      )
      .map(d => d.name)
      // oxlint-disable-next-line unicorn/no-array-sort -- .map() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
      .sort()
  )
}

/**
 * Rule ids whose test is missing from the relocated home
 * `test/repo/{unit,integration}/lint-rules/<id>.test.mts`. Lint-rule tests are
 * NOT co-located in the cascaded `fleet/<id>/test/` tree (they would ship to
 * members as dead weight the member vitest config excludes); they live under
 * `test/repo/` and run as vitest. See docs/agents.md/fleet/test-layout.md.
 *
 * Those tests are WHEELHOUSE-ONLY (never cascaded). In a member repo the rules
 * are present but their tests live upstream — so only the wheelhouse (which
 * owns `template/base/`) asserts test presence; a member always returns [].
 */
function rulesMissingTests(ids: readonly string[]): string[] {
  if (!existsSync(path.join(REPO_ROOT, 'template', 'base'))) {
    return []
  }
  return ids.filter(
    id =>
      !LINT_RULE_TEST_DIRS.some(dir =>
        existsSync(path.join(dir, `${id}.test.mts`)),
      ),
  )
}

/**
 * Replace the import run + `rules: {}` registry body in index.mts with blocks
 * derived from `ids`, leaving everything else untouched. Returns the new file
 * text, or the input unchanged if the regions can't be located (caller treats
 * an unchanged result as "no drift").
 */
function rewriteIndex(source: string, ids: readonly string[]): string {
  // -- import run: the contiguous block of `import X from './fleet/<id>/index.mts'`
  // lines. Find first and last; replace the span between them (inclusive).
  const lines = source.split('\n')
  const isRuleImport = (l: string): boolean =>
    /^import\s+\w+\s+from\s+'\.\/fleet\//.test(l)
  const firstImport = lines.findIndex(isRuleImport)
  let lastImport = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isRuleImport(lines[i]!)) {
      lastImport = i
      break
    }
  }
  if (firstImport === -1 || lastImport === -1) {
    return source
  }
  const importBlock = ids.map(
    id => `import ${toCamel(id)} from './fleet/${id}/index.mts'`,
  )
  const withImports = [
    ...lines.slice(0, firstImport),
    ...importBlock,
    ...lines.slice(lastImport + 1),
  ].join('\n')

  // -- registry body: between `rules: {` and its matching `},`. Each entry is
  // `    '<id>': <camel>,` (4-space indent inside the `rules: {` block). oxfmt
  // (printWidth 80) wraps an entry that would exceed the width onto two lines —
  // the value drops to a 6-space-indented continuation. Match that wrap here so
  // the generator's output is oxfmt-stable (otherwise the generator unwraps and
  // oxfmt rewraps every run, and both --check gates can't pass at once).
  const registryEntries = ids
    .map(id => {
      const oneLine = `    '${id}': ${toCamel(id)},`
      if (oneLine.length <= 80) {
        return oneLine
      }
      return `    '${id}':\n      ${toCamel(id)},`
    })
    .join('\n')
  return withImports.replace(
    // Splice the rules block: capture group 1 = `\n<indent>rules: {\n` (opening brace line);
    // `[\s\S]*?` = lazy-any — skips existing entries non-greedily;
    // capture group 2 = `\n<indent>},\n` (closing brace line with trailing newline).
    // Both captured delimiters are re-emitted verbatim; only the body between them is replaced.
    /(\n\s*rules:\s*\{\n)[\s\S]*?(\n\s*\},\n)/,
    (_m, open: string, close: string) => `${open}${registryEntries}${close}`,
  )
}

/**
 * Reconcile the socket/* activations in oxlintrc's top-level `rules` block
 * against `ids`, by string-splicing so non-socket rules, ordering, and the rest
 * of the JSON stay byte-identical. The socket rules occupy a contiguous run
 * (they sort before eslint/import/typescript/unicorn); we replace that run with
 * the desired sorted set. Returns the new file text. Throws if the rules block
 * or socket run can't be located (a structural assumption broke).
 */
export function rewriteOxlintrc(
  source: string,
  ids: readonly string[],
): string {
  // oxlint-disable-next-line unicorn/no-array-sort -- .filter() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  const active = ids.filter(id => !(id in DORMANT_RULES)).sort()
  // Parse to recover any array-form (rule + options) configs we must preserve
  // verbatim rather than flatten to "error".
  const parsed = JSON.parse(source) as {
    rules?: Record<string, unknown> | undefined
  }
  const existing = parsed.rules ?? {}

  // Socket rule ids appear in TWO places: the top-level `rules` block
  // (activations we manage) and the `overrides[].rules` blocks (intentional
  // per-path disables we must never touch). Scope the splice to the top-level
  // `rules` object by brace-matching from its opening line to its close.
  const lines = source.split('\n')
  const rulesOpenIdx = lines.findIndex(l => /^\s{2}"rules":\s*\{\s*$/.test(l))
  if (rulesOpenIdx === -1) {
    throw new Error(
      'sync-oxlint-rules: top-level `rules` block not found in oxlintrc.json',
    )
  }
  let depth = 0
  let rulesCloseIdx = -1
  for (let i = rulesOpenIdx; i < lines.length; i += 1) {
    for (const ch of lines[i]!) {
      if (ch === '{') {
        depth += 1
      } else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          rulesCloseIdx = i
          break
        }
      }
    }
    if (rulesCloseIdx !== -1) {
      break
    }
  }
  if (rulesCloseIdx === -1) {
    throw new Error(
      'sync-oxlint-rules: could not find end of top-level `rules` block in oxlintrc.json',
    )
  }
  // Match each socket/* activation WITHIN the top-level rules block only. An
  // activation with an options array spans multiple lines once oxfmt wraps it
  // (`"socket/x": ["error", {…}]` → 4 lines), so after a `"socket/` opener,
  // consume continuation lines until the entry's brackets balance and claim
  // the whole span as socket-owned.
  const countEntryDepth = (line: string, depthIn: number): number => {
    let d = depthIn
    for (const ch of line) {
      if (ch === '[' || ch === '{') {
        d += 1
      } else if (ch === ']' || ch === '}') {
        d -= 1
      }
    }
    return d
  }
  const socketLineIdx: number[] = []
  for (let i = rulesOpenIdx + 1; i < rulesCloseIdx; i += 1) {
    if (!lines[i]!.trimStart().startsWith(`"${SOCKET_PREFIX}`)) {
      continue
    }
    socketLineIdx.push(i)
    let entryDepth = countEntryDepth(lines[i]!, 0)
    while (entryDepth > 0 && i + 1 < rulesCloseIdx) {
      i += 1
      socketLineIdx.push(i)
      entryDepth = countEntryDepth(lines[i]!, entryDepth)
    }
  }
  if (socketLineIdx.length === 0) {
    throw new Error(
      'sync-oxlint-rules: no socket/* activations found in oxlintrc.json `rules` block',
    )
  }
  const firstSocket = socketLineIdx[0]!
  const lastSocket = socketLineIdx[socketLineIdx.length - 1]!
  // Guard: the socket spans must be contiguous (no interleaved foreign rules).
  // If a non-socket rule sneaked into the run, bail loudly rather than corrupt.
  const socketLineSet = new Set(socketLineIdx)
  for (let i = firstSocket; i <= lastSocket; i += 1) {
    if (!socketLineSet.has(i)) {
      throw new Error(
        'sync-oxlint-rules: socket/* activations are not contiguous in oxlintrc.json; refusing to splice',
      )
    }
  }
  const indent = lines[firstSocket]!.match(/^\s*/)?.[0] ?? '    '

  const renderValue = (val: unknown): string =>
    JSON.stringify(val === undefined ? 'error' : val)

  const newSocketLines = active.map(id => {
    const key = `${SOCKET_PREFIX}${id}`
    const prev = existing[key]
    const value = Array.isArray(prev) ? prev : 'error'
    return `${indent}${JSON.stringify(key)}: ${renderValue(value)},`
  })

  return [
    ...lines.slice(0, firstSocket),
    ...newSocketLines,
    ...lines.slice(lastSocket + 1),
  ].join('\n')
}

interface ReconcileResult {
  readonly drifted: boolean
  readonly problem: string | undefined
}

// Regenerate one generated file (index.mts or oxlintrc.json) from the current
// rule ids. In --check mode reports drift without writing; otherwise writes.
// A non-existent path (e.g. the template mirror in a member repo) is a no-op.
// A `cascadeOwned` target (the LIVE copy of a cascaded mirror, chmod'd
// read-only by mirror-mode) is never written directly — the template write is
// the canonical edit and the next cascade propagates it, so a drifted live
// copy just reports drift for the cascade to fix.
function reconcileGenerated(config: {
  readonly cascadeOwned?: boolean | undefined
  readonly filePath: string
  readonly ids: readonly string[]
  readonly rewrite: (source: string, ids: readonly string[]) => string
  readonly oxfmtName: string
  readonly label: string
  readonly check: boolean
}): ReconcileResult {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!existsSync(cfg.filePath)) {
    return { drifted: false, problem: undefined }
  }
  const current = readFileSync(cfg.filePath, 'utf8')
  const next = formatViaOxfmt(cfg.rewrite(current, cfg.ids), cfg.oxfmtName)
  if (current === next) {
    return { drifted: false, problem: undefined }
  }
  if (cfg.check) {
    return {
      drifted: true,
      problem: `${cfg.label} is out of sync with the plugin fleet/ rules. Run \`pnpm run sync-oxlint-rules\`.`,
    }
  }
  if (cfg.cascadeOwned) {
    process.stdout.write(
      `[sync-oxlint-rules] ${cfg.label} drifted — live mirror is cascade-owned; the template write lands it on the next cascade.\n`,
    )
    return { drifted: true, problem: undefined }
  }
  writeFileSync(cfg.filePath, next)
  return { drifted: true, problem: undefined }
}

function main(): number {
  const check = process.argv.includes('--check')
  const ids = ruleIds()

  let drift = false
  const problems: string[] = []

  // 1+2. index.mts + oxlintrc.json — LIVE and (wheelhouse-only) the TEMPLATE
  // mirror. Template must track live so the RuleTester (which imports the
  // template plugin index) sees every registered rule; see #198 / the
  // oxlint-ruletester-reads-template-index memory.
  const targets = [
    {
      cascadeOwned: true,
      filePath: INDEX_PATH,
      rewrite: rewriteIndex,
      oxfmtName: 'index.mts',
      label: '.config/fleet/oxlint-plugin/index.mts',
    },
    {
      cascadeOwned: true,
      filePath: OXLINTRC_PATH,
      rewrite: rewriteOxlintrc,
      oxfmtName: 'oxlintrc.json',
      label: '.config/fleet/oxlintrc.json',
    },
    {
      filePath: TEMPLATE_INDEX_PATH,
      rewrite: rewriteIndex,
      oxfmtName: 'index.mts',
      label: 'template/base/.config/fleet/oxlint-plugin/index.mts',
    },
    {
      filePath: TEMPLATE_OXLINTRC_PATH,
      rewrite: rewriteOxlintrc,
      oxfmtName: 'oxlintrc.json',
      label: 'template/base/.config/fleet/oxlintrc.json',
    },
  ]
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    const result = reconcileGenerated({ ...target, check, ids })
    if (result.drifted) {
      drift = true
    }
    if (result.problem) {
      problems.push(result.problem)
    }
  }

  // 3. test coverage (reported, never auto-written)
  const missingTests = rulesMissingTests(ids)
  for (const id of missingTests) {
    problems.push(
      `rule '${id}' has no test/repo/{unit,integration}/lint-rules/${id}.test.mts — add one (the triad rule + registration + test must be complete; lint-rule tests live in test/repo/, never co-located).`,
    )
  }

  if (check) {
    if (problems.length > 0) {
      process.stderr.write(
        `[sync-oxlint-rules] ${problems.length} issue(s):\n${problems
          .map(p => `  - ${p}`)
          .join('\n')}\n`,
      )
      return 1
    }
    process.stdout.write('[sync-oxlint-rules] rule wiring is in sync.\n')
    return 0
  }

  process.stdout.write(
    drift
      ? '[sync-oxlint-rules] regenerated rule wiring.\n'
      : '[sync-oxlint-rules] no changes.\n',
  )
  if (missingTests.length > 0) {
    // Missing tests are a coverage gap; surface but don't fail the write path
    // (the author may be mid-adding the rule). `--check` fails on them.
    process.stderr.write(
      `[sync-oxlint-rules] WARNING — ${missingTests.length} rule(s) missing a test:\n${missingTests
        .map(id => `  - ${id}`)
        .join('\n')}\n`,
    )
  }
  return 0
}

const invokedDirectly = isMainModule(import.meta.url)
if (invokedDirectly) {
  process.exitCode = main()
}
