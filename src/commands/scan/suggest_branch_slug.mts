import { select } from '../../utils/prompts.mts'
import { spawn } from '../../utils/spawn.mts'
import { stripAnsi } from '../../utils/strings.mts'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | void> {
  const spawnResult = await spawn('git', ['branch', '--show-current'])
  const currentBranch = stripAnsi(spawnResult.stdout.trim())
  if (currentBranch && spawnResult.code === 0) {
    const proceed = await select<string>({
      message: 'Use the current git branch as target branch name?',
      choices: [
        {
          name: `Yes [${currentBranch}]`,
          value: currentBranch,
          description: 'Use the current git branch for branch name',
        },
        ...(repoDefaultBranch && repoDefaultBranch !== currentBranch
          ? [
              {
                name: `No, use the default branch [${repoDefaultBranch}]`,
                value: repoDefaultBranch,
                description:
                  'Use the default branch for target repo as the target branch name',
              },
            ]
          : []),
        {
          name: 'No',
          value: '',
          description:
            'Do not use the current git branch as name (will end in a no-op)',
        },
      ].filter(Boolean),
    })
    if (proceed) {
      return proceed
    }
  }
}
