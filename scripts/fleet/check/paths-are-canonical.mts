#!/usr/bin/env node
/*
 * @file Path-hygiene gate. Mantra: 1 path, 1 reference. A path is constructed
 *   exactly once; everywhere else references the constructed value. Whole-repo
 *   scan complementing the per-edit `.claude/hooks/path-guard` hook. The hook
 *   stops new violations from landing; this gate finds the existing ones and
 *   blocks merges that introduce more. Helper modules under check/paths/:
 *
 *   - exempt.mts — file-path patterns the gate skips
 *   - walk.mts — recursive file walker with SKIP_DIRS
 *   - allowlist.mts — socket-wheelhouse.json `pathsAllowlist` loader + matcher
 *   - scan-code.mts — Rule A + B (.mts / .cts)
 *   - scan-workflow.mts — Rule C + D (.github/workflows/*.yml)
 *   - scan-script.mts — Rule G (Makefile / Dockerfile / shell)
 *   - rules.mts — Rule F (cross-file shape repetition)
 *   - state.mts — shared findings array + push/get helpers
 *   - types.mts — Finding + AllowlistEntry interfaces Rules enforced (full prose
 *     lives in each scanner module): A — Multi-stage path constructed inline. B
 *     — Cross-package path traversal into a sibling's build output. C —
 *     Hand-built workflow path outside a "Compute paths" step. D —
 *     Comment-encoded fully-qualified path. F — Same path shape constructed in
 *     2+ files. G — Hand-built paths in Makefiles, Dockerfiles, shell scripts.
 *     Allowlist: `pathsAllowlist` in `.config/socket-wheelhouse.json`. Each
 *     entry needs a `reason` so the list stays audit-able. Patterns are
 *     deliberately narrow — entries should be specific, not blanket. Usage:
 *     node scripts/fleet/check/paths-are-canonical.mts # default: report + fail node
 *     scripts/fleet/check/paths-are-canonical.mts --explain # long-form explanation node
 *     scripts/fleet/check/paths-are-canonical.mts --json # machine-readable node
 *     scripts/fleet/check/paths-are-canonical.mts --quiet # silent on clean Exit codes: 0 —
 *     clean (no findings, or every finding is allowlisted) 1 — findings present
 *     2 — gate itself crashed
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { REPO_ROOT } from '../paths.mts'
import {
  isAllowlisted,
  loadAllowlist,
  snippetHash,
} from './paths/allowlist.mts'
import { isExempt } from './paths/exempt.mts'
import { checkRuleF } from './paths/rules.mts'
import { scanCodeFile } from './paths/scan-code.mts'
import { scanScriptFile } from './paths/scan-script.mts'
import { scanWorkflowFile } from './paths/scan-workflow.mts'
import { getFindings } from './paths/state.mts'
import { walk } from './paths/walk.mts'

// Plain stderr/stdout output — no @socketsecurity/lib-stable dependency so
// the gate is self-contained and works in socket-lib itself (which
// would otherwise import itself).
const logger = {
  error: (msg: string) => process.stderr.write(msg + '\n'),
  log: (msg: string) => process.stdout.write(msg + '\n'),
  step: (msg: string) => process.stdout.write(`→ ${msg}\n`),
  substep: (msg: string) => process.stdout.write(`  ${msg}\n`),
  // oxlint-disable-next-line socket/no-status-emoji -- local logger replica; can't import lib's logger because this gate runs in socket-lib itself.
  success: (msg: string) => process.stdout.write(`✔ ${msg}\n`),
}

const args = parseArgs({
  options: {
    explain: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    'show-hashes': { type: 'boolean', default: false },
  },
  strict: false,
})

const ALLOWLIST = loadAllowlist(REPO_ROOT)

const main = (): number => {
  // Scan code files (Rule A + B).
  for (const rel of walk(
    REPO_ROOT,
    REPO_ROOT,
    p => p.endsWith('.mts') || p.endsWith('.cts'),
  )) {
    if (isExempt(rel)) {
      continue
    }
    scanCodeFile(REPO_ROOT, rel)
  }
  // Scan workflows (Rule C + D).
  const workflowDir = path.join(REPO_ROOT, '.github', 'workflows')
  if (existsSync(workflowDir)) {
    for (const rel of walk(REPO_ROOT, workflowDir, p => p.endsWith('.yml'))) {
      if (isExempt(rel)) {
        continue
      }
      scanWorkflowFile(REPO_ROOT, rel)
    }
  }
  // Scan scripts/Makefiles/Dockerfiles (Rule G).
  for (const rel of walk(REPO_ROOT, REPO_ROOT, p => {
    const base = path.basename(p)
    return (
      base === 'Makefile' ||
      base.endsWith('.mk') ||
      base.endsWith('.Dockerfile') ||
      base === 'Dockerfile' ||
      base.endsWith('.glibc') ||
      base.endsWith('.musl') ||
      (base.endsWith('.sh') && !p.includes('test/'))
    )
  })) {
    if (isExempt(rel)) {
      continue
    }
    scanScriptFile(REPO_ROOT, rel)
  }
  // Promote cross-file Rule-A repeats to Rule F.
  checkRuleF()

  const findings = getFindings()
  // Filter against allowlist.
  const blocking = findings.filter(f => !isAllowlisted(f, ALLOWLIST))

  if (args.values.json) {
    process.stdout.write(
      JSON.stringify(
        { findings: blocking, allowlisted: findings.length - blocking.length },
        null,
        2,
      ) + '\n',
    )
    return blocking.length === 0 ? 0 : 1
  }

  if (blocking.length === 0) {
    if (!args.values.quiet) {
      logger.success('Path-hygiene check passed (1 path, 1 reference)')
      if (findings.length > 0) {
        logger.substep(`${findings.length} finding(s) allowlisted`)
      }
    }
    return 0
  }

  logger.error(`Path-hygiene check FAILED — ${blocking.length} finding(s)`)
  logger.log('')
  logger.log('Mantra: 1 path, 1 reference')
  logger.log('')
  for (let i = 0, { length } = blocking; i < length; i += 1) {
    const f = blocking[i]!
    logger.log(`  [${f.rule}] ${f.file}:${f.line}`)
    logger.log(`      ${f.snippet}`)
    logger.log(`      → ${f.message}`)
    if (args.values['show-hashes']) {
      logger.log(`      snippet_hash: ${snippetHash(f.snippet)}`)
    }
    if (args.values.explain) {
      logger.log(`      Fix: ${f.fix}`)
    }
    logger.log('')
  }
  if (!args.values.explain) {
    logger.log('Run with --explain to see fix suggestions per finding.')
    logger.log(
      'Add intentional exceptions to `pathsAllowlist` in .config/socket-wheelhouse.json with a `reason` field.',
    )
    logger.log(
      'Run with --show-hashes to print the snippet_hash for each finding (drift-resistant allowlisting).',
    )
  }
  return 1
}

try {
  process.exitCode = main()
} catch (e) {
  logger.error(`Path-hygiene gate crashed: ${e}`)
  process.exitCode = 2
}
