import { parseArgs } from 'node:util'

import { REPO_ROOT } from '../../paths.mts'
import { getScriptArgs } from '../../process/script-output.mts'

import type { WorktreeSweepConfig } from '../../worktree-sweep.mts'

export function parseWorktreeSweepArgs(
  args: readonly string[],
): WorktreeSweepConfig {
  const { values, tokens } = parseArgs({
    args: getScriptArgs({ argv: args }),
    options: {
      candidate: { type: 'string' },
      fix: { default: false, type: 'boolean' },
      'stale-days': { default: '0', type: 'string' },
      target: { type: 'string' },
    },
    strict: true,
    tokens: true,
  })
  const seen = new Set<string>()
  for (const token of tokens) {
    if (token.kind === 'option') {
      if (seen.has(token.name)) {
        throw new TypeError(`Duplicate worktree sweep option: --${token.name}`)
      }
      seen.add(token.name)
    }
  }
  if (
    values.candidate !== undefined &&
    (!values.candidate.trim() || values.candidate.includes('\0'))
  ) {
    throw new TypeError(
      'Invalid worktree candidate path. Supply one registered worktree path.',
    )
  }
  const config = {
    __proto__: null,
    candidatePath: values.candidate,
    fix: values['fix'] === true,
    repoRoot: REPO_ROOT,
    staleDays: Number(values['stale-days']),
    targetRef: values.target,
  }
  return config
}
