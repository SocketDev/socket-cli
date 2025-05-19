'use strict'

const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const { isValidPackageName } = require('@socketsecurity/registry/lib/packages')
const {
  isRelative,
  normalizePath,
} = require('@socketsecurity/registry/lib/path')

const { findUpSync } = require('./fs')

const { createRequire, isBuiltin } = Module

// eslint-disable-next-line no-control-regex
const cjsPluginPrefixRegExp = /^\x00/
const cjsPluginSuffixRegExp =
  /\?commonjs-(?:entry|es-import|exports|external|module|proxy|wrapped)$/

function getPackageName(string, start = 0) {
  const end = getPackageNameEnd(string, start)
  const name = string.slice(start, end)
  return isValidPackageName(name) ? name : ''
}

function getPackageNameEnd(string, start = 0) {
  if (isRelative(string)) {
    return 0
  }
  const firstSlashIndex = string.indexOf('/', start)
  if (firstSlashIndex === -1) {
    return string.length
  }
  if (string.charCodeAt(start) !== 64 /*'@'*/) {
    return firstSlashIndex
  }
  const secondSlashIndex = string.indexOf('/', firstSlashIndex + 1)
  return secondSlashIndex === -1 ? string.length : secondSlashIndex
}

function resolveId(id_, req = require) {
  const id = normalizeId(id_)
  let resolvedId
  if (typeof req === 'string') {
    try {
      req = createRequire(req)
    } catch {}
  }
  if (req !== require) {
    try {
      resolvedId = normalizePath(req.resolve(id))
    } catch {}
  }
  if (resolvedId === undefined) {
    try {
      resolvedId = normalizePath(require.resolve(id))
    } catch {}
  }
  if (resolvedId === undefined) {
    resolvedId = id
  }
  if (isValidPackageName(id)) {
    return resolvedId
  }
  const mtsId = `${resolvedId}.mts`
  return fs.existsSync(mtsId) ? mtsId : resolvedId
}

function isEsmId(id_, parentId_) {
  if (isBuiltin(id_)) {
    return false
  }
  const parentId = parentId_ ? resolveId(parentId_) : undefined
  const resolvedId = resolveId(id_, parentId)
  if (resolvedId.endsWith('.mjs') || resolvedId.endsWith('.mts')) {
    return true
  }
  if (
    resolvedId.endsWith('.cjs') ||
    resolvedId.endsWith('.json') ||
    resolvedId.endsWith('.ts')
  ) {
    return false
  }
  let filepath
  if (path.isAbsolute(resolvedId)) {
    filepath = resolvedId
  } else if (parentId && isRelative(resolvedId)) {
    filepath = path.join(path.dirname(parentId), resolvedId)
  }
  if (!filepath) {
    return false
  }
  const pkgJsonPath = findUpSync('package.json', {
    cwd: path.dirname(resolvedId),
  })
  if (pkgJsonPath) {
    const pkgJson = require(pkgJsonPath)
    const { exports: entryExports } = pkgJson
    if (
      pkgJson.type === 'module' &&
      !entryExports?.require &&
      !entryExports?.node?.require &&
      !entryExports?.node?.default?.endsWith?.('.cjs') &&
      !entryExports?.['.']?.require &&
      !entryExports?.['.']?.node?.require &&
      !entryExports?.['.']?.node?.default?.endsWith?.('.cjs') &&
      !entryExports?.['.']?.node?.default?.default?.endsWith?.('.cjs')
    ) {
      return true
    }
  }
  try {
    // eslint-disable-next-line no-new
    new vm.Script(fs.readFileSync(resolvedId, 'utf8'))
  } catch (e) {
    if (e instanceof SyntaxError) {
      return true
    }
  }
  return false
}

function normalizeId(id) {
  return normalizePath(id)
    .replace(cjsPluginPrefixRegExp, '')
    .replace(cjsPluginSuffixRegExp, '')
}

module.exports = {
  isBuiltin,
  isEsmId,
  getPackageName,
  getPackageNameEnd,
  normalizeId,
  resolveId,
}
