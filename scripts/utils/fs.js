'use strict'

const { promises: fs, statSync } = require('node:fs')
const path = require('node:path')

function findUpSync(name, { cwd = process.cwd() }) {
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
      const filePath = path.join(dir, name)
      try {
        const stats = statSync(filePath)
        if (stats.isFile()) {
          return filePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

async function readJson(filepath) {
  return JSON.parse(await fs.readFile(filepath, 'utf8'))
}

module.exports = {
  findUpSync,
  readJson
}
