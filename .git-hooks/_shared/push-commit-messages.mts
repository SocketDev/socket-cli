// Pre-push commit-message gate. Scans every commit in the range for AI
// attribution in commit messages — the push-time backstop for commits created
// with `--no-verify` that bypassed the commit-msg hook.
//
// The scanned range is narrowed by the release-tag exemption: the only remedy
// this gate can offer is a reworded commit, which changes the commit's SHA, so
// it has nothing to say about a commit a published tag has already frozen.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { containsAiAttribution } from '../../.claude/hooks/fleet/_shared/ai-attribution.mts'
import { git } from './git.mts'
import {
  reportReleaseTagExemption,
  resolveRewritableCommits,
} from './push-release-tags.mts'

import type { ReleaseTagOptions } from './push-release-tags.mts'

const logger = getDefaultLogger()

// Scans every rewritable commit in the range for AI attribution in commit
// messages. `options.cwd` runs the gate against a repo other than the process
// cwd; the hook leaves it unset.
export function scanCommitMessages(
  range: string,
  remote: string,
  options?: ReleaseTagOptions | undefined,
): number {
  const { cwd } = { __proto__: null, ...options } as ReleaseTagOptions
  const repo = cwd ? ['-C', cwd] : []
  logger.info('Checking commit messages for AI attribution…')
  const exemption = resolveRewritableCommits(range, remote, { cwd })
  reportReleaseTagExemption(exemption, 'AI-attribution')
  let errors = 0
  for (const sha of exemption.scanned) {
    if (!sha) {
      continue
    }
    const msg = git(...repo, 'log', '-1', '--format=%B', sha)
    if (containsAiAttribution(msg)) {
      if (errors === 0) {
        logger.fail('AI attribution found in commit messages!')
        logger.info('Commits with AI attribution:')
      }
      const oneline = git(...repo, 'log', '-1', '--oneline', sha)
      logger.info(`  - ${oneline}`)
      errors++
    }
  }
  if (errors > 0) {
    logger.info('')
    logger.info(
      'These commits were likely created with --no-verify, bypassing the',
    )
    logger.info('commit-msg hook that strips AI attribution.')
    logger.info('')
    const rangeBase = range.split('..')[0]
    logger.info('To fix:')
    logger.info(`  git rebase -i ${rangeBase}`)
    logger.info("  Mark commits as 'reword', remove AI attribution, save")
    logger.info('  git push')
  }
  return errors
}
