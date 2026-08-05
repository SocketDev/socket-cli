#!/usr/bin/env node
/*
 * @file A test that targets a cascaded dir-mirror source must import the
 *   CANONICAL copy under `template/base/**`, not the live mirror.
 *   docs/agents.md/fleet/test-layout.md already says so; this is the missing
 *   enforcement half.
 *
 *   WHY IT MATTERS. The live tree is a mirror that only changes when a cascade
 *   runs, so a test importing it reads the PREVIOUS revision of the thing under
 *   test. Add an export to `template/base/...` and its test fails against the
 *   mirror that lacks it — and the failure is indistinguishable from a real
 *   defect. Worse, it deadlocks: the commit is blocked by the red test, the
 *   test is red because the mirror is stale, the mirror is stale because the
 *   cascade refuses while the template source is uncommitted, and the source is
 *   uncommitted because the commit is blocked. The only exits are a bypass or
 *   another actor landing first.
 *
 *   Importing the canonical copy removes the cycle: a new export is testable in
 *   the same commit that adds it.
 *
 *   REPORT-ONLY (exit 0). Enforcing today would fail every member on the first
 *   run, which trains people to bypass the gate rather than fix the imports.
 *
 *   `--fix` IS NOT A BULK SWEEP. Rewriting the import is mechanical; making the
 *   test still pass afterwards is not. A 398-file run proved three ways:
 *
 *   1. A `vi.mock('<mirror path>')` target is a plain string this matcher
 *      cannot see. Rewriting the import while the mock still names the mirror
 *      leaves the mock silently inert — the test then exercises real code and
 *      fails somewhere unrelated.
 *   2. Canonical and mirror are DISTINCT MODULE INSTANCES even when the files
 *      are byte-identical. `rules.test.mts` passes importing the mirror and
 *      fails importing the canonical copy, with no diff between the two
 *      sources: anything carrying module-level state, or comparing identity
 *      across modules, changes behaviour under the rewrite.
 *   3. An earlier unanchored matcher rewrote import-shaped FIXTURE STRINGS.
 *      That specific hole is closed (see IMPORT_FROM_RE), but it is the same
 *      family: a path in this tree is not always an import.
 *
 *   So `--fix` is a per-file assist — run it on one file, read the diff, run
 *   that file's test. Migrating a repo is a review exercise, and ENFORCING
 *   flips only once a repo has actually finished one.
 *
 *   Exit codes:
 *
 *   - 0 — no findings, or findings while ENFORCING is off
 *   - 1 — findings AND ENFORCING is on
 */

import { readFileSync } from 'node:fs'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { TEMPLATE_PAYLOAD_DIRS } from '../_shared/template-payload-scope.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Flip once a repo's test tree is clean. See the header.
const ENFORCING = false

// The canonical tier every mirror root hangs off.
const CANONICAL_PREFIX = 'template/base/'

/**
 * The live-mirror roots, derived from the one list that already names the
 * cascaded payload dirs rather than restating them.
 *
 * `TEMPLATE_PAYLOAD_DIRS` holds the canonical paths (`template/base/scripts/
 * fleet`); stripping the prefix yields the mirror path a test must NOT import
 * (`scripts/fleet`). Deriving both from one constant is what keeps a newly
 * cascaded dir from silently escaping this check.
 */
export function mirrorRoots(): string[] {
  const out: string[] = []
  for (let i = 0, { length } = TEMPLATE_PAYLOAD_DIRS; i < length; i += 1) {
    const dir = TEMPLATE_PAYLOAD_DIRS[i]!
    if (dir.startsWith(CANONICAL_PREFIX)) {
      out.push(dir.slice(CANONICAL_PREFIX.length))
    }
  }
  return out
}

/**
 * The canonical specifier for a relative import of a mirror source, or
 * undefined when the specifier is already canonical or targets no mirror.
 *
 * Only a purely-relative specifier is rewritten. The `../` run stays untouched
 * because both paths resolve from the same test file — inserting the canonical
 * tier after the run lands on `template/base/<root>/…` from any test depth.
 */
