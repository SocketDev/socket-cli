#!/usr/bin/env node
/*
 * @file `check --all` gate: the headroom proxy is started fully lossless.
 *   headroom's default `token` mode is LOSSY via two layers that abbreviate
 *   content and garble proper nouns (paths, package names, identifiers) in large
 *   tool reads, which is silently wrong for a coding agent: CCR
 *   context-compression (off via `--lossless`) and the Kompress ML compressor
 *   (off via `--disable-kompress`; MEASURED as the proper-noun abbreviator).
 *   The headroom-proxy-start hook's `PROXY_ARGS` must carry BOTH flags; this gate
 *   fails if either is dropped. Vacuous in a repo that doesn't ship the hook.
 *
 *   Usage: node scripts/fleet/check/headroom-proxy-is-lossless.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const HOOK = path.join(
  REPO_ROOT,
  '.claude/hooks/fleet/headroom-proxy-start/index.mts',
)

// The proxy flags that together force verbatim (lossless) compression.
export const REQUIRED_PROXY_FLAGS = [
  '--disable-kompress',
  '--lossless',
] as const

// The REQUIRED_PROXY_FLAGS absent from the `PROXY_ARGS` array literal (empty =
// all present). A flag mentioned outside the literal does not count.
export function missingProxyFlags(source: string): string[] {
  // oxlint-disable-next-line socket/no-source-sniffing -- this check's sole purpose is scanning source text for PROXY_ARGS literal presence.
  const match = source.match(/const PROXY_ARGS\s*=\s*\[([\s\S]*?)]/)
  if (!match) {
    return [...REQUIRED_PROXY_FLAGS]
  }
  const body = match[1] ?? ''
  return REQUIRED_PROXY_FLAGS.filter(
    flag => !new RegExp(`(['"])${flag}\\1`).test(body),
  )
}

export function main(): number {
  const quiet = process.argv.includes('--quiet')
  // Vacuous pass when the hook isn't present (a repo without headroom).
  if (!existsSync(HOOK)) {
    if (!quiet) {
      logger.log(
        'headroom-proxy-is-lossless: no headroom-proxy-start hook (n/a).',
      )
    }
    return 0
  }
  const missing = missingProxyFlags(readFileSync(HOOK, 'utf8'))
  if (missing.length) {
    logger.fail(
      `headroom-proxy-is-lossless: PROXY_ARGS is missing ${missing.join(', ')}.`,
    )
    logger.group()
    logger.error(`where: ${HOOK} (PROXY_ARGS)`)
    logger.error(
      'saw:   proxy args without the lossless flags (token mode is LOSSY)',
    )
    logger.error(
      'want:  --lossless AND --disable-kompress for verbatim tool reads',
    )
    logger.error('fix:   add the missing flag(s) to the PROXY_ARGS array')
    logger.groupEnd()
    return 1
  }
  if (!quiet) {
    logger.log('headroom-proxy-is-lossless: proxy starts fully lossless.')
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
