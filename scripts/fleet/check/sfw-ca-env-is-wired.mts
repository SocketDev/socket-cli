#!/usr/bin/env node
/*
 * @file Fleet check — the persistent Socket Firewall CA env pair stays wired
 *   into every surface that hands an environment to a package manager.
 *
 *   sfw regenerates a throwaway CA into a fresh temp dir on every invocation
 *   unless `SFW_CA_CERT_PATH` + `SFW_CA_KEY_PATH` both point at files that
 *   already exist. A throwaway CA can never be added to an OS trust store, so
 *   every client carrying its own TLS stack — pnpm's Rust tarball fetcher,
 *   cargo, uv, go, git — fails `UnknownIssuer` on any download that is not
 *   already cached. Node clients hide the bug because sfw also injects
 *   `NODE_EXTRA_CA_CERTS`. The wiring that fixes it is easy to drop silently in
 *   a wrapper-generator refactor, and the failure only shows up on a cache
 *   miss, so it gets a gate.
 *
 *   Three legs:
 *
 *   1. SOURCE (always runs, hard gate — this is what CI enforces). The dep-0
 *      wrapper generator `scripts/fleet/setup/tools-sfw.mjs` inlines the CA
 *      shell fragment because it runs before node_modules exists and cannot
 *      import a `.mts`. This leg calls the generator and asserts the inlined
 *      block is byte-identical to the canonical
 *      `.claude/hooks/fleet/_shared/sfw-ca.mts` builder, on POSIX and Windows,
 *      and that the shell-rc bridge's managed block carries it too. It also
 *      asserts the HOME-relative dir the shell fragment hardcodes still agrees
 *      with the absolute path `getSfwCaDir()` resolves.
 *
 *   2. MACHINE (this box only). The generated wrappers in
 *      `~/.socket/_wheelhouse/bin` must carry the exports — a wrapper generated
 *      before this wiring landed is stale and silently unprotected. Absent
 *      wrappers are reported as a LOUD SKIP: CI has none, and a skip must never
 *      read as a pass. (The wrappers live under the wheelhouse umbrella; the CA
 *      pair itself lives at `~/.socket/sfw`, where the firewall reads it.)
 *
 *   3. DELIVERY (this box only). Correct wiring is not the same as a working
 *      mechanism: sfw can read the env pair, ignore it, and overwrite it in the
 *      child. This leg asks what CA a wrapped child ACTUALLY receives
 *      (`probeSfwCaDelivery`). A persistent pair on disk while the child still
 *      gets a temp-dir CA is a hard FAILURE, not a pass — a gate that goes
 *      green while the mechanism does nothing is exactly the false green the
 *      fleet forbids. A missing pair or a missing sfw binary is a LOUD SKIP.
 *
 *   Exit codes: 0 — every leg that could run passed; 1 — a drifted source
 *   fragment, a stale generated wrapper, or an inert CA.
 *
 *   Usage: node scripts/fleet/check/sfw-ca-env-is-wired.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketWheelhouseBinDir } from '@socketsecurity/lib-stable/paths/socket'

import { buildBlockBody } from '../../../.claude/hooks/fleet/setup-security-tools/lib/shell-rc-bridge.mts'
import {
  getSfwBinaryPath,
  getSfwCaCertPath,
  getSfwCaDir,
  getSfwCaKeyPath,
  judgeSfwCaDelivery,
  probeSfwCaDelivery,
  SFW_CA_ENV_NAMES,
  SFW_CA_HOME_RELATIVE_DIR,
  sfwCaPosixExportLines,
  sfwCaWindowsExportLines,
} from '../../../.claude/hooks/fleet/_shared/sfw-ca.mts'
import { defaultRunCommand } from '../setup/ecosystems.mts'
import {
  posixRealShimLines,
  windowsRealShimLines,
} from '../setup/tools-sfw.mjs'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// A placeholder token for buildBlockBody — the bridge only interpolates it into
// an `export SOCKET_API_KEY=…` line, nothing is written to disk here, and only
// the surrounding block SHAPE is compared.
//
// It keeps the real `sktsec_` prefix so the probe exercises a realistically
// shaped value, and carries the fleet's canonical fake-token marker
// (`socket-test-fake-token`, FAKE_TOKEN_MARKER in
// .git-hooks/_shared/scan-secrets.mts) so `isAllowedApiKey` exempts it. That is
// the sanctioned way to ship a token-shaped literal: name it with the marker
// every scanner already recognizes, rather than inventing a one-off spelling
// each gate has to learn.
const PROBE_TOKEN = 'sktsec_socket-test-fake-token'

/**
 * True when `block` appears in `lines` as a contiguous run, in order. Substring
 * matching would pass on a fragment that got split across an `if` the shell no
 * longer reaches, so the whole guarded block has to survive intact.
 */
