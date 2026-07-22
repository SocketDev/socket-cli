#!/usr/bin/env node
/*
 * @file Code-is-law gate for the DRY bypass-phrase mechanism: a `defineHook`
 *   hook that references a canonical `Allow <slug> bypass` phrase MUST have that
 *   slug DECLARED as `bypass: [...]` metadata somewhere in the fleet (its own —
 *   the common case — or another hook's, for an informational cross-reference).
 *   The metadata is the ONE source: defineHook loads it into both the detector
 *   and the uniform footer, so the phrase a guard prompts is provably the phrase
 *   it accepts. A phrase advertised in a message with NO backing metadata is the
 *   drift this effort removed — a guard that prompts a bypass the detector never
 *   wires (prefer-json-clone-guard shipped exactly that latent bug).
 *
 *   FAIL: a `defineHook` hook that references an `Allow <slug> bypass` phrase
 *   whose slug is declared by NO hook.
 *   REPORT (informational, exit unaffected): a legacy non-`defineHook` hook that
 *   references an undeclared phrase — it has no HookSpec to attach metadata to
 *   and is ported separately (bundle-stale-reminder).
 *
 *   Scans the wheelhouse's authored source (template/base/.claude/hooks/fleet)
 *   when present, else the repo's own cascaded hooks (.claude/hooks/fleet), so it
 *   runs in the wheelhouse and every member. Pure helpers are exported for unit
 *   tests; main() is the thin CLI shell.
 *   Usage: node scripts/fleet/check/bypass-phrases-are-metadata.mts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const PHRASE_RE = /Allow ([a-z][a-z0-9-]*) bypass/g
const DEFINE_HOOK_RE = /\bdefineHook\s*\(/
const BYPASS_METADATA_RE = /\bbypass:\s*\[([^\]]*)\]/g
const QUOTED_RE = /['"]([^'"]+)['"]/g

/**
 * Slugs a hook DECLARES via `bypass: ['a', 'b']` metadata. Pure.
 */
export function declaredBypassSlugs(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(BYPASS_METADATA_RE)) {
    for (const q of m[1]!.matchAll(QUOTED_RE)) {
      out.push(q[1]!)
    }
  }
  return out
}

/**
 * Strip line + block comments so only CODE (block/notify message text, const
 * arrays) is scanned. A phrase in a doc comment — a header `// Bypass: …`, or
 * the ai-config-poisoning detector's example of a SPOOFED phrase — is
 * documentation, never an advertised bypass. Pure.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * Slugs a hook advertises in CODE via a literal `Allow <slug> bypass` (a
 * block/notify message or an accepted-phrases const array). Comment mentions
 * are ignored. Pure.
 */
export function referencedBypassSlugs(source: string): string[] {
  const out: string[] = []
  for (const m of stripComments(source).matchAll(PHRASE_RE)) {
    out.push(m[1]!)
  }
  return out
}

/**
 * A hook source's bypass posture, given the set of slugs declared ANYWHERE in
 * the fleet:
 * - 'ok'     — references no phrase, or every referenced slug is declared
 * (its own metadata, or another hook's — a cross-reference).
 * - 'fail'   — a defineHook hook references a slug declared by no hook.
 * - 'legacy' — same undeclared reference but NOT via defineHook (no HookSpec).
 * Pure.
 */
export function classifyHookBypass(
  source: string,
  declaredAnywhere: ReadonlySet<string>,
): 'ok' | 'fail' | 'legacy' {
  const refs = referencedBypassSlugs(source)
  if (refs.length === 0) {
    return 'ok'
  }
  const own = new Set(declaredBypassSlugs(source))
  const undeclared = refs.filter(s => !own.has(s) && !declaredAnywhere.has(s))
  if (undeclared.length === 0) {
    return 'ok'
  }
  return DEFINE_HOOK_RE.test(source) ? 'fail' : 'legacy'
}

function fleetHooksDir(repoRoot: string): string | undefined {
  const authored = path.join(
    repoRoot,
    'template',
    'base',
    '.claude',
    'hooks',
    'fleet',
  )
  if (existsSync(authored)) {
    return authored
  }
  const live = path.join(repoRoot, '.claude', 'hooks', 'fleet')
  return existsSync(live) ? live : undefined
}

function main(): void {
  const dir = fleetHooksDir(REPO_ROOT)
  if (!dir) {
    logger.info(
      '[bypass-phrases-are-metadata] no fleet hooks dir — nothing to check.',
    )
    return
  }
  const sources = new Map<string, string>()
  const entries = readdirSync(dir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isDirectory()) {
      continue
    }
    const indexPath = path.join(dir, entry.name, 'index.mts')
    if (!existsSync(indexPath)) {
      continue
    }
    try {
      sources.set(entry.name, readFileSync(indexPath, 'utf8'))
    } catch {}
  }
  // Pass 1: every slug declared anywhere in the fleet.
  const declaredAnywhere = new Set<string>()
  for (const src of sources.values()) {
    for (const slug of declaredBypassSlugs(src)) {
      declaredAnywhere.add(slug)
    }
  }
  // Pass 2: classify against the global declaration set.
  const fails: string[] = []
  const legacy: string[] = []
  for (const [name, src] of sources) {
    const verdict = classifyHookBypass(src, declaredAnywhere)
    if (verdict === 'fail') {
      fails.push(name)
    } else if (verdict === 'legacy') {
      legacy.push(name)
    }
  }
  if (legacy.length > 0) {
    logger.warn(
      `[bypass-phrases-are-metadata] ${legacy.length} legacy non-defineHook hook(s) reference an undeclared bypass phrase (port to defineHook + bypass metadata): ${legacy.join(', ')}`,
    )
  }
  if (fails.length === 0) {
    logger.info(
      '[bypass-phrases-are-metadata] ok — every defineHook bypass phrase is backed by bypass metadata.',
    )
    return
  }
  logger.error(
    [
      `[bypass-phrases-are-metadata] ${fails.length} hook(s) advertise an \`Allow <slug> bypass\` phrase that no hook declares as metadata:`,
      ...fails.map(n => `  ${n}`),
      '',
      "  Declare the slug as `bypass: ['<slug>']` in defineHook and delete the",
      '  hand-written phrase — defineHook then wires detection + the uniform',
      '  footer. Detail: docs/agents.md/fleet/bypass-phrases.md.',
    ].join('\n'),
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
