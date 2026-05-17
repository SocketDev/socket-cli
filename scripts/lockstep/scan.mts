/**
 * @fileoverview File-tree walker + regex matcher for the feature-parity
 * scorer.
 *
 * `walkDirFiles` is a depth-first walker that ignores the usual noise
 * directories (`node_modules`, `.git`, `dist`). `countPatternHits` is the
 * regex-scoring loop the feature-parity check uses to compute the code
 * and test pillars.
 *
 * Invalid manifest regexes log a warning instead of throwing, so one bad
 * pattern doesn't sink an otherwise-clean lockstep run.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

export function walkDirFiles(dir: string, extRe: RegExp): string[] {
  const files: string[] = []
  if (!existsSync(dir)) {
    return files
  }
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: string[] = []
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
        continue
      }
      const full = path.join(current, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (stat.isFile() && extRe.test(entry)) {
        files.push(full)
      }
    }
  }
  return files
}

export function countPatternHits(files: string[], patterns: string[]): number {
  if (patterns.length === 0) {
    return 0
  }
  // Manifest authors occasionally land a bad regex; surface the bad
  // pattern and keep going rather than throwing a SyntaxError that
  // kills the whole run.
  const compiled: RegExp[] = []
  for (const p of patterns) {
    try {
      compiled.push(new RegExp(p))
    } catch (e) {
      logger.warn(
        `lockstep: skipping invalid regex ${JSON.stringify(p)}: ${errorMessage(e)}`,
      )
    }
  }
  let hits = 0
  for (const pat of compiled) {
    for (const file of files) {
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (pat.test(content)) {
        hits += 1
        break
      }
    }
  }
  return hits
}
