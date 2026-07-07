// Fleet check (ADVISORY) — surface dead exports in the _shared/ hook layer.
//
// The fleet's hooks DRY their common logic into
// `.claude/hooks/fleet/_shared/*.mts` (payload parsing, transcript reading,
// shell-command AST, stop-nudge scaffold, …). The whole point is reuse: a
// helper that no hook imports is dead weight in the shared layer — it inflates
// the cascade, invites copy-paste drift ("there are two normalizers now"), and
// rots untested. This check REPORTS each `_shared/` export that NO in-repo
// consumer references, as a DRY signal for a human to confirm + remove.
//
// ADVISORY, never blocks (exit 0). Two reasons it must not be a hard gate:
//   1. Some _shared exports are consumed OUT OF REPO — the user-global
//      `~/.claude/hooks/wheelhouse-dispatch.mts` imports `wheelhouse-root.mts`.
//      That consumer is machine-local; the scan can't see it, so a hard fail
//      would be a false positive.
//   2. Removing a shared export is a judgment call (a categorized token-pattern
//      API may be intentionally broad). The fleet's DRY sweep is plan-only.
//
// Consumers scanned: every fleet hook `index.mts`, every OTHER `_shared/*.mts`
// (helpers compose), and the shared test files. A symbol counts as used if its
// name appears (as a word) anywhere in a consumer — not only in an `import {}`
// line — so a type used purely in an annotation, or a re-export, still counts.
// That biases toward false-NEGATIVES, the safe bias: it never names a live
// helper, only the orphaned ones.
//
// Usage: node scripts/fleet/check/shared-hook-helpers-are-used.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  HOOK_TEST_DIRS,
  LINT_RULE_TEST_DIRS,
  REPO_ROOT,
  TEST_REPO_DIR,
} from '../paths.mts'

const logger = getDefaultLogger()

const FLEET_HOOKS_DIR = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')
const SHARED_DIR = path.join(FLEET_HOOKS_DIR, '_shared')

export interface DeadExport {
  readonly module: string
  readonly symbol: string
}

// Pull the exported symbol names from a `_shared` module's source. Matches the
// fleet's export forms: `export function X`, `export async function X`,
// `export const X`, `export interface X`, `export type X`, `export class X`.
// Skips `export default` (anonymous) and `export *` / re-export lines.
export function exportedSymbols(src: string): string[] {
  const out: string[] = []
  // Per line (`m` flag): `export `, an optional `async `, one of the
  // declaration keywords (alphabetized for sort-regex-alternations), a space,
  // then capture group 1 = the identifier (`[A-Za-z_$][\w$]*`).
  const re =
    /^export\s+(?:async\s+)?(?:class|const|function|interface|let|type)\s+([A-Za-z_$][\w$]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    out.push(m[1]!)
  }
  return out
}

// List immediate `<name>` subdirectories of a hooks dir (skips `_shared`).
function hookDirs(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  const entries = readdirSync(dir)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name.startsWith('_')) {
      continue
    }
    if (statSync(path.join(dir, name)).isDirectory()) {
      out.push(name)
    }
  }
  return out
}

// The relocated test homes a _shared helper's test may live in. Hook tests
// (incl. `hooks-shared/` for the `_shared/` helpers) cover unit + integration;
// lint-rule tests cover unit + integration. A _shared export consumed ONLY by a
// relocated test still counts as live, so these are scanned as consumers.
const RELOCATED_TEST_DIRS: readonly string[] = [
  ...HOOK_TEST_DIRS,
  ...LINT_RULE_TEST_DIRS,
]

