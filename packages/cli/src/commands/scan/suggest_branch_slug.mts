import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import { select } from '@socketsecurity/lib-stable/stdio/prompts'
import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | undefined> {
  const spawnResult = await spawn('git', ['branch', '--show-current'])

  if (!spawnResult) {
    return undefined
  }

  const stdoutStr =
    spawnResult.stdout
  const currentBranch = stripAnsi(stdoutStr.trim())
  if (currentBranch && spawnResult.code === 0) {
    const proceed = await select({
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
