import fs from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

export function checkSocketWrapperSetup(file: string): boolean {
  const fileContent = fs.readFileSync(file, 'utf8')
  const linesWithSocketAlias = fileContent
    .split('\n')
    .filter(
      l => l === 'alias npm="socket npm"' || l === 'alias npx="socket npx"',
    )

  if (linesWithSocketAlias.length) {
    getDefaultLogger().log(
      `The Socket npm/npx wrapper is set up in your bash profile (${file}).`,
    )
    getDefaultLogger().log('')
    getDefaultLogger().log(
      `If you haven't already since enabling; Restart your terminal or run this command to activate it in the current session:`,
    )
    getDefaultLogger().log('')
    getDefaultLogger().log(`    source ${file}`)
    getDefaultLogger().log('')

    return true
  }
  return false
}
