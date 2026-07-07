// Fleet check — the researching-recency SKILL.md still quotes the engine's
// output markers verbatim.
//
// The SKILL.md prose tells the model what the engine emits: the badge first
// line, the evidence-envelope fences (read-don't-dump), and the pass-through
// footer fences (copy verbatim). Those literal strings are the contract surface
// between the prose and the engine. If the engine renames a marker but the
// SKILL.md isn't updated, the model's pass-through/synthesis instructions point
// at strings that no longer appear in the output — a silent contract drift no
// other gate catches (doc-references-resolve only checks that the `node …cli.mts`
// path resolves, not that the output markers match).
//
// This check imports the marker constants straight from the engine
// (`lib/markers.mts`) — the single source of truth — and asserts every one
// appears, byte-for-byte, in the SKILL.md body. Exported-constant comparison,
// not prose-scraping: rename a marker in markers.mts and this fails until the
// SKILL.md quote is updated to match.
//
// Usage: node scripts/fleet/check/researching-recency-contract-is-current.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { CONTRACT_MARKERS } from '../researching-recency/lib/markers.mts'

const logger = getDefaultLogger()

// The SKILL.md whose prose must quote the engine markers.
const SKILL_PATH = path.join(
  REPO_ROOT,
  '.claude',
  'skills',
  'fleet',
  'researching-recency',
  'SKILL.md',
)

export interface ContractResult {
  missing: string[]
  skillFound: boolean
}

// Check the SKILL.md body for every contract marker. Returns the markers it
// fails to find (empty = current). When the SKILL.md is absent — e.g. a
// downstream repo that hasn't taken the skill — there's nothing to drift, so it
// reports found:false and no missing markers.
export function checkContract(skillText: string | undefined): ContractResult {
  if (skillText === undefined) {
    return { missing: [], skillFound: false }
  }
  const missing = CONTRACT_MARKERS.filter(marker => !skillText.includes(marker))
  return { missing, skillFound: true }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(SKILL_PATH)) {
    if (!quiet) {
      logger.log(
        'researching-recency SKILL.md absent — contract check skipped.',
      )
    }
    return
  }
  const result = checkContract(readFileSync(SKILL_PATH, 'utf8'))
  if (result.missing.length > 0) {
    logger.error(
      `researching-recency SKILL.md is missing ${result.missing.length} engine output marker(s):`,
    )
    for (const marker of result.missing) {
      logger.error(`  - ${JSON.stringify(marker)}`)
    }
    logger.error(
      'The SKILL.md prose must quote each marker verbatim so the model passes the right strings through. They are exported from scripts/fleet/researching-recency/lib/markers.mts — copy each missing one into the SKILL.md OUTPUT CONTRACT section.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `researching-recency SKILL.md quotes all ${CONTRACT_MARKERS.length} engine output markers.`,
    )
  }
}

if (process.argv[1]?.endsWith('researching-recency-contract-is-current.mts')) {
  try {
    main()
  } catch (error) {
    logger.error(
      `check-researching-recency-contract-is-current failed: ${errorMessage(error)}`,
    )
    process.exitCode = 1
  }
}
