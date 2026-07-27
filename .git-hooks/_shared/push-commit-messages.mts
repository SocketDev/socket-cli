// Pre-push commit-message gate. Scans every commit in the range for AI
// attribution in commit messages — the push-time backstop for commits created
// with `--no-verify` that bypassed the commit-msg hook.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { containsAiAttribution } from './ai-attribution.mts'
import { git, gitLines } from './git.mts'

const logger = getDefaultLogger()

// Scans every commit in the range for AI attribution in commit
// messages.
export const scanCommitMessages = (range: string): number => {
  logger.info('Checking commit messages for AI attribution…')
  const shas = gitLines('rev-list', range)
  let errors = 0
  for (const sha of shas) {
    if (!sha) {
      continue
    }
    const msg = git('log', '-1', '--format=%B', sha)
    if (containsAiAttribution(msg)) {
      if (errors === 0) {
        logger.fail('AI attribution found in commit messages!')
        logger.info('Commits with AI attribution:')
      }
      const oneline = git('log', '-1', '--oneline', sha)
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
