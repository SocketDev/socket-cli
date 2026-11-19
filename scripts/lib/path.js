'use strict'

const path = require('node:path')

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

module.exports = { isRelative, normalizePath }
