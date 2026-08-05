#!/usr/bin/env node
/*
 * @file `check --all` gate: every copyleft upstream materialized in this repo
 *   is present as a TESTS-ONLY slice. A copyleft project may be run as a tool
 *   and observed through its own tests, but its implementation must never be
 *   read or derived from — that would make the consuming package a derivative
 *   work and force the upstream's license onto it. The write-time twin is the
 *   `no-copyleft-source-read` hook; this belt re-asserts the invariant over
 *   what is actually on disk and in the index, catching an implementation file
 *   that landed past the guard.
 *
 *   Three assertions, per copyleft upstream present as a submodule:
 *   1. the submodule's sparse-checkout config admits no non-test pattern;
 *   2. no non-test file from it exists in the working tree;
 *   3. no tracked file cites it as a derivation source.
 *
 *   A repo with no copyleft submodule is a VACUOUS pass, which is every fleet
 *   repo today — the gate exists so the first one to pin such an upstream
 *   inherits the boundary rather than re-deriving it.
 *
 *   The roster, the tests allowlist, and the path matcher come from the ONE
 *   shared module the guard uses, `_shared/copyleft-upstreams.mts`, so the
 *   write-time block and this commit-time belt can never disagree.
 *
 *   Exit: 0 — every present copyleft slice is tests-only, or none is present;
 *   1 — at least one widened cone, materialized implementation file, or
 *   derivation citation.
 *   Usage: node scripts/fleet/check/copyleft-slices-are-tests-only.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  COPYLEFT_UPSTREAMS,
  copyleftSparseRecipe,
  isCopyleftObservablePath,
  isCopyleftSparsePatternAllowed,
} from '../../../.claude/hooks/fleet/_shared/copyleft-upstreams.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { CopyleftUpstream } from '../../../.claude/hooks/fleet/_shared/copyleft-upstreams.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// A tracked file that names a copyleft upstream as the thing a table, ruleset,
// or algorithm was DERIVED from. `source` / `derived from` / `ported from`
// within the same line as the upstream slug is the citation shape; a mere
// mention (a roster entry, this file, the guard) is not.
const DERIVATION_WORDS: readonly string[] = [
  'adapted from',
  'derived from',
  'ported from',
  'source:',
]

/**
 * One violation of the tests-only boundary.
 */
export interface CopyleftSliceFinding {
  readonly detail: string
  readonly kind: 'derivation-citation' | 'materialized-file' | 'sparse-pattern'
  readonly upstream: CopyleftUpstream
}

/**
 * The non-test patterns in a submodule's sparse-checkout config. Pure — config
 * text in, offending patterns out — so the invariant unit-tests without git.
 * Comment lines and negations are skipped: a `!` line NARROWS the cone.
 */
export function findWideningSparsePatterns(
  upstream: CopyleftUpstream,
  sparseConfigText: string,
): string[] {
  const out: string[] = []
  const lines = sparseConfigText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue
    }
    if (!isCopyleftSparsePatternAllowed(upstream, line)) {
      out.push(line)
    }
  }
  return out.toSorted()
}

/**
 * The repo-relative paths under `upstream/<repo>/` that are NOT on the
 * observable slice. Pure — a listing in, offenders out.
 */
export function findMaterializedImplementation(
  upstream: CopyleftUpstream,
  relPaths: readonly string[],
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    if (!isCopyleftObservablePath(upstream, relPaths[i]!)) {
      out.push(normalizePath(relPaths[i]!))
    }
  }
  return out.toSorted()
}

/**
 * True when a line of a tracked file cites `upstream` as a DERIVATION source.
 * The upstream slug and a derivation word must share the line, so a roster
 * entry or a "do not read this" warning does not trip the gate. Pure.
 */
export function citesCopyleftDerivation(
  upstream: CopyleftUpstream,
  line: string,
): boolean {
  const lower = line.toLowerCase()
  const slug = `${upstream.owner}/${upstream.repo}`.toLowerCase()
  if (!lower.includes(slug)) {
    return false
  }
  for (let i = 0, { length } = DERIVATION_WORDS; i < length; i += 1) {
    if (lower.includes(DERIVATION_WORDS[i]!)) {
      return true
    }
  }
  return false
}

