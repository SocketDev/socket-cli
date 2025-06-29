import { select } from '@socketsecurity/registry/lib/prompts'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | void> {
  const spawnResult = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  })
  const currentBranch = stripAnsi(spawnResult.stdout.trim())
  if (currentBranch && spawnResult.status === 0) {
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
