#!/usr/bin/env node
/**
 * @file `check --all` gate: every `.gitmodules` `[submodule]` block must either
 *   declare a `sparse-checkout = …` field (so partial clones pull only the
 *   subtrees this repo consumes) OR carry a `# full-checkout: <reason>`
 *   annotation justifying a whole-tree checkout. A vendored upstream is almost
 *   never consumed in full — a parser reference, a test corpus, a build's
 *   single subdir — so an un-sparsed, un-annotated submodule is presumed
 *   un-optimized (it drags the whole upstream tree into every clone) and fails
 *   here. Determination of the safe pattern set is the `optimizing-submodules`
 *   skill's job; this gate keeps the result from silently regressing. The `#
 *   full-checkout:` escape hatch is for the rare genuine case (a crate built
 *   from its whole source tree, an upstream with no separable subtree). It must
 *   name a reason, so the choice is reviewable rather than an omission. Exit: 0
 *   — every block is sparse or annotated; 1 — one or more is neither. Usage:
 *   node scripts/fleet/check/submodules-are-sparse-or-annotated.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

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
  const lines = text.split(/\r?\n/)
  const entries: SubmoduleEntry[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const open = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/.exec(lines[i]!)
    if (!open) {
      continue
    }
    // Scan the contiguous comment lines directly above for a full-checkout
    // annotation (it may sit on the `# <name>-<version>` header or its own
    // comment line).
    let fullCheckoutReason: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (!prev.trimStart().startsWith('#')) {
        break
      }
      const m = /#.*\bfull-checkout:\s*(.+?)\s*$/.exec(prev)
      if (m) {
        fullCheckoutReason = m[1]
        break
      }
    }
    // Scan the block body for a non-empty sparse-checkout field.
    let hasSparse = false
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (/^\s*\[/.test(next)) {
        break
      }
      const m = /^\s*sparse-checkout\s*=\s*(\S.*)$/.exec(next)
      if (m) {
        hasSparse = true
      }
    }
    entries.push({
      name: open[1]!,
      line: i + 1,
      hasSparse,
      fullCheckoutReason,
    })
  }
  return entries
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
  const entries = parseEntries(readFileSync(gitmodulesPath, 'utf8'))
  const offenders = entries.filter(e => !e.hasSparse && !e.fullCheckoutReason)
  if (offenders.length === 0) {
    if (!quiet) {
      const sparse = entries.filter(e => e.hasSparse).length
      const full = entries.length - sparse
      logger.log(
        `submodules-are-sparse-or-annotated: ${entries.length} submodule(s) — ${sparse} sparse, ${full} full-checkout-annotated.`,
      )
    }
    process.exitCode = 0
    return
  }
  for (const o of offenders) {
    logger.fail(
      `.gitmodules:${o.line} [submodule "${o.name}"] has neither a \`sparse-checkout =\` field nor a \`# full-checkout: <reason>\` annotation — add the consumed-subtree sparse pattern (see the optimizing-submodules skill), or annotate why the whole tree is needed.`,
    )
  }
  logger.fail(
    `submodules-are-sparse-or-annotated: ${offenders.length} un-optimized submodule(s). A vendored upstream pulls its whole tree into every clone unless sparse-checkout'd; justify the exceptions with \`# full-checkout: <reason>\`.`,
  )
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
