/**
 * @file Shared foreign-linter detection — the single classifier consumed by
 *   the `no-other-linters-guard` hook (edit-time) and the
 *   `linters-are-oxlint-oxfmt-only` check (committed state). The fleet lints +
 *   formats with oxlint + oxfmt ONLY; foreign tools (ESLint, Prettier, Biome,
 *   dprint, rome) are blocked as configs and as package.json deps.
 *
 *   Host-test exemption: a package whose CODE TARGETS a foreign tool (e.g. an
 *   adapter that converts plugins into ESLint rules) legitimately needs that
 *   tool installed to integration-test against. Such a package declares the
 *   exemption explicitly in its package.json:
 *
 *     "fleet": { "hostTestDeps": ["eslint"] }
 *
 *   The allowance holds only while ALL of:
 *     1. the dep name is listed in `fleet.hostTestDeps` (exact match);
 *     2. the dep appears only in devDependencies / peerDependencies — a
 *        runtime `dependencies` / `optionalDependencies` entry ships the
 *        foreign tool to consumers and stays blocked;
 *     3. no package script invokes the tool's binary — running it makes it a
 *        lint/format gate, which is exactly what the fleet rule forbids.
 *   Foreign CONFIG FILES stay blocked unconditionally — host APIs used in
 *   tests (ESLint `RuleTester` / `Linter`, Babel programmatic transforms)
 *   need no config file.
 */

import path from 'node:path'

// One whole-basename pattern per foreign linter/formatter config file shape.
// One regex per tool (rather than a single mega-alternation) keeps each
// pattern simple to read and sidesteps alternation-ordering churn. Sorted by
// tool name.
export const CONFIG_FILE_PATTERNS: readonly RegExp[] = [
  // biome.json / biome.jsonc
  /^biome\.jsonc?$/,
  // .dprint.json / .dprint.jsonc
  /^\.dprint\.jsonc?$/,
  // .eslintrc, optionally with an extension (.eslintrc.json, .eslintrc.cjs, …)
  /^\.eslintrc(?:\.[a-z]+)?$/,
  // eslint.config.{c,m}{j,t}s
  /^eslint\.config\.[cm]?[jt]s$/,
  // .prettierrc, optionally with an extension
  /^\.prettierrc(?:\.[a-z]+)?$/,
  // prettier.config.{c,m}{j,t}s
  /^prettier\.config\.[cm]?[jt]s$/,
]

export interface ForeignDepAudit {
  /** Deps allowed under the `fleet.hostTestDeps` contract, sorted. */
  allowed: string[]
  /** Deps that violate the rule, sorted by name, each with the reason. */
  blocked: ForeignDepFinding[]
}

export interface ForeignDepFinding {
  name: string
  reason: string
}

/** Foreign config file by basename (biome.json, .eslintrc*, …). */
export function isForeignConfigFile(basename: string): boolean {
  return CONFIG_FILE_PATTERNS.some(pattern => pattern.test(basename))
}

// This function IS the foreign-linter detector; the tool names below are
// detection data, not config references, so each `no-eslint-biome-config-ref`
// match on a literal here is a false positive and is locally disabled.
export function isForeignToolPackage(name: string): boolean {
  if (
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data, not a config reference.
    name === '@biomejs/biome' ||
    name === 'dprint' ||
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data, not a config reference.
    name === 'eslint' ||
    name === 'prettier' ||
    name === 'rome'
  ) {
    return true
  }
  return (
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data, not a config reference.
    name.startsWith('@eslint/') ||
    name.startsWith('@typescript-eslint/') ||
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data, not a config reference.
    name.startsWith('eslint-config-') ||
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data, not a config reference.
    name.startsWith('eslint-plugin-') ||
    name.startsWith('prettier-plugin-') ||
    /^@[^/]+\/eslint-/.test(name)
  )
}

export function isVendoredUpstream(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/')
  return (
    // A path segment that is exactly one of the vendored-tree dir names,
    // anchored at start or a "/" on the left and "/" or end on the right.
    /(?:^|\/)(?:external|third_party|upstream|vendor)(?:\/|$)/.test(p) ||
    // A path segment ending in "-upstream" (e.g. "acorn-upstream/").
    /(?:^|\/)[^/]+-upstream(?:\/|$)/.test(p)
  )
}

