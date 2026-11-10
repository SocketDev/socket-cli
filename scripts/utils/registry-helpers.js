'use strict'

/*
 * Narrow build-time copies of methods previously imported from
 * @socketsecurity/registry 1.1.17. Copyright (c) Socket Inc., MIT License.
 * Keep this file limited to the exact methods consumed by Rollup scripts.
 */

const { spawn, spawnSync: spawnSyncRaw } = require('node:child_process')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')

function envAsBoolean(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '1' || trimmed.toLowerCase() === 'true'
  }
  return value == null ? false : !!value
}

const ansiRegExp =
  // eslint-disable-next-line no-control-regex -- The expression removes ANSI control codes.
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C)|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripAnsi(value) {
  return String(value).replace(ansiRegExp, '')
}

function normalizePath(value) {
  const source = Buffer.isBuffer(value)
    ? value.toString()
    : value instanceof URL
      ? value.pathname
      : String(value)
  if (source.length < 2) {
    return source === '\\' ? '/' : source
  }
  const unc = source.startsWith('\\\\') || source.startsWith('//')
  const normalized = path.posix.normalize(source.replaceAll('\\', '/'))
  return unc && !normalized.startsWith('//') ? `/${normalized}` : normalized
}

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
    source = await require('node:fs/promises').readFile(filename, 'utf8')
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
      await require('node:fs/promises').writeFile(filename, output)
      original = output
      return true
    },
  }
  return editable
}

function fetchPackageManifest(spec) {
  const result = spawnSyncRaw('npm', ['view', spec, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `npm view ${spec} failed: ${stripAnsi(result.stderr || '').trim()}`,
    )
  }
  const response = JSON.parse(String(result.stdout || 'null'))
  const version =
    Array.isArray(response) && response.length === 1 ? response[0] : response
  if (typeof version !== 'string' || !version) {
    throw new Error(`npm view ${spec} did not return a version`)
  }
  return { name: spec.slice(0, spec.lastIndexOf('@')) || spec, version }
}

function spawnSync(command, args, options = {}) {
  const result = spawnSyncRaw(command, args, {
    ...options,
    encoding: options.encoding ?? 'utf8',
  })
  if (typeof result.stdout === 'string') {
    result.stdout = result.stdout.trim()
  }
  if (typeof result.stderr === 'string') {
    result.stderr = result.stderr.trim()
  }
  return result
}

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal })
      } else {
        reject(
          Object.assign(new Error(`${command} exited with ${code ?? signal}`), {
            code,
            signal,
          }),
        )
      }
    })
  })
}

function isDirEmptySync(directory) {
  try {
    const ignored = new Set([
      '.git',
      '.npmrc',
      'node_modules',
      '.DS_Store',
      '.gitignore',
      '.hg',
      '.lock-wscript',
      '.npmignore',
      '.svn',
      '.env',
      '.eslintcache',
      '.nvm',
      '.tap',
      '.vscode',
      'Thumbs.db',
      'bower_components',
    ])
    return readdirSync(directory).every(
      name =>
        ignored.has(name) ||
        name.startsWith('.wafpickle-') ||
        name.startsWith('._') ||
        /^\..*\.swp$/.test(name) ||
        /^.*\.orig$/.test(name) ||
        /^.*\.tsbuildinfo$/.test(name),
    )
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

function hasKeys(value) {
  return value != null && Object.keys(value).length > 0
}

let naturalCompareFn
function naturalCompare(a, b) {
  naturalCompareFn ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  }).compare
  return naturalCompareFn(a, b)
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

function isRelative(value) {
  return (
    typeof value === 'string' &&
    (value === '.' ||
      value.startsWith('./') ||
      value.startsWith('../') ||
      value.startsWith('.\\') ||
      value.startsWith('..\\'))
  )
}

module.exports = {
  escapeRegExp,
  envAsBoolean,
  fetchPackageManifest,
  hasKeys,
  isDirEmptySync,
  isRelative,
  isValidPackageName,
  naturalCompare,
  normalizePath,
  readPackageJson,
  readPackageJsonSync,
  spawnAsync,
  spawnSync,
  stripAnsi,
}
