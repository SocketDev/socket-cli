import { select } from '@socketsecurity/registry/lib/prompts'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | void> {
  const spawnResult = await spawn('git', ['branch', '--show-current'])
  const currentBranch = stripAnsi(
    (spawnResult.stdout ? spawnResult.stdout.toString() : '').trim(),
  )
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