/** CLI binary a foreign package family runs as (eslint-plugin-* → eslint). */
export function foreignToolBinary(name: string): string {
  if (name === '@biomejs/biome') {
    return 'biome'
  }
  if (name === 'dprint') {
    return 'dprint'
  }
  if (name === 'prettier' || name.startsWith('prettier-plugin-')) {
    return 'prettier'
  }
  if (name === 'rome') {
    return 'rome'
  }
  // Every remaining foreign family is ESLint-adjacent (@eslint/*,
  // @typescript-eslint/*, eslint-config-*, eslint-plugin-*, @<scope>/eslint-*).
  return 'eslint'
}

/**
 * Command words of a package.json script value: the head token of each
 * `&&` / `||` / `;` / `|` segment (after env-var assignments), plus the tool
 * token behind runner indirection (`npx eslint`, `pnpm exec eslint`). Words
 * are reduced to their basename so `node_modules/.bin/eslint` reads as
 * `eslint`. Bare arguments (file paths, test names) are NOT command words —
 * `vitest run to-eslint.test.ts` yields only `vitest`.
 */
export function commandWords(script: string): string[] {
  const words: string[] = []
  for (const segment of script.split(/&&|\|\||[;|]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    let i = 0
    // Skip leading VAR=value env assignments.
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
      i += 1
    }
    const head = tokens[i]
    if (!head) {
      continue
    }
    words.push(path.posix.basename(head))
    // Runner indirection — surface the executed tool as a command word too.
    const next = tokens[i + 1]
    if ((head === 'bunx' || head === 'npx' || head === 'yarn') && next && !next.startsWith('-')) {
      words.push(path.posix.basename(next))
    }
    const sub = tokens[i + 2]
    if (
      (head === 'bun' || head === 'npm' || head === 'pnpm') &&
      (next === 'dlx' || next === 'exec' || next === 'x') &&
      sub &&
      !sub.startsWith('-')
    ) {
      words.push(path.posix.basename(sub))
    }
  }
  return words
}

/**
 * Audit a package.json's text for foreign linter/formatter deps under the
 * `fleet.hostTestDeps` contract (see @file). Fails open: unparseable JSON
 * yields an empty audit (better to under-block than brick a non-JSON edit).
 */
export function auditForeignDeps(jsonText: string): ForeignDepAudit {
  const empty: ForeignDepAudit = { allowed: [], blocked: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object') {
    return empty
  }
  const pkg = parsed as Record<string, unknown>

  // name → dependency blocks it appears in.
  const blocksByName = new Map<string, string[]>()
  for (const block of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const deps = pkg[block]
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps as Record<string, unknown>)) {
        if (isForeignToolPackage(name)) {
          const existing = blocksByName.get(name)
          if (existing) {
            existing.push(block)
          } else {
            blocksByName.set(name, [block])
          }
        }
      }
    }
  }
  if (blocksByName.size === 0) {
    return empty
  }

  const fleet = pkg['fleet']
  const rawHostTestDeps =
    fleet && typeof fleet === 'object'
      ? (fleet as Record<string, unknown>)['hostTestDeps']
      : undefined
  const hostTestDeps = new Set(
    Array.isArray(rawHostTestDeps)
      ? rawHostTestDeps.filter((n): n is string => typeof n === 'string')
      : [],
  )

  const scripts =
    pkg['scripts'] && typeof pkg['scripts'] === 'object'
      ? (pkg['scripts'] as Record<string, unknown>)
      : {}

  const audit: ForeignDepAudit = { allowed: [], blocked: [] }
  for (const name of [...blocksByName.keys()].sort()) {
    if (!hostTestDeps.has(name)) {
      audit.blocked.push({
        name,
        reason: 'not listed in `fleet.hostTestDeps`',
      })
      continue
    }
    const runtimeBlocks = blocksByName
      .get(name)!
      .filter(b => b === 'dependencies' || b === 'optionalDependencies')
    if (runtimeBlocks.length > 0) {
      audit.blocked.push({
        name,
        reason: `listed in \`fleet.hostTestDeps\` but declared in \`${runtimeBlocks.join('`, `')}\` — host-test deps may only live in devDependencies/peerDependencies`,
      })
      continue
    }
    const binary = foreignToolBinary(name)
    const invokingScript = Object.entries(scripts).find(
      ([, value]) =>
        typeof value === 'string' && commandWords(value).includes(binary),
    )
    if (invokingScript) {
      audit.blocked.push({
        name,
        reason: `listed in \`fleet.hostTestDeps\` but script \`${invokingScript[0]}\` invokes \`${binary}\` — a host-test dep must not run as a lint/format gate`,
      })
      continue
    }
    audit.allowed.push(name)
  }
  return audit
}
