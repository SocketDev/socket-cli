'use strict'

const { readFileSync } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')

function readPackageJsonSync(directory) {
  const filename = directory.endsWith('package.json')
    ? directory
    : path.join(directory, 'package.json')
  return JSON.parse(readFileSync(filename, 'utf8'))
}

async function readPackageJson(directory, options = {}) {
  const filename = directory.endsWith('package.json')
    ? directory
    : path.join(directory, 'package.json')
  let source
  try {
    source = await fs.readFile(filename, 'utf8')
  } catch (error) {
    if (options.throws === false) {
      return null
    }
    throw error
  }
  let content
  try {
    content = JSON.parse(source)
  } catch (error) {
    if (options.throws === false) {
      return null
    }
    throw error
  }
  if (!options.editable) {
    return content
  }
  let original = source
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  '
  const editable = {
    content,
    update(data) {
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) {
          delete content[key]
        } else {
          content[key] = value
        }
      }
      return editable
    },
    async save(saveOptions = {}) {
      const next = saveOptions.sort
        ? Object.fromEntries(
            Object.entries(content).sort(([a], [b]) => a.localeCompare(b)),
          )
        : content
      const output = `${JSON.stringify(next, null, indent)}\n`
      if (saveOptions.ignoreWhitespace && output.trim() === original.trim()) {
        return false
      }
      if (output === original) {
        return false
      }
      await fs.writeFile(filename, output)
      original = output
      return true
    },
  }
  return editable
}

function isValidPackageName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return false
  }
  if (name.startsWith('.') || name.startsWith('_') || name.trim() !== name) {
    return false
  }
  if (['node_modules', 'favicon.ico'].includes(name.toLowerCase())) {
    return false
  }
  if (encodeURIComponent(name) === name) {
    return true
  }

  const scopeMatch = /^(?:@([^/]+?)\/)?([^/]+?)$/.exec(name)
  if (!scopeMatch) {
    return false
  }
  const [, scope, packageName] = scopeMatch
  if (packageName.startsWith('.')) {
    return false
  }
  return (
    encodeURIComponent(scope ?? '') === (scope ?? '') &&
    encodeURIComponent(packageName) === packageName
  )
}

module.exports = { isValidPackageName, readPackageJson, readPackageJsonSync }