export function containsLineBlock(
  lines: readonly string[],
  block: readonly string[],
): boolean {
  if (block.length === 0) {
    return true
  }
  for (let i = 0; i + block.length <= lines.length; i += 1) {
    let matched = true
    for (let j = 0; j < block.length; j += 1) {
      if (lines[i + j] !== block[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      return true
    }
  }
  return false
}

/**
 * True when a generated wrapper is a REAL-tool wrapper rather than a
 * not-installed stub. Only real wrappers hand an environment to a package
 * manager, so only they need the CA pair.
 */
export function isRealToolWrapper(content: string): boolean {
  return content.includes('SFW_UNKNOWN_HOST_ACTION')
}

/**
 * The generated wrappers on this machine that are missing the CA env pair.
 * Basenames, sorted, so the failure names exactly what to regenerate.
 */
export function findWrappersMissingCaEnv(binDir: string): string[] {
  const missing: string[] = []
  const entries = readdirSync(binDir).toSorted()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const abs = path.join(binDir, entry)
    let content: string
    try {
      if (!statSync(abs).isFile()) {
        continue
      }
      content = readFileSync(abs, 'utf8')
    } catch {
      // A dangling symlink or an unreadable entry is not a wiring defect.
      continue
    }
    if (isRealToolWrapper(content) && !content.includes(SFW_CA_ENV_NAMES[0])) {
      missing.push(entry)
    }
  }
  return missing
}

/**
 * The source-leg failures: one message per surface that lost the CA fragment.
 * Pure over the generators it calls, so the test drives it directly.
 */
export function findSourceWiringFailures(): string[] {
  const failures: string[] = []
  const posixBlock = sfwCaPosixExportLines()
  const windowsBlock = sfwCaWindowsExportLines()

  const posixShim = posixRealShimLines('pnpm', '/sfw', '/real/pnpm')
  if (!containsLineBlock(posixShim, posixBlock)) {
    failures.push(
      'scripts/fleet/setup/tools-sfw.mjs posixRealShimLines() no longer emits the canonical CA block',
    )
  }

  const windowsShim = windowsRealShimLines(
    'pnpm',
    'C:\\sfw.exe',
    'C:\\pnpm.exe',
  )
  if (!containsLineBlock(windowsShim, windowsBlock)) {
    failures.push(
      'scripts/fleet/setup/tools-sfw.mjs windowsRealShimLines() no longer emits the canonical CA block',
    )
  }

  const rcBlock = buildBlockBody(PROBE_TOKEN).split('\n')
  if (!containsLineBlock(rcBlock, posixBlock)) {
    failures.push(
      '.claude/hooks/fleet/setup-security-tools/lib/shell-rc-bridge.mts buildBlockBody() no longer emits the canonical CA block',
    )
  }

  const absoluteDir = normalizePath(getSfwCaDir())
  if (!absoluteDir.endsWith(`/${SFW_CA_HOME_RELATIVE_DIR}`)) {
    failures.push(
      `getSfwCaDir() resolves to ${absoluteDir}, which no longer ends in the SFW_CA_HOME_RELATIVE_DIR the shell fragment hardcodes (${SFW_CA_HOME_RELATIVE_DIR})`,
    )
  }

  return failures
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const failures = findSourceWiringFailures()
  const skips: string[] = []

  const binDir = getSocketWheelhouseBinDir()
  if (existsSync(binDir)) {
    const stale = findWrappersMissingCaEnv(binDir)
    if (stale.length > 0) {
      failures.push(
        `${stale.length} generated wrapper(s) in ${binDir} predate the CA wiring: ${stale.join(', ')}`,
      )
    }
  } else {
    skips.push(
      `no generated wrappers at ${binDir} — machine leg not checked (expected in CI)`,
    )
  }

  // The delivery leg. Wiring the env pair correctly and sfw HONORING it are two
  // different facts; only the second one makes the CA do anything, so only the
  // second one may turn this check green.
  const certPath = getSfwCaCertPath()
  const sfwBin = getSfwBinaryPath()
  const pairPresent = existsSync(certPath) && existsSync(getSfwCaKeyPath())
  const sfwBinPresent = existsSync(sfwBin)
  const delivery =
    pairPresent && sfwBinPresent
      ? await probeSfwCaDelivery(certPath, defaultRunCommand, { sfwBin })
      : undefined
  const deliveryLeg = judgeSfwCaDelivery({
    certPath,
    delivery,
    pairPresent,
    sfwBin,
    sfwBinPresent,
  })
  if (deliveryLeg.kind === 'fail') {
    failures.push(deliveryLeg.message)
  } else if (deliveryLeg.kind === 'skip') {
    skips.push(deliveryLeg.message)
  }

  for (let i = 0, { length } = skips; i < length; i += 1) {
    logger.warn(`[sfw-ca-env-is-wired] SKIPPED: ${skips[i]}`)
  }

  if (failures.length === 0) {
    if (!quiet) {
      const legs =
        skips.length > 0 ? 'source leg' : 'source + machine + delivery legs'
      logger.success(`Socket Firewall CA env pair is wired (${legs}).`)
    }
    return
  }

  logger.fail(
    `[sfw-ca-env-is-wired] ${failures.length} problem(s) with the persistent CA:`,
  )
  logger.log('')
  for (let i = 0, { length } = failures; i < length; i += 1) {
    logger.log(`  ✗ ${failures[i]}`)
  }
  logger.log('')
  logger.log(
    '  Why it matters: unless sfw hands a wrapped child the PERSISTENT pair, it',
  )
  logger.log(
    '  mints a throwaway CA per run, and pnpm/cargo/uv/go fail TLS with',
  )
  logger.log('  UnknownIssuer on any package they have not already cached.')
  logger.log(
    '  Fix (source):  re-emit sfwCaPosixExportLines() / sfwCaWindowsExportLines()',
  )
  logger.log(
    '                 from .claude/hooks/fleet/_shared/sfw-ca.mts in the surface above.',
  )
  logger.log(
    '  Fix (machine): node scripts/fleet/setup/tools.mjs   (regenerates the wrappers)',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`sfw-ca-env-is-wired check failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
