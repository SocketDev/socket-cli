#!/usr/bin/env node
/*
 * @file `check --all` gate: a FLEET tool is declared in the fleet registry, not
 *   the per-repo one.
 *
 *   The two registries have different scopes, and that is the point:
 *   `scripts/fleet/setup/external-tools.json` carries the fleet-wide set —
 *   runtimes and package managers every member needs, beside the installers
 *   that consume them — while `.config/repo/external-tools.json` carries what
 *   THIS repo alone needs (a compiler, a fuzzer, a proof tool). A per-repo
 *   registry is not duplication; a fleet tool sitting in it is.
 *
 *   The harm is concrete. Five tools were declared in both, and they had
 *   already drifted: pnpm read 11.8.0 in the per-repo file and 11.17.0 in the
 *   fleet one, so which pin you got depended on which file your code opened.
 *   npm was declared only in the fleet registry, which is why a promote ran on
 *   a PATH npm below the repo's own engines floor while a correct pin sat in a
 *   file nobody thought to look in.
 *
 *   DUPLICATED_TOOLS is the shrinking debt list: those may appear in both but
 *   MUST stay byte-identical, so consolidation can proceed one tool at a time
 *   without the gate going red in between. Dropping a name from that list is
 *   the last step of consolidating it. An UNLISTED duplicate fails outright —
 *   that is the new-duplication guard.
 *
 * Usage: node scripts/fleet/check/external-tools-are-declared-once.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The registries, fleet-wide first. A tool belongs to exactly one scope.
export const REGISTRY_PATHS: readonly string[] = [
  '.config/repo/external-tools.json',
  'scripts/fleet/setup/external-tools.json',
]

// Fleet tools still also declared per-repo, pending consolidation into
// `setup/`. Each MUST stay byte-identical across its copies. Shrink this list;
// never grow it.
export const DUPLICATED_TOOLS: readonly string[] = [
  'pnpm',
  'sfw-enterprise',
  'sfw-free',
  'uv',
  'zizmor',
]

export interface DuplicateFinding {
  readonly files: readonly string[]
  readonly kind: 'drifted' | 'unlisted'
  readonly tool: string
}

/**
 * Read a registry's `tools` map, or an empty map when the file is absent or
 * unparseable — a repo need not carry every registry.
 */
export function readRegistry(
  repoRoot: string,
  relPath: string,
): Record<string, unknown> {
  const abs = path.join(repoRoot, relPath)
  if (!existsSync(abs)) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as {
      tools?: Record<string, unknown> | undefined
    }
    return parsed.tools ?? {}
  } catch {
    return {}
  }
}

/**
 * Findings across the registries: a tool declared twice without being listed as
 * known debt, or a listed duplicate whose copies no longer match. Pure over the
 * maps so the rule is testable without a repo.
 */
export function findDuplicateTools(
  registries: ReadonlyArray<{ path: string; tools: Record<string, unknown> }>,
  allowed: readonly string[] = DUPLICATED_TOOLS,
): DuplicateFinding[] {
  const seen = new Map<string, string[]>()
  for (let i = 0, { length } = registries; i < length; i += 1) {
    const reg = registries[i]!
    const names = Object.keys(reg.tools)
    for (let j = 0, { length: n } = names; j < n; j += 1) {
      const tool = names[j]!
      const files = seen.get(tool)
      if (files) {
        files.push(reg.path)
      } else {
        seen.set(tool, [reg.path])
      }
    }
  }
  const findings: DuplicateFinding[] = []
  for (const [tool, files] of seen) {
    if (files.length < 2) {
      continue
    }
    if (!allowed.includes(tool)) {
      findings.push({ files, kind: 'unlisted', tool })
      continue
    }
    // A listed duplicate is tolerated only while its copies agree.
    const shapes = new Set(
      registries
        .filter(r => tool in r.tools)
        .map(r =>
          JSON.stringify(
            r.tools[tool],
            Object.keys(r.tools[tool] as object).toSorted(),
          ),
        ),
    )
    if (shapes.size > 1) {
      findings.push({ files, kind: 'drifted', tool })
    }
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const registries = REGISTRY_PATHS.map(p => ({
    path: p,
    tools: readRegistry(REPO_ROOT, p),
  }))
  const findings = findDuplicateTools(registries)
  if (findings.length) {
    logger.fail(
      '[check-external-tools-are-declared-once] a tool is declared in more than one registry:',
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      logger.error(
        f.kind === 'unlisted'
          ? `  ✗ ${f.tool} — declared in ${f.files.join(' AND ')}. A fleet-wide tool belongs in scripts/fleet/setup/external-tools.json beside its installer; .config/repo/external-tools.json is for tools only THIS repo needs.`
          : `  ✗ ${f.tool} — duplicated across ${f.files.join(' AND ')} and the copies DRIFTED. Make them identical, or finish consolidating it into setup/ and drop it from DUPLICATED_TOOLS.`,
      )
    }
    logger.error(
      '  A per-repo registry is fine; a FLEET tool inside it is not — the pin you got depended on which file your code opened, and pnpm once read 11.8.0 in one and 11.17.0 in the other.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-external-tools-are-declared-once] every tool is declared once, and known duplicates agree.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.error(
      `[check-external-tools-are-declared-once] failed: ${errorMessage(e)}`,
    )
    process.exitCode = 1
  }
}
