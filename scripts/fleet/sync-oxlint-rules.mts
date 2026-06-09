#!/usr/bin/env node
/**
 * @file Single source of truth for wiring fleet `socket/*` oxlint rules. The
 *   rule FILES in `.config/fleet/oxlint-plugin/rules/*.mts` are the canonical
 *   inventory; everything that references a rule by id is derived from them:
 *
 *   1. `.config/fleet/oxlint-plugin/index.mts` — the plugin's import list +
 *      `rules: {}` registry. Every rule file gets a camelCase default import
 *      and a kebab-id registry entry; both blocks are sorted by rule id. Only
 *      those two regions are rewritten — the file's `@file` doc, the `@type`
 *      JSDoc, the `meta` block, and `export default plugin` are left
 *      byte-for-byte.
 *   2. `.config/fleet/oxlintrc.json` — the top-level `rules` block. Every rule
 *      file gets a `socket/<id>: "error"` activation. Activations for rules no
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
 *     `test/<id>.test.mts` is reported (it's a coverage gap the author must
 *     fill); the body can't be auto-written. `--check` treats a missing test as
 *     a failure so the triad (rule file + registration + test) stays complete.
 *     Underscore-prefixed files (`_inject-import.mts`) are private helpers, not
 *     rules — excluded from every derivation. Why a generator instead of
 *     hand-editing three places: rules drifted — a rule file was present +
 *     imported but never activated in oxlintrc, so it sat silently dormant
 *     fleet-wide. Deriving the wiring from the file inventory makes "add a rule
 *     file" the only manual step.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from './paths.mts'

const PLUGIN_DIR = path.join(REPO_ROOT, '.config', 'fleet', 'oxlint-plugin')
const RULES_DIR = path.join(PLUGIN_DIR, 'rules')
const TEST_DIR = path.join(PLUGIN_DIR, 'test')
const INDEX_PATH = path.join(PLUGIN_DIR, 'index.mts')
const OXLINTRC_PATH = path.join(REPO_ROOT, '.config', 'fleet', 'oxlintrc.json')

const SOCKET_PREFIX = 'socket/'

// Rules deliberately registered in the plugin but NOT activated at `error` in
// oxlintrc's top-level `rules` block. Keyed by rule id with a one-line reason
// so the generator skips activation without flagging drift. (Per-PATH disables
// live in oxlintrc's `overrides`, which this generator never touches.) Empty
// today — every rule file is active fleet-wide. Add an entry (id → reason) to
// intentionally hold a rule dormant, e.g. one that depends on an oxlint engine
// feature not yet available at the catalog-pinned version.
const DORMANT_RULES: Readonly<Record<string, string>> = Object.assign(
  Object.create(null),
  {},
) as Record<string, string>

/**
 * Kebab-case rule id → camelCase import identifier.
 */
function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())
}

/**
 * Every rule id under rules/ (kebab-case, no `_`-prefixed helpers), sorted.
 */
function ruleIds(): string[] {
  return readdirSync(RULES_DIR)
    .filter(f => f.endsWith('.mts') && !f.startsWith('_'))
    .map(f => f.slice(0, -'.mts'.length))
    .toSorted()
}

/**
 * Rule ids missing a `test/<id>.test.mts`.
 */
function rulesMissingTests(ids: readonly string[]): string[] {
  return ids.filter(id => !existsSync(path.join(TEST_DIR, `${id}.test.mts`)))
}

/**
 * Replace the import run + `rules: {}` registry body in index.mts with blocks
 * derived from `ids`, leaving everything else untouched. Returns the new file
 * text, or the input unchanged if the regions can't be located (caller treats
 * an unchanged result as "no drift").
 */
function rewriteIndex(source: string, ids: readonly string[]): string {
  // -- import run: the contiguous block of `import X from './rules/...'`
  // lines. Find first and last; replace the span between them (inclusive).
  const lines = source.split('\n')
  const isRuleImport = (l: string): boolean =>
    /^import\s+\w+\s+from\s+'\.\/rules\//.test(l)
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
    id => `import ${toCamel(id)} from './rules/${id}.mts'`,
  )
  const withImports = [
    ...lines.slice(0, firstImport),
    ...importBlock,
    ...lines.slice(lastImport + 1),
  ].join('\n')

  // -- registry body: between `rules: {` and its matching `},`. Capture the
  // indentation of the first entry so the regenerated body matches.
  const registryEntries = ids
    .map(id => `    '${id}': ${toCamel(id)},`)
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
function rewriteOxlintrc(source: string, ids: readonly string[]): string {
  const active = ids.filter(id => !(id in DORMANT_RULES)).toSorted()
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
  // Match each socket/* line WITHIN the top-level rules block only. The fleet
  // keeps socket activations single-line, so detect by leading `"socket/`.
  const socketLineIdx: number[] = []
  for (let i = rulesOpenIdx + 1; i < rulesCloseIdx; i += 1) {
    if (lines[i]!.trimStart().startsWith(`"${SOCKET_PREFIX}`)) {
      socketLineIdx.push(i)
    }
  }
  if (socketLineIdx.length === 0) {
    throw new Error(
      'sync-oxlint-rules: no socket/* activations found in oxlintrc.json `rules` block',
    )
  }
  const firstSocket = socketLineIdx[0]!
  const lastSocket = socketLineIdx[socketLineIdx.length - 1]!
  // Guard: the socket lines must be contiguous (no interleaved foreign rules).
  // If a non-socket rule sneaked into the run, bail loudly rather than corrupt.
  for (let i = firstSocket; i <= lastSocket; i += 1) {
    if (!lines[i]!.trimStart().startsWith(`"${SOCKET_PREFIX}`)) {
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

function main(): number {
  const check = process.argv.includes('--check')
  const ids = ruleIds()

  let drift = false
  const problems: string[] = []

  // 1. index.mts
  if (existsSync(INDEX_PATH)) {
    const current = readFileSync(INDEX_PATH, 'utf8')
    const next = rewriteIndex(current, ids)
    if (current !== next) {
      drift = true
      if (check) {
        problems.push(
          '.config/fleet/oxlint-plugin/index.mts is out of sync with rules/. Run `pnpm run sync-oxlint-rules`.',
        )
      } else {
        writeFileSync(INDEX_PATH, next)
      }
    }
  }

  // 2. oxlintrc.json activations
  if (existsSync(OXLINTRC_PATH)) {
    const current = readFileSync(OXLINTRC_PATH, 'utf8')
    const next = rewriteOxlintrc(current, ids)
    if (current !== next) {
      drift = true
      if (check) {
        problems.push(
          '.config/fleet/oxlintrc.json socket/* activations are out of sync with rules/. Run `pnpm run sync-oxlint-rules`.',
        )
      } else {
        writeFileSync(OXLINTRC_PATH, next)
      }
    }
  }

  // 3. test coverage (reported, never auto-written)
  const missingTests = rulesMissingTests(ids)
  for (const id of missingTests) {
    problems.push(
      `rule '${id}' has no test/${id}.test.mts — add one (the triad rule file + registration + test must be complete).`,
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

process.exitCode = main()
