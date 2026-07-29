/**
 * @file Assertion helpers for tests that exercise the git spawn chokepoint.
 *   Every `spawnGit` invocation prepends a fixed hygiene prefix
 *   (`--literal-pathspecs`, `--no-pager`, and the `-c` config overrides) and
 *   fences repository-influenced operands behind `--end-of-options`. These
 *   helpers let a test assert on the subcommand alone.
 */

import {
  GIT_OPERAND_FENCE,
  listGitHygieneArgs,
} from '../../src/util/git/spawn-git.mts'

export type RecordedSpawnCall = {
  0: string
  1: string[] | readonly string[]
}

/**
 * Argv of every recorded git spawn with the shared hygiene prefix stripped.
 *
 * @example
 *   expect(listGitArgvTails(spawn.mock.calls)).toContainEqual([
 *     'checkout',
 *     '--end-of-options',
 *     'main',
 *   ])
 */
export function listGitArgvTails(
  calls: readonly RecordedSpawnCall[],
): string[][] {
  const { length: prefixLength } = listGitHygieneArgs()
  const tails: string[][] = []
  for (let i = 0, { length } = calls; i < length; i += 1) {
    tails.push([...calls[i]![1]].slice(prefixLength))
  }
  return tails
}

/**
 * Argv tail for a git subcommand, with the operand fence spliced in.
 *
 * @example
 *   toGitArgvTail(['branch', '-D'], ['old-feature'])
 *   // ['branch', '-D', '--end-of-options', 'old-feature']
 */
export function toGitArgvTail(
  args: string[] | readonly string[],
  operands?: string[] | readonly string[] | undefined,
): string[] {
  return operands?.length
    ? [...args, GIT_OPERAND_FENCE, ...operands]
    : [...args]
}
