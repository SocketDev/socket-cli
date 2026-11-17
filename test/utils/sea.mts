import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

export async function readSeaNodeVersion(): Promise<string> {
  return (
    await readFile(path.join(REPOSITORY_ROOT, 'src/sea/.node-version'), 'utf8')
  ).trim()
}
