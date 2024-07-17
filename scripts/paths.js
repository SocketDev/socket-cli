'use strict'

const { search } = require('./strings')

const anySlashRegExp = /[\\/]/

function normalizePath(filePath) {
  const { length } = filePath
  if (length < 2) {
    return length === 1 && filePath.charCodeAt(0) === 92 /*'\\'*/
      ? '/'
      : filePath
  }

  let code = 0
  let collapsed = ''
  let start = 0

  // Ensure win32 namespaces have two leading slashes so they are handled properly
  // by path.win32.parse() after being normalized.
  // https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#namespaces
  let prefix = ''
  if (length > 4 && filePath.charCodeAt(3) === 92 /*'\\'*/) {
    const code2 = filePath.charCodeAt(2)
    // Look for \\?\ or \\.\
    if (
      (code2 === 63 /*'?'*/ || code2 === 46) /*'.'*/ &&
      filePath.charCodeAt(0) === 92 /*'\\'*/ &&
      filePath.charCodeAt(1) === 92 /*'\\'*/
    ) {
      start = 2
      prefix = '//'
    }
  }
  if (start === 0) {
    // Trim leading slashes
    while (
      ((code = filePath.charCodeAt(start)),
      code === 47 /*'/'*/ || code === 92) /*'\\'*/
    ) {
      start += 1
    }
    if (start) {
      prefix = '/'
    }
  }
  let nextIndex = search(filePath, anySlashRegExp, start)
  if (nextIndex === -1) {
    return prefix + filePath.slice(start)
  }
  // Discard any empty string segments by collapsing repeated segment separator slashes.
  while (nextIndex !== -1) {
    const segment = filePath.slice(start, nextIndex)
    collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
    start = nextIndex + 1
    while (
      ((code = filePath.charCodeAt(start)),
      code === 47 /*'/'*/ || code === 92) /*'\\'*/
    ) {
      start += 1
    }
    nextIndex = search(filePath, anySlashRegExp, start)
  }
  const lastSegment = filePath.slice(start)
  if (lastSegment.length !== 0) {
    collapsed = collapsed + '/' + lastSegment
  }
  return prefix + collapsed
}

module.exports = {
  normalizePath
}