export function canonicalizeMirrorImport(
  specifier: string,
): string | undefined {
  // `^((?:\.\./)+)` the leading parent-dir run, captured so it is preserved
  // verbatim; `(.+)$` the remainder, which is matched against the mirror roots.
  const m = /^((?:\.\.\/)+)(.+)$/.exec(specifier)
  if (!m) {
    return undefined
  }
  const up = m[1]!
  const rest = m[2]!
  if (rest.startsWith(CANONICAL_PREFIX)) {
    return undefined
  }
  const roots = mirrorRoots()
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = roots[i]!
    if (rest === root || rest.startsWith(`${root}/`)) {
      return `${up}${CANONICAL_PREFIX}${rest}`
    }
  }
  return undefined
}

export interface MirrorImportFinding {
  readonly canonical: string
  readonly line: number
  readonly specifier: string
}

// A static `import`/`export … from '<spec>'`, ANCHORED to the start of the
// line. The anchor is load-bearing: this check's own test holds import-shaped
// strings as FIXTURES, and an unanchored match rewrote those too — silently
// turning each fixture into an already-canonical input so the test asserted
// nothing. A real statement opens the line with `import`/`export`; a fixture
// opens with a quote, a `const`, or an array indent.
// Single-quoted specifiers only: the repo formatter normalizes to single
// quotes, so a double-quoted one is a format finding, not this check's
// business.
const IMPORT_FROM_RE = /^\s*(?:export|import)\b.*?\sfrom\s+'([^']+)'/

/**
 * Every mirror-targeting import in one test file's source.
 */
export function findMirrorImports(source: string): MirrorImportFinding[] {
  const out: MirrorImportFinding[] = []
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = IMPORT_FROM_RE.exec(lines[i]!)
    if (!m) {
      continue
    }
    const specifier = m[1]!
    const canonical = canonicalizeMirrorImport(specifier)
    if (canonical !== undefined) {
      out.push({ canonical, line: i + 1, specifier })
    }
  }
  return out
}

/**
 * Rewrite every mirror import in `source`. Returns the source unchanged when
 * there is nothing to rewrite, so a caller can skip the write.
 */
export function rewriteMirrorImports(source: string): string {
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const m = IMPORT_FROM_RE.exec(line)
    if (!m) {
      continue
    }
    const specifier = m[1]!
    const canonical = canonicalizeMirrorImport(specifier)
    if (canonical !== undefined) {
      lines[i] = line.replace(`'${specifier}'`, `'${canonical}'`)
    }
  }
  return lines.join('\n')
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { fix: { type: 'boolean' } },
    strict: true,
  })
  const { glob } = await import('node:fs/promises')
  const files: string[] = []
  for await (const entry of glob('test/**/*.test.mts')) {
    files.push(entry)
  }
  files.sort()
  let findingCount = 0
  let fixedCount = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const source = readFileSync(file, 'utf8')
    const findings = findMirrorImports(source)
    if (!findings.length) {
      continue
    }
    findingCount += findings.length
    if (values['fix'] === true) {
      writeThroughMirrorLock(file, rewriteMirrorImports(source))
      fixedCount += findings.length
      continue
    }
    for (let j = 0, jl = findings.length; j < jl; j += 1) {
      const finding = findings[j]!
      logger.warn(`  ${file}:${String(finding.line)} ${finding.specifier}`)
    }
  }
  if (values['fix'] === true) {
    logger.info(
      `[tests-read-canonical-sources] rewrote ${String(fixedCount)} import(s).`,
    )
    return 0
  }
  if (findingCount === 0) {
    logger.info(
      '[tests-read-canonical-sources] every test reads the canonical source.',
    )
    return 0
  }
  logger.warn(
    `\n[tests-read-canonical-sources] ${String(findingCount)} test import(s) read a cascaded mirror.\n` +
      '  Where: the paths above.\n' +
      '  Saw:   an import of the live mirror, which lags template/base until a\n' +
      '         cascade runs — so a new export reads as a test failure.\n' +
      '  Fix:   --fix rewrites the import, but check the file after: a\n' +
      '         vi.mock() naming the mirror must move with it, and a module\n' +
      '         holding state behaves differently under the canonical path.\n' +
      '         Run it per file, then that file\u2019s test.\n',
  )
  return ENFORCING ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks tests of cascaded mirror sources import the canonical template/base copy',
  help: `Usage: node scripts/fleet/check/tests-read-canonical-sources.mts [flags]
  --fix  rewrite mirror imports to the canonical path`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
