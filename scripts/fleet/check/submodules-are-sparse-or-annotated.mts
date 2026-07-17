#!/usr/bin/env node
/**
 * @file `check --all` gate: every `.gitmodules` `[submodule]` block is
 *   optimized — it either declares a `sparse-checkout = …` field (partial
 *   clones pull only the subtrees this repo consumes), is a shallow
 *   single-branch reference (`shallow = true` + `branch = <ref>`, owned by
 *   upstream-submodules-are-shallow-single-branch — see
 *   docs/agents.md/fleet/upstream-references.md), OR carries a `#
 *   full-checkout: <reason>` annotation justifying a whole-tree, full-history
 *   checkout. A vendored upstream is almost never consumed in full — a parser
 *   reference, a test corpus, a build's single subdir — so a block that is none
 *   of the three is presumed un-optimized (it drags the whole upstream tree
 *   into every clone) and fails here. Determination of the safe sparse pattern
 *   set is the `optimizing-submodules` skill's job; this gate keeps the result
 *   from silently regressing. The `# full-checkout:` escape hatch is for the
 *   rare genuine case (a crate built from its whole source tree, an upstream
 *   with no separable subtree). It must name a reason, so the choice is
 *   reviewable rather than an omission. Exit: 0 — every block is optimized; 1 —
 *   one or more is neither sparse, shallow single-branch, nor annotated. Usage:
 *   node scripts/fleet/check/submodules-are-sparse-or-annotated.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { parseGitmodules } from '../_shared/gitmodules.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

export interface SubmoduleEntry {
  // Quoted name from `[submodule "<name>"]`.
  name: string
  // 1-based line of the opening `[submodule …]`.
  line: number
  // True when the block declares a non-empty `sparse-checkout =` field.
  hasSparse: boolean
  // The `# full-checkout: <reason>` reason from the header comment, else
  // undefined.
  fullCheckoutReason: string | undefined
}

// Parse `.gitmodules` into one entry per submodule, recording whether it has a
// sparse-checkout field and any `# full-checkout: <reason>` header annotation.
export function parseEntries(text: string): SubmoduleEntry[] {
  return parseGitmodules(text).map(e => ({
    name: e.name,
    line: e.line,
    hasSparse: e.hasSparse,
    fullCheckoutReason: e.fullCheckoutReason,
  }))
}

function main(): void {
  const gitmodulesPath = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    if (!quiet) {
      logger.log(
        'submodules-are-sparse-or-annotated: no .gitmodules; nothing to check.',
      )
    }
    process.exitCode = 0
    return
  }
  const entries = parseGitmodules(readFileSync(gitmodulesPath, 'utf8'))
  const offenders = entries.filter(
    e => !e.hasSparse && !(e.shallow && e.branch) && !e.fullCheckoutReason,
  )
  if (offenders.length === 0) {
    if (!quiet) {
      const sparse = entries.filter(e => e.hasSparse).length
      const shallowRef = entries.filter(
        e => !e.hasSparse && e.shallow && e.branch,
      ).length
      const annotated = entries.length - sparse - shallowRef
      logger.log(
        `submodules-are-sparse-or-annotated: ${entries.length} submodule(s) — ${sparse} sparse, ${shallowRef} shallow single-branch, ${annotated} full-checkout-annotated.`,
      )
    }
    process.exitCode = 0
    return
  }
  for (const o of offenders) {
    logger.fail(
      `.gitmodules:${o.line} [submodule "${o.name}"] is not optimized — it has no \`sparse-checkout =\` field, is not a shallow single-branch reference (\`shallow = true\` + \`branch = <ref>\`), and carries no \`# full-checkout: <reason>\` annotation. Add the consumed-subtree sparse pattern (see the optimizing-submodules skill), make it a shallow single-branch reference, or annotate why the whole tree is needed.`,
    )
  }
  logger.fail(
    `submodules-are-sparse-or-annotated: ${offenders.length} un-optimized submodule(s). A vendored upstream pulls its whole tree into every clone unless sparse-checkout'd, shallow single-branch, or justified with \`# full-checkout: <reason>\`.`,
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
