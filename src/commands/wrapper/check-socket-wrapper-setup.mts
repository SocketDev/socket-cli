import fs from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

export function checkSocketWrapperSetup(file: string): boolean {
  const fileContent = fs.readFileSync(file, 'utf8')
  const linesWithSocketAlias = fileContent
    .split('\n')
    .filter(
      l => l === 'alias npm="socket npm"' || l === 'alias npx="socket npx"',
    )

  if (linesWithSocketAlias.length) {
    logger.log(
      `The Socket npm/npx wrapper is set up in your bash profile (${file})`,
    )
    return true
  }
  return false
}
