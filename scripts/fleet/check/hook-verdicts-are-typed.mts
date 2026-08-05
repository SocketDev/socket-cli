/*
 * @file Code-as-law for the typed hook-verdict taxonomy
 *   (docs/agents.md/fleet/hook-registry.md "Guard output is terse"): a hook
 *   composes its severity glyph via `verdictLine(kind, …)` from
 *   `_shared/verdict.mts` — 🚨 block / ⚠️ warn / ℹ️ info / 💡 hint — never by
 *   hand-typing the emoji into a message string. Hand-typed glyphs drift:
 *   a nudge shipping 🚨 reads as a refusal, a guard shipping 💡 reads as
 *   optional.
 *
 *   A `.claude/hooks/{fleet,repo}/<name>/index.mts` that carries any of the
 *   four glyphs in its source without importing `_shared/verdict.mts` is a
 *   finding — unless the member config grandfathers it under
 *   `typedVerdicts.grandfathered`. The grandfather list is a RATCHET,
 *   script-owned, never hand-edited: `--update-baseline` rewrites it to
 *   exactly the current offender set, so a migrated hook falls off on the
 *   next update and a NEW hand-typed glyph can never land quietly.
 *
 *   Run standalone: `node scripts/fleet/check/hook-verdicts-are-typed.mts`
 *   Enroll / ratchet: `node scripts/fleet/check/hook-verdicts-are-typed.mts --update-baseline`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { walkSimple } from '../../../.claude/hooks/fleet/_shared/ast/core.mts'
import {
  findSocketWheelhouseConfig,
  loadSocketWheelhouseConfig,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { AcornNode } from '../../../.claude/hooks/fleet/_shared/ast/core.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // repo-root-relative path of the offending hook entry.
  file: string
  // The hand-typed glyphs the file carries.
  glyphs: string[]
}

// The four typed severity glyphs, in taxonomy order.
export const TYPED_GLYPHS = ['🚨', '⚠', 'ℹ', '💡'] as const

// The one sanctioned composer.
const VERDICT_MODULE_RE = /_shared\/verdict(?:\.mts)?'/

/**
 * The hand-typed glyphs in one hook source, empty when the file composes
 * through `_shared/verdict.mts` (importing it is the sanction — the glyph
 * constants live there, so a file that imports it never needs a literal).
 * A real parse, not a text scan: only glyphs inside string and template
 * LITERALS count, so a comment naming a glyph never fires. Pure — exported
 * for tests.
 */
export function handTypedGlyphs(source: string): string[] {
  if (VERDICT_MODULE_RE.test(source)) {
    return []
  }
  const literalText: string[] = []
  walkSimple(source, {
    Literal(node: AcornNode) {
      const { value } = node as unknown as { value?: unknown | undefined }
      if (typeof value === 'string') {
        literalText.push(value)
      }
    },
    TemplateLiteral(node: AcornNode) {
      const { quasis } = node as unknown as {
        quasis?:
          | Array<{ value?: { raw?: string | undefined } | undefined }>
          | undefined
      }
      for (const quasi of quasis ?? []) {
        const raw = quasi.value?.raw
        if (typeof raw === 'string') {
          literalText.push(raw)
        }
      }
    },
  })
  const joined = literalText.join('\n')
  return TYPED_GLYPHS.filter(glyph => joined.includes(glyph))
}

/**
 * The grandfathered hook list from the member config's `typedVerdicts`
 * section — empty when the config or section is absent.
 */
export function grandfatheredHooks(repoRoot: string = REPO_ROOT): string[] {
  const config = loadSocketWheelhouseConfig(repoRoot)
  const section = config?.value['typedVerdicts']
  if (typeof section !== 'object' || section === null) {
    return []
  }
  const list = (section as Record<string, unknown>)['grandfathered']
  return Array.isArray(list) ? list.filter(f => typeof f === 'string') : []
}

/**
 * Every hook entry that hand-types a severity glyph. Scans the live hook
 * trees (fleet mirror + repo-owned). Pure over the filesystem snapshot —
 * exported for tests and the baseline writer.
 */
export function scanHandTypedVerdicts(repoRoot: string = REPO_ROOT): Finding[] {
  const files = globSync(
    ['.claude/hooks/fleet/*/index.mts', '.claude/hooks/repo/*/index.mts'],
    { absolute: false, cwd: repoRoot, ignore: ['**/node_modules/**'] },
  )
  const findings: Finding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text = ''
    try {
      text = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      /* c8 ignore next - glob returned the path moments ago; a read race is not testable */
      continue
    }
    const glyphs = handTypedGlyphs(text)
    if (glyphs.length > 0) {
      findings.push({ file: rel, glyphs })
    }
  }
  return findings
}

/**
 * Rewrite the config's `typedVerdicts.grandfathered` list to exactly the
 * current offender set — enrollment and the ratchet are the same operation.
 * Returns the written list, or `undefined` when the member has no
 * `.config/repo/socket-wheelhouse.json` to hold it.
 */
export function updateBaseline(
  repoRoot: string = REPO_ROOT,
): string[] | undefined {
  const config = loadSocketWheelhouseConfig(repoRoot)
  if (!config) {
    return undefined
  }
  const grandfathered = scanHandTypedVerdicts(repoRoot)
    .map(f => f.file)
    .toSorted()
  const next = { ...config.value, typedVerdicts: { grandfathered } }
  writeFileSync(config.location.path, `${JSON.stringify(next, null, 2)}\n`)
  return grandfathered
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every hook composes its severity glyph via _shared/verdict.mts instead of hand-typing 🚨/⚠️/ℹ️/💡',
  help: `Usage: node scripts/fleet/check/hook-verdicts-are-typed.mts [--update-baseline]

  --update-baseline  rewrite typedVerdicts.grandfathered in .config/repo/socket-wheelhouse.json to the current offender set`,
}

export function main(): number {
  if (process.argv.includes('--update-baseline')) {
    const written = updateBaseline()
    const location = findSocketWheelhouseConfig()
    if (written !== undefined && location) {
      // JSON.stringify's reflow is not the repo's JSON style — the formatter
      // owns that, so the write is immediately reformatted rather than
      // leaving churn for a hand-run (code-first-then-ai).
      spawnSync(
        'node',
        [path.join(REPO_ROOT, 'scripts', 'fleet', 'format.mts'), location.path],
        { cwd: REPO_ROOT, stdio: 'ignore' },
      )
    }
    if (written === undefined) {
      logger.error(
        'hook-verdicts-are-typed: no .config/repo/socket-wheelhouse.json to hold the baseline.\n' +
          '  Where: this repo root.\n' +
          '  Saw:   the member config is absent; wanted the cascaded config file.\n' +
          '  Fix:   run the cascade first, then re-run with --update-baseline.',
      )
      return 1
    }
    logger.log(
      `hook-verdicts-are-typed: baseline updated — ${written.length} grandfathered hook(s).`,
    )
    return 0
  }
  const grandfathered = new Set(grandfatheredHooks())
  const findings = scanHandTypedVerdicts().filter(
    f => !grandfathered.has(f.file),
  )
  if (findings.length === 0) {
    logger.log('✔ every hook verdict glyph is composed, not hand-typed')
    return 0
  }
  logger.error(
    `hook-verdicts-are-typed: ${findings.length} hook(s) hand-type a severity glyph — compose via verdictLine(kind, …) from _shared/verdict.mts, or ratchet a pre-law hook in via --update-baseline.`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`   ${f.file} — ${f.glyphs.join(' ')}`)
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
