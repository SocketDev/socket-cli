/**
 * Path helpers adapted from @socketsecurity/registry/lib/path.js.
 * Copyright (c) 2024 Socket Inc. Licensed under the MIT License.
 */

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const slashRegExp = /[/\\]/

function pathLikeToString(pathLike: string | Buffer | URL | unknown): string {
  if (typeof pathLike === 'string') {
    return pathLike
  }
  if (Buffer.isBuffer(pathLike)) {
    return pathLike.toString('utf8')
  }
  if (pathLike instanceof URL) {
    return fileURLToPath(pathLike)
  }
  return String(pathLike)
}

export function isPath(pathLike: unknown): boolean {
  return isRelative(pathLike) || path.isAbsolute(pathLike as string)
}

function isRelative(pathLike: unknown): boolean {
  const filepath = pathLikeToString(pathLike)
  const { length } = filepath
  if (length === 0) {
    return false
  }
  if (filepath.charCodeAt(0) === 46 /* . */) {
    if (length === 1) {
      return true
    }
    let code = filepath.charCodeAt(1)
    if (code === 46 /* . */) {
      code = filepath.charCodeAt(2)
    }
    return code === 47 /* / */ || code === 92 /* \\ */
  }
  return false
}

export function normalizePath(pathLike: string | Buffer | URL): string {
  const filepath = pathLikeToString(pathLike)
  const { length } = filepath
  if (length < 2) {
    return length === 1 && filepath.charCodeAt(0) === 92 /* \\ */
      ? '/'
      : filepath
  }

  let code = 0
  let collapsed = ''
  let start = 0
  let prefix = ''
  if (length > 4 && filepath.charCodeAt(3) === 92 /* \\ */) {
    const code2 = filepath.charCodeAt(2)
    if (
      (code2 === 63 /* ? */ || code2 === 46) /* . */ &&
      filepath.charCodeAt(0) === 92 /* \\ */ &&
      filepath.charCodeAt(1) === 92 /* \\ */
    ) {
      start = 2
      prefix = '//'
    }
  }
  if (start === 0) {
    while (((code = filepath.charCodeAt(start)), code === 47 || code === 92)) {
      start += 1
    }
    if (start) {
      prefix = '/'
    }
  }
  let nextIndex = filepath.slice(start).search(slashRegExp)
  if (nextIndex === -1) {
    return prefix + filepath.slice(start)
  }
  nextIndex += start
  while (nextIndex !== -1) {
    const segment = filepath.slice(start, nextIndex)
    collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
    start = nextIndex + 1
    while (((code = filepath.charCodeAt(start)), code === 47 || code === 92)) {
      start += 1
    }
    const found = filepath.slice(start).search(slashRegExp)
    nextIndex = found === -1 ? -1 : start + found
  }
  const lastSegment = filepath.slice(start)
  if (lastSegment.length !== 0) {
    collapsed = collapsed + '/' + lastSegment
  }
  return prefix + collapsed
}
