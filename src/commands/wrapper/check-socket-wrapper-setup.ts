import fs from 'node:fs'

export function checkSocketWrapperSetup(file: string): boolean {
  const fileContent = fs.readFileSync(file, 'utf8')
  const linesWithSocketAlias = fileContent
    .split('\n')
    .filter(
      l => l === 'alias npm="socket npm"' || l === 'alias npx="socket npx"'
    )

  if (linesWithSocketAlias.length) {
    console.log(
      `The Socket npm/npx wrapper is set up in your bash profile (${file}).`
    )
    return true
  }
  return false
}
