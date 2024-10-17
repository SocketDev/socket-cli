'use strict'

const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const normalizePackageData = require('normalize-package-data')
const validatePackageName = require('validate-npm-package-name')

const { normalizePath, isRelative } = require('./path')
const { findUpSync } = require('./fs')

const { createRequire, isBuiltin } = Module

const PACKAGE_JSON = 'package.json'

const cjsPluginPrefixRegExp = /^\x00/
const cjsPluginSuffixRegExp =
  /\?commonjs-(?:entry|es-import|exports|external|module|proxy|wrapped)$/

function getPackageName(string, start = 0) {
  const end = getPackageNameEnd(string, start)
  return end === string.length ? string : string.slice(0, end)
}

function getPackageNameEnd(string, start = 0) {
  const firstSlashIndex = string.indexOf('/', start)
  if (firstSlashIndex === -1) return string.length
  if (string.charCodeAt(start) !== 64 /*'@'*/) return firstSlashIndex
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
  if (isPackageName(id)) {
    return resolvedId
  }
  const tsId = `${resolvedId}.ts`
  return fs.existsSync(tsId) ? tsId : resolvedId
}

function isPackageName(id) {
  return validatePackageName(id).validForOldPackages
}

function isEsmId(id_, parentId_) {
  if (isBuiltin(id_)) {
    return false
  }
  const parentId = parentId_ ? resolveId(parentId_) : undefined
  const resolvedId = resolveId(id_, parentId)
  let result = false
  if (resolvedId.endsWith('.mjs')) {
    result = true
  } else if (
    !resolvedId.endsWith('.cjs') &&
    !resolvedId.endsWith('.json') &&
    !resolvedId.endsWith('.ts')
  ) {
    let filepath
    if (path.isAbsolute(resolvedId)) {
      filepath = resolvedId
    } else if (parentId && isRelative(resolvedId)) {
      filepath = path.join(path.dirname(parentId), resolvedId)
    }
    if (filepath) {
      const pkgJsonPath = findUpSync('package.json', {
        cwd: path.dirname(resolvedId)
      })
      if (pkgJsonPath && require(pkgJsonPath)?.type === 'module') {
        return true
      }
      try {
        new vm.Script(fs.readFileSync(resolvedId, 'utf8'))
      } catch (e) {
        if (e instanceof SyntaxError) {
          result = true
        }
      }
    }
  }
  return result
}

function normalizeId(id) {
  return normalizePath(id)
    .replace(cjsPluginPrefixRegExp, '')
    .replace(cjsPluginSuffixRegExp, '')
}

function normalizePackageJson(pkgJson) {
  normalizePackageData(pkgJson)
  return pkgJson
}

function readPackageJsonSync(filepath_) {
  const filepath = filepath_.endsWith(PACKAGE_JSON)
    ? filepath_
    : path.join(filepath_, PACKAGE_JSON)
  return normalizePackageJson(JSON.parse(fs.readFileSync(filepath, 'utf8')))
}

module.exports = {
  isBuiltin,
  isEsmId,
  isPackageName,
  getPackageName,
  getPackageNameEnd,
  normalizeId,
  normalizePackageJson,
  readPackageJsonSync,
  resolveId
}