// Collect every consumer file's source text: each fleet hook's index.mts + any
// co-located test files (member repos still carry these), the relocated
// wheelhouse tests under `test/repo/`, and every _shared/*.mts EXCEPT the module
// under test (a helper using its own export is not "another consumer"). Read
// once, concatenated per check.
export function collectConsumerText(excludeSharedModule: string): string {
  const parts: string[] = []
  // Other _shared modules.
  if (existsSync(SHARED_DIR)) {
    const sharedEntries = readdirSync(SHARED_DIR)
    for (let i = 0, { length } = sharedEntries; i < length; i += 1) {
      const f = sharedEntries[i]!
      if (!f.endsWith('.mts') || f === excludeSharedModule) {
        continue
      }
      parts.push(readFileSync(path.join(SHARED_DIR, f), 'utf8'))
    }
  }
  // Each hook's index.mts + any co-located test files.
  const dirs = hookDirs(FLEET_HOOKS_DIR)
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const hookPath = path.join(FLEET_HOOKS_DIR, dirs[i]!)
    const index = path.join(hookPath, 'index.mts')
    if (existsSync(index)) {
      parts.push(readFileSync(index, 'utf8'))
    }
    const testDir = path.join(hookPath, 'test')
    if (existsSync(testDir)) {
      const testEntries = readdirSync(testDir)
      for (let j = 0, { length: tlen } = testEntries; j < tlen; j += 1) {
        const tf = testEntries[j]!
        if (tf.endsWith('.mts')) {
          parts.push(readFileSync(path.join(testDir, tf), 'utf8'))
        }
      }
    }
  }
  // The relocated wheelhouse tests (test/repo/) — a member ships no test/repo,
  // so guard on its presence and treat its absence as a no-op.
  if (existsSync(TEST_REPO_DIR)) {
    for (let i = 0, { length } = RELOCATED_TEST_DIRS; i < length; i += 1) {
      const dir = RELOCATED_TEST_DIRS[i]!
      if (!existsSync(dir)) {
        continue
      }
      const entries = readdirSync(dir)
      for (let j = 0, { length: elen } = entries; j < elen; j += 1) {
        const f = entries[j]!
        if (f.endsWith('.mts')) {
          parts.push(readFileSync(path.join(dir, f), 'utf8'))
        }
      }
    }
  }
  return parts.join('\n')
}

// A symbol is "used" if its name appears as a whole word anywhere in the
// consumer text. Word-boundary match avoids `readStdin` matching `readStdinX`.
export function symbolIsUsed(symbol: string, consumerText: string): boolean {
  const re = new RegExp(
    `\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
  )
  return re.test(consumerText)
}

export function findDeadExports(): DeadExport[] {
  const dead: DeadExport[] = []
  if (!existsSync(SHARED_DIR)) {
    return dead
  }
  const modules = readdirSync(SHARED_DIR).filter(f => f.endsWith('.mts'))
  for (let i = 0, { length } = modules; i < length; i += 1) {
    const mod = modules[i]!
    const symbols = exportedSymbols(
      readFileSync(path.join(SHARED_DIR, mod), 'utf8'),
    )
    if (symbols.length === 0) {
      continue
    }
    const consumerText = collectConsumerText(mod)
    for (let j = 0, { length: slen } = symbols; j < slen; j += 1) {
      const symbol = symbols[j]!
      if (!symbolIsUsed(symbol, consumerText)) {
        dead.push({ module: mod, symbol })
      }
    }
  }
  return dead
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const dead = findDeadExports()
  if (dead.length === 0) {
    if (!quiet) {
      logger.success(
        'shared-hook-helpers-are-used: no unreferenced _shared/ exports.',
      )
    }
    return
  }
  // ADVISORY — report, never fail. (See the file header for why this can't be a
  // hard gate: out-of-repo user-global consumers + judgment-call removal.)
  logger.warn(
    `shared-hook-helpers-are-used: ${dead.length} _shared/ export(s) with no in-repo consumer (review for removal):`,
  )
  for (let i = 0, { length } = dead; i < length; i += 1) {
    const d = dead[i]!
    logger.warn(`  _shared/${d.module} → \`${d.symbol}\``)
  }
  logger.log(
    'Confirm each is truly unused (also check scripts/ + the user-global ' +
      '~/.claude/hooks/ dispatch) before removing. A _shared/ export no hook ' +
      'imports is dead weight in the cascaded layer.',
  )
}

main()
