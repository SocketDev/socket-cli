import { spawn } from '@socketsecurity/lib/spawn'
import { select } from '@socketsecurity/lib/stdio/prompts'
import { stripAnsi } from '@socketsecurity/lib/strings'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | undefined> {
  const spawnResult = await spawn('git', ['branch', '--show-current'])
  const stdoutStr =
    typeof spawnResult.stdout === 'string'
      ? spawnResult.stdout
      : spawnResult.stdout.toString('utf8')
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
