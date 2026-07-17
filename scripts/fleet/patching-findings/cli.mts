/**
 * Patching-findings engine CLI — the deterministic parse + report half. The
 * patch generation, the reviewer's ACCEPT/REJECT call, and the apply/commit
 * stay agent-driven; this parses their tagged replies and renders PATCHES.md so
 * the tag extraction, the style-contradiction flag, and the counts don't drift
 * by hand. The style-contradiction is a FLAG only — it never alters the
 * verdict.
 *
 * Subcommands: parse-patch --from <reply.txt> → ParsedPatch JSON (five tags +
 * status) parse-review --from <reply.txt> → ParsedReview JSON (verdict + style
 * flag) report --from <outcomes.json> --findings <p> --repo <p> [--out <f>] →
 * write PATCHES.md + print the terminal summary.
 */

import process from 'node:process'
import { readFileSync, writeFileSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  parsePatchResult,
  parseReviewResult,
  renderPatchesMd,
  summarizeOutcomes,
} from './lib/patch-parse.mts'
import type { PatchOutcome } from './lib/patch-parse.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

function optValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

function readFrom(argv: readonly string[]): string {
  const from = optValue(argv, '--from')
  if (!from) {
    throw new Error('--from <file> is required')
  }
  return readFileSync(from, 'utf8')
}

export function main(argv: readonly string[]): number {
  const sub = argv[0]
  const rest = argv.slice(1)
  try {
    if (sub === 'parse-patch') {
      process.stdout.write(
        `${JSON.stringify(parsePatchResult(readFrom(rest)), undefined, 2)}\n`,
      )
      return 0
    }
    if (sub === 'parse-review') {
      process.stdout.write(
        `${JSON.stringify(parseReviewResult(readFrom(rest)), undefined, 2)}\n`,
      )
      return 0
    }
    if (sub === 'report') {
      const outcomes = JSON.parse(readFrom(rest)) as PatchOutcome[]
      const md = renderPatchesMd({
        findingsPath: optValue(rest, '--findings') ?? '(unknown)',
        outcomes,
        repo: optValue(rest, '--repo') ?? '.',
      })
      writeFileSync(optValue(rest, '--out') ?? './PATCHES.md', md)
      const s = summarizeOutcomes(outcomes)
      process.stdout.write(
        `${s.total} findings → ${s.applied} applied, ${s.rejected} rejected, ${s.skipped} skipped. Run fix --all / check --all / test before opening the PR.\n`,
      )
      return 0
    }
    logger.fail(
      `unknown subcommand ${sub ?? '(none)'}. Use \`parse-patch\`, \`parse-review\`, or \`report\`.`,
    )
    return 1
  } catch (e) {
    logger.fail(`patching-findings engine failed: ${errorMessage(e)}`)
    return 1
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
