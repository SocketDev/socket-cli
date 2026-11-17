import fs from 'node:fs/promises'

export const NODE_VERSION_START = '<!-- socket-sea-node-version:start -->'
export const NODE_VERSION_END = '<!-- socket-sea-node-version:end -->'

export function renderSeaReadme(readme: string, nodeVersion: string): string {
  const startIndex = readme.indexOf(NODE_VERSION_START)
  const endIndex = readme.indexOf(NODE_VERSION_END)
  let throws = startIndex === -1 || endIndex === -1 || startIndex >= endIndex

  if (!throws) {
    throws =
      readme.indexOf(
        NODE_VERSION_START,
        startIndex + NODE_VERSION_START.length,
      ) !== -1
  }

  if (!throws) {
    throws =
      readme.indexOf(NODE_VERSION_END, endIndex + NODE_VERSION_END.length) !==
      -1
  }

  if (throws) {
    throw new Error(
      'SEA README must contain one ordered Node version marker pair',
    )
  }

  const versionStart = startIndex + NODE_VERSION_START.length
  return [
    readme.slice(0, versionStart),
    `\`v${nodeVersion}\``,
    readme.slice(endIndex),
  ].join('')
}

export async function updateSeaReadmeVersion(
  readmePath: string,
  nodeVersion: string,
): Promise<boolean> {
  const original = await fs.readFile(readmePath, 'utf8')
  const updated = renderSeaReadme(original, nodeVersion)
  if (updated === original) {
    return false
  }
  await fs.writeFile(readmePath, updated)
  return true
}