// Every file under `dir`, as paths relative to `dir`. Returns [] when the
// directory is absent — an unmaterialized submodule is a vacuous pass.
function listFilesUnder(dir: string, prefix: string = ''): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  const entries = readdirSync(dir)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    // `.git` is the submodule's own plumbing, never upstream content.
    if (name === '.git') {
      continue
    }
    const full = path.join(dir, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    if (statSync(full).isDirectory()) {
      out.push(...listFilesUnder(full, rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

// The submodule's sparse-checkout config text, or '' when it has none.
function readSparseConfig(
  repoRoot: string,
  upstream: CopyleftUpstream,
): string {
  const candidate = path.join(
    repoRoot,
    '.git',
    'modules',
    'upstream',
    upstream.repo,
    'info',
    'sparse-checkout',
  )
  return existsSync(candidate) ? readFileSync(candidate, 'utf8') : ''
}

// The tracked files that cite a copyleft upstream as a derivation source.
async function findDerivationCitations(
  repoRoot: string,
  upstream: CopyleftUpstream,
): Promise<string[]> {
  let tracked: string[]
  try {
    const result = (await spawn('git', ['ls-files'], {
      cwd: repoRoot,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    tracked = String(result?.stdout ?? '')
      .split('\n')
      .filter(Boolean)
  } catch {
    // git unavailable — another gate's concern; this arm is vacuous.
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = tracked; i < length; i += 1) {
    const rel = tracked[i]!
    // The roster and its enforcers name the upstream by design.
    if (rel.includes('copyleft')) {
      continue
    }
    const full = path.join(repoRoot, rel)
    let text: string
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let j = 0, { length: llen } = lines; j < llen; j += 1) {
      if (citesCopyleftDerivation(upstream, lines[j]!)) {
        out.push(`${rel}:${j + 1}`)
        break
      }
    }
  }
  return out.toSorted()
}

/**
 * Run every assertion for every copyleft upstream present in `repoRoot`.
 */
export async function findCopyleftSliceViolations(
  repoRoot: string,
): Promise<CopyleftSliceFinding[]> {
  const findings: CopyleftSliceFinding[] = []
  for (let i = 0, { length } = COPYLEFT_UPSTREAMS; i < length; i += 1) {
    const upstream = COPYLEFT_UPSTREAMS[i]!
    const submoduleDir = path.join(repoRoot, 'upstream', upstream.repo)
    if (!existsSync(submoduleDir)) {
      continue
    }
    const widening = findWideningSparsePatterns(
      upstream,
      readSparseConfig(repoRoot, upstream),
    )
    for (let j = 0, { length: wlen } = widening; j < wlen; j += 1) {
      findings.push({
        detail: widening[j]!,
        kind: 'sparse-pattern',
        upstream,
      })
    }
    const materialized = findMaterializedImplementation(
      upstream,
      listFilesUnder(submoduleDir),
    )
    for (let j = 0, { length: mlen } = materialized; j < mlen; j += 1) {
      findings.push({
        detail: `upstream/${upstream.repo}/${materialized[j]!}`,
        kind: 'materialized-file',
        upstream,
      })
    }
    const citations = await findDerivationCitations(repoRoot, upstream)
    for (let j = 0, { length: clen } = citations; j < clen; j += 1) {
      findings.push({
        detail: citations[j]!,
        kind: 'derivation-citation',
        upstream,
      })
    }
  }
  return findings
}

export async function main(): Promise<void> {
  const findings = await findCopyleftSliceViolations(REPO_ROOT)
  if (findings.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log(
        'copyleft-slices-are-tests-only: every copyleft upstream present is a tests-only slice.',
      )
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `copyleft-slices-are-tests-only: ${findings.length} boundary violation(s):`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.fail(`  [${f.kind}] ${f.detail}`)
  }
  const first = findings[0]!.upstream
  logger.fail(
    `  What:  a copyleft upstream (${first.spdx}) is present beyond its tests slice.\n` +
      '  Where: the path(s) above.\n' +
      '  Wanted: copyleft upstreams are RUN and OBSERVED via their own tests only —\n' +
      '          their implementation is never materialized, read, or derived from.\n' +
      '  Fix:   restore the tests-only cone, then re-run:\n' +
      `           ${copyleftSparseRecipe(first)}\n` +
      '         For a derivation citation, re-derive from a permissively licensed\n' +
      `         source${first.permissiveAlternative ? ` such as ${first.permissiveAlternative}` : ''}.\n` +
      '         See docs/agents.md/fleet/copyleft-boundaries.md.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every copyleft upstream on disk is present as a tests-only slice',
  help: `Usage: node scripts/fleet/check/copyleft-slices-are-tests-only.mts [flags]

  --quiet  suppress the pass message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
