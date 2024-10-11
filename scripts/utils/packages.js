'use strict'

const fs = require('node:fs')
const Module = require('node:module')
const vm = require('node:vm')

const normalizePackageData = require('normalize-package-data')
const validatePackageName = require('validate-npm-package-name')

const { normalizePath } = require('./path')

const { createRequire, isBuiltin } = Module

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
      resolvedId = req.resolve(id)
    } catch {}
  }
  if (resolvedId === undefined) {
    try {
      resolvedId = require.resolve(id)
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

const memoizeIsPackageName = new Map()

function isPackageName(id) {
  const memResult = memoizeIsPackageName.get(id)
  if (memResult !== undefined) return memResult
  const result = validatePackageName(id).validForOldPackages
  memoizeIsPackageName.set(id, result)
  return result
}

const memoizeIsEsmId = new Map()

function isEsmId(id_, parentId_) {
  if (isBuiltin(id_)) {
    return false
  }
  const parentId = parentId_ ? resolveId(parentId_) : undefined
  const resolvedId = resolveId(id_, parentId)
  const memKey = `${resolvedId}|${parentId}`
  const memResult = memoizeIsEsmId.get(memKey)
  if (memResult !== undefined) return memResult
  let result = false
  if (resolvedId.endsWith('.mjs')) {
    result = true
  } else if (
    !resolvedId.endsWith('.cjs') &&
    !resolvedId.endsWith('.json') &&
    !resolvedId.endsWith('.ts')
  ) {
    try {
      new vm.Script(fs.readFileSync(resolvedId, 'utf8'))
    } catch (e) {
      if (e instanceof SyntaxError) {
        result = true
      }
    }
  }
  memoizeIsEsmId.set(memKey, result)
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

module.exports = {
  isBuiltin,
  isEsmId,
  isPackageName,
  getPackageName,
  getPackageNameEnd,
  normalizeId,
  normalizePackageJson,
  resolveId
}
