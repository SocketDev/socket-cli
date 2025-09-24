import { statSync } from 'node:fs'
import path from 'node:path'

function findUpSync(name, options) {
  const opts = { __proto__: null, ...options }
  const { cwd = process.cwd() } = opts
  let { onlyDirectories = false, onlyFiles = true } = opts
  if (onlyDirectories) {
    onlyFiles = false
  }
  if (onlyFiles) {
    onlyDirectories = false
  }
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
      const filePath = path.join(dir, name)
      try {
        const stats = statSync(filePath, { throwIfNoEntry: false })
        if (!onlyDirectories && stats?.isFile()) {
          return filePath
        }
        if (!onlyFiles && stats?.isDirectory()) {
          return filePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

export {
  findUpSync,
}
