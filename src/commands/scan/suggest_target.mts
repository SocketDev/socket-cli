import { select } from '@socketsecurity/registry/lib/prompts'

export async function suggestTarget(): Promise<string[]> {
  // We could prefill this with sub-dirs of the current
  // dir ... but is that going to be useful?
  const proceed = await select<boolean>({
    message: 'No TARGET given. Do you want to use the current directory?',
    choices: [
      {
        name: 'Yes',
        value: true,
        description: 'Target the current directory',
      },
      {
        name: 'No',
        value: false,
        description:
          'Do not use the current directory (this will end in a no-op)',
      },
    ],
  })
  return proceed ? ['.'] : []
}
