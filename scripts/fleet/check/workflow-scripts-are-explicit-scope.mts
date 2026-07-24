#!/usr/bin/env node
/*
 * @file CI workflow invocations of the scope-mode fleet scripts (test /
 *   lint / check) must name their scope explicitly. Those scripts default
 *   to MODIFIED scope — right for a dev loop, fatally wrong in CI: a clean
 *   checkout has no modified files, so the run resolves to zero targets
 *   and the job passes vacuously. This false-green shipped fleet-wide once
 *   (the canonical CI template's test job ran bare `pnpm test` and every
 *   member "passed" while running nothing); this gate makes the class
 *   unrepresentable. A workflow line invoking `pnpm test` / `pnpm run
 *   {test,lint,check}` / `node scripts/fleet/{test,lint,check}.mts` must
 *   carry `--all`, `--staged`, `--modified` (an explicit choice is
 *   reviewable), or an explicit path argument. Compiled gh-aw `.lock.yml`
 *   files are skipped (generated, agent-runtime commands). Scans the
 *   repo's workflows plus `template/base/.github/workflows/` when present,
 *   so the wheelhouse gates the seed the fleet inherits. Line-based by
 *   design: workflow script args live on the invocation line (multi-line
 *   continuations of a single command are not fleet style). Exit codes:
 *   0 — every invocation scoped; 1 — implicit-scope invocation(s).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Scope-mode invocation: `pnpm test` / `pnpm run test|lint|check` /
// `node scripts/fleet/{test,lint,check}.mts`. The lookahead stops
// `test:npm`-style sibling scripts from matching.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const INVOCATION_RE =
  /(?:node\s+scripts\/fleet\/|pnpm\s+(?:run\s+)?)(?:check|lint|test)(?:\.mts)?(?=$|[\s'"&|;)])/g

export interface ImplicitScopeFinding {
  line: number
  text: string
}

/**
 * An invocation is explicitly scoped when its line carries one of the
 * scope flags or a path argument (a token with `/`). Anything else rides
 * the modified-scope default — vacuous on a clean CI checkout.
 */
export function findImplicitScopeInvocations(
  yamlText: string,
): ImplicitScopeFinding[] {
  const findings: ImplicitScopeFinding[] = []
  const lines = yamlText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimStart().startsWith('#')) {
      continue
    }
    INVOCATION_RE.lastIndex = 0
    const m = INVOCATION_RE.exec(line)
    if (!m) {
      continue
    }
    const rest = line.slice(m.index + m[0].length)
    const scoped =
      /--(?:all|modified|staged)\b/.test(rest) ||
      rest.split(/\s+/).some(tok => tok.includes('/'))
    if (!scoped) {
      findings.push({ line: i + 1, text: line.trim() })
    }
  }
  return findings
}

function workflowFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(
      f =>
        (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.endsWith('.lock.yml'),
    )
    .toSorted()
    .map(f => path.join(dir, f))
}

async function main(): Promise<void> {
  const dirs = [
    path.join(REPO_ROOT, '.github', 'workflows'),
    // The wheelhouse also gates the seed every member inherits.
    path.join(REPO_ROOT, 'template', 'base', '.github', 'workflows'),
  ]
  const errors: string[] = []
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    for (const file of workflowFiles(dir)) {
      const rel = path.relative(REPO_ROOT, file)
      for (const f of findImplicitScopeInvocations(
        readFileSync(file, 'utf8'),
      )) {
        errors.push(
          `${rel}:${f.line} rides the modified-scope default: ${JSON.stringify(f.text)}\n` +
            `    A clean CI checkout has no modified files — the run resolves to zero\n` +
            `    targets and passes vacuously.\n` +
            `    Fix: add an explicit scope (--all in CI; --staged/--modified only as a\n` +
            `    deliberate, commented choice) or pass explicit paths.`,
        )
      }
    }
  }
  if (errors.length) {
    logger.error(
      `workflow-scripts-are-explicit-scope: ${errors.length} finding(s):`,
    )
    for (let i = 0, { length } = errors; i < length; i += 1) {
      logger.error(`  ${errors[i]!}`)
    }
    process.exitCode = 1
    return
  }
  logger.success('workflow fleet-script invocations all name their scope.')
}

main().catch((e: unknown) => {
  logger.error(`workflow-scripts-are-explicit-scope failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
