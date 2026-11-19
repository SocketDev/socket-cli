import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Hash the paths, directory entries, and bytes that the runtime can read. */
export function digestVfs(root: string, entries: string[]): string {
  const hash = createHash('sha256')
  function visit(relative: string): void {
    const filename = path.join(root, relative)
    const stat = statSync(filename)
    if (stat.isDirectory()) {
      hash.update(JSON.stringify(['dir', relative]))
      for (const name of readdirSync(filename).sort()) {
        visit(`${relative}/${name}`)
      }
    } else if (stat.isFile()) {
      const digest = createHash('sha256')
        .update(readFileSync(filename))
        .digest('hex')
      hash.update(JSON.stringify(['file', relative, digest]))
    } else {
      throw new Error(`Unexpected VFS entry ${relative}`)
    }
  }
  for (const entry of [...entries].sort()) {
    visit(entry)
  }
  return hash.digest('hex')
}
