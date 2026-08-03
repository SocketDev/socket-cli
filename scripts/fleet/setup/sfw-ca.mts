#!/usr/bin/env node
/**
 * @file `setup:sfw-ca` — create the PERSISTENT Socket Firewall CA so non-Node
 *   clients stop failing TLS.
 *   sfw mints a brand-new CA into a fresh temp dir on every invocation unless
 *   `SFW_CA_CERT_PATH` + `SFW_CA_KEY_PATH` both point at files that already
 *   exist. An ephemeral CA can never be added to an OS trust store, so any
 *   client with its own TLS stack — pnpm's Rust tarball fetcher, cargo, uv, go,
 *   git — fails `UnknownIssuer` the moment it downloads something not already
 *   cached. This step generates the stable pair ONCE; the wrapper generator and
 *   the shell-rc bridge export the env pair at it (guarded on existence), and
 *   `sfw-ca-env-is-wired` keeps that wiring from rotting.
 *   Generation goes through openssl with the exact subject + extensions the
 *   firewall's own generator uses (`docs/Generating-Keys.md`,
 *   `src/lib/util/genCaKeyPair.ts`) — no hand-rolled X.509.
 *   Idempotent: a second run regenerates nothing and re-reports the trust
 *   verdict. `--force` is the only way to replace an existing pair. The private
 *   key is written 0600 and its bytes are never printed. Adding the cert to the
 *   OS trust store needs root, so this step PRINTS that command and stops —
 *   running it is the operator's call.
 *   Usage: pnpm run setup:sfw-ca [--force]
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  getSfwBinaryPath,
  getSfwCaCertPath,
  getSfwCaDir,
  getSfwCaKeyPath,
  probeSfwCaDelivery,
  SFW_CA_BASENAME,
  SFW_CA_COMMON_NAME,
  SFW_CA_INERT_REASON,
  SFW_CA_SUBJECT,
  sfwCaTrustCommandLines,
  sfwCaTrustProbe,
} from '../../../.claude/hooks/fleet/_shared/sfw-ca.mts'
import { resolveEcosystemOptions } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type { SfwCaDelivery } from '../../../.claude/hooks/fleet/_shared/sfw-ca.mts'
import type {
  EcosystemStepOptions,
  EcosystemStepResult,
  RunCommand,
} from './ecosystems.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const mainLogger = getDefaultLogger()

const STEP = 'setup:sfw-ca'

/**
 * How much of a CA pair is on disk. `partial` is the state that must fail loud:
 * sfw silently ignores a half pair and falls back to a throwaway CA, so a
 * missing key looks identical to no setup at all.
 */
export type SfwCaPairState = 'absent' | 'complete' | 'partial'

/**
 * Seams + overrides for the step. The two path overrides let the tests drive
 * every branch against a real temp dir instead of the user's home.
 */
export interface SfwCaStepOptions extends EcosystemStepOptions {
  readonly caCertPath?: string | undefined
  readonly caKeyPath?: string | undefined
  readonly force?: boolean | undefined
}

/**
 * The openssl config that carries the CA extensions. Written to a temp file
 * because the firewall's documented one-liner uses a bash process substitution
 * (`-config <(cat <<EOF …)`), and this step spawns openssl directly — no shell,
 * so no process substitution.
 */
export function sfwCaOpensslConfig(): string {
  return `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca

[req_distinguished_name]

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign
subjectKeyIdentifier = hash
`
}

/**
 * The `openssl genrsa` argv for the CA private key. 2048-bit RSA matches the
 * firewall generator's default.
 */
export function sfwCaGenKeyArgs(keyPath: string): string[] {
  return ['genrsa', '-out', keyPath, '2048']
}

/**
 * The `openssl req` argv for the self-signed CA certificate: one year of
 * validity, the firewall's subject, and the `v3_ca` extension block.
 */
export function sfwCaGenCertArgs(
  keyPath: string,
  certPath: string,
  configPath: string,
): string[] {
  return [
    'req',
    '-new',
    '-x509',
    '-key',
    keyPath,
    '-out',
    certPath,
    '-days',
    '365',
    '-subj',
    SFW_CA_SUBJECT,
    '-extensions',
    'v3_ca',
    '-config',
    configPath,
  ]
}

/**
 * Parse the step's CLI flags. `--force` is the only way past the
 * refuse-to-clobber guard.
 */
export function parseSfwCaArgs(argv: readonly string[]): {
  force: boolean
  help: boolean
} {
  return {
    force: argv.includes('--force'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

/**
 * The `--help` text. Leads with the inert-state caveat: an operator who reads
 * only the first paragraph must not walk away believing the CA is in use.
 */
export function sfwCaHelpText(): string {
  return `${STEP} — create the persistent Socket Firewall CA.

Usage:
  pnpm run setup:sfw-ca [--force]

Options:
  --force    Replace an existing pair. Any OS trust entry for the old cert
             goes stale. Without it an existing pair is kept untouched.
  --help     Show this text.

What it does:
  Generates ${SFW_CA_BASENAME}.{crt,key} under the wheelhouse CA dir via openssl,
  with the subject and extensions the firewall's own generator uses. Key 0600,
  cert 0644. Idempotent — a second run regenerates nothing.

  It then asks sfw which CA it actually hands a wrapped child, and prints the
  OS-trust command ONLY when sfw is using this pair.

Current limitation:
  A persistent CA has NO EFFECT until a firewall build honors SFW_CA_CERT_PATH.
  Today ${SFW_CA_INERT_REASON}.
  The pair and the env wiring are correct and start working the moment such a
  build is racked; until then this step reports INERT and withholds the
  OS-trust step, because trusting a root the proxy never signs with does nothing.`
}

/**
 * Which half of the pair is on disk.
 */
export function readSfwCaPairState(
  certPath: string,
  keyPath: string,
): SfwCaPairState {
  const hasCert = existsSync(certPath)
  const hasKey = existsSync(keyPath)
  if (hasCert && hasKey) {
    return 'complete'
  }
  if (hasCert || hasKey) {
    return 'partial'
  }
  return 'absent'
}

/**
 * True when the OS trust probe reports a matching certificate. `security
 * find-certificate` exits 0 whether or not it finds anything on some macOS
 * builds, so the certificate name in stdout — not the exit code — is the
 * signal.
 */
export function isSfwCaTrustedOutput(stdout: string): boolean {
  return stdout.includes(SFW_CA_COMMON_NAME) || stdout.includes('keychain:')
}

/**
 * Ask the OS whether the CA is already a trusted root. `undefined` means this
 * platform has no scriptable probe, which is reported as unknown — never as
 * trusted.
 */
export async function probeSfwCaTrust(
  platform: NodeJS.Platform,
  runCommand: RunCommand,
): Promise<boolean | undefined> {
  const probe = sfwCaTrustProbe(platform)
  if (!probe) {
    return undefined
  }
  const result = await runCommand(probe.command, probe.args, { silent: true })
  if (result.exitCode !== 0) {
    return false
  }
  return isSfwCaTrustedOutput(result.stdout)
}

/**
 * Print the trust verdict plus, when the cert is not yet a trusted root, the
 * exact command the operator runs. The command is never executed here — it
 * needs root, and a setup step does not get to take sudo.
 */
export function reportSfwCaTrust(
  logger: { log: (...args: unknown[]) => void },
  platform: NodeJS.Platform,
  certPath: string,
  options?:
    | { delivery?: SfwCaDelivery | undefined; trusted?: boolean | undefined }
    | undefined,
): void {
  // An absent `trusted` means the same as an explicit undefined: this platform
  // has no OS trust probe, so the state is unknown rather than untrusted.
  const { delivery, trusted } = { __proto__: null, ...options } as {
    delivery?: SfwCaDelivery | undefined
    trusted?: boolean | undefined
  }
  // Trusting a root the proxy never signs with buys nothing, so the sudo step
  // is withheld until a probe proves sfw actually hands children this cert.
  if (delivery !== undefined && delivery !== 'persistent') {
    logger.log(
      `${STEP} — OS-trust step withheld: sfw is not using this CA yet (see above).`,
    )
    return
  }
  if (trusted === true) {
    logger.log(
      `${STEP} — already a trusted root in the OS store. Nothing to do.`,
    )
    return
  }
  if (trusted === undefined) {
    logger.log(
      `${STEP} — no OS trust probe on ${platform}; trust state unknown.`,
    )
  } else {
    logger.log(`${STEP} — NOT yet a trusted root in the OS store.`)
  }
  logger.log('')
  logger.log('  Run this yourself to finish (needs root):')
  logger.log('')
  for (const line of sfwCaTrustCommandLines(platform, certPath)) {
    logger.log(line === '' ? '' : `    ${line}`)
  }
  logger.log('')
}

/**
 * Say plainly that the CA is not in use, and why. Printed whenever a persistent
 * pair exists but sfw hands children something else — the state the fleet must
 * never report as a success.
 */
export function reportSfwCaDelivery(
  logger: {
    log: (...args: unknown[]) => void
    warn: (...a: unknown[]) => void
  },
  delivery: SfwCaDelivery,
): void {
  if (delivery === 'persistent') {
    logger.log(`${STEP} — sfw is handing children this CA. The wiring is live.`)
    return
  }
  if (delivery === 'unknown') {
    logger.warn(
      `${STEP} — could not ask sfw which CA it hands children; treat the wiring as unverified.`,
    )
    return
  }
  logger.warn(`${STEP} — INERT: sfw is NOT using this CA.`)
  logger.warn(
    `  Where: the racked sfw binary at ${getSfwBinaryPath()}, wrapper mode.`,
  )
  logger.warn(
    '  Saw: the wrapped child received a fresh temp-dir CA; wanted the persistent pair.',
  )
  logger.warn(`  Why: ${SFW_CA_INERT_REASON}.`)
  logger.warn(
    '  Fix: none on this side — the pair stays correct and starts working the',
  )
  logger.warn(
    '  moment a firewall build that honors SFW_CA_CERT_PATH is racked.',
  )
}

/**
 * Generate the CA pair with openssl and lock down its permissions. The key is
 * mode 0600 because anyone holding it can impersonate the proxy; the cert is
 * mode 0644 because every client must read it. Both openssl calls run silent —
 * the captured output is surfaced only on failure, and neither writes key bytes
 * to stdout.
 */
export async function generateSfwCaPair(
  certPath: string,
  keyPath: string,
  runCommand: RunCommand,
): Promise<string | undefined> {
  const configDir = path.join(os.tmpdir(), `sfw-ca-${process.pid}`)
  const configPath = path.join(configDir, 'openssl.cnf')
  mkdirSync(configDir, { mode: 0o700, recursive: true })
  writeFileSync(configPath, sfwCaOpensslConfig(), { mode: 0o600 })
  try {
    const keyResult = await runCommand('openssl', sfwCaGenKeyArgs(keyPath), {
      silent: true,
    })
    if (keyResult.exitCode !== 0) {
      return `openssl genrsa exited ${keyResult.exitCode}: ${keyResult.stderr.trim()}`
    }
    chmodSync(keyPath, 0o600)
    const certResult = await runCommand(
      'openssl',
      sfwCaGenCertArgs(keyPath, certPath, configPath),
      { silent: true },
    )
    if (certResult.exitCode !== 0) {
      return `openssl req exited ${certResult.exitCode}: ${certResult.stderr.trim()}`
    }
    chmodSync(certPath, 0o644)
    return undefined
  } finally {
    safeDeleteSync(configDir)
  }
}

/**
 * Create (or report) the persistent Socket Firewall CA.
 */
export async function setupSfwCa(
  options?: SfwCaStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const opts = { __proto__: null, ...options } as SfwCaStepOptions
  const { commandExists, logger, platform, runCommand } =
    resolveEcosystemOptions(opts)
  const certPath = opts.caCertPath ?? getSfwCaCertPath()
  const keyPath = opts.caKeyPath ?? getSfwCaKeyPath()
  const force = opts.force === true

  if (!(await commandExists('openssl'))) {
    logger.fail(
      `${STEP}: openssl is not on PATH, so the CA cannot be generated.\n` +
        `  Where: PATH lookup for 'openssl' on this ${platform} machine.\n` +
        '  Saw: no openssl executable; wanted openssl 1.1+ or 3.x.\n' +
        '  Fix: install it (macOS: brew install openssl; Debian: apt install openssl), then re-run pnpm run setup:sfw-ca.',
    )
    return { ok: false, reason: 'openssl missing', skipped: false }
  }

  const state = readSfwCaPairState(certPath, keyPath)

  if (state === 'partial') {
    logger.fail(
      `${STEP}: the CA pair is half present, which sfw silently ignores.\n` +
        `  Where: ${path.dirname(certPath)}.\n` +
        `  Saw: cert ${existsSync(certPath) ? 'present' : 'missing'}, key ${existsSync(keyPath) ? 'present' : 'missing'}; wanted both or neither.\n` +
        '  Fix: delete the leftover file, or re-run pnpm run setup:sfw-ca --force to regenerate both.',
    )
    return { ok: false, reason: 'half CA pair', skipped: false }
  }

  if (state === 'complete' && !force) {
    logger.log(`${STEP} — CA already present, keeping it.`)
    logger.log(`  cert: ${certPath}`)
    logger.log(`  key:  ${keyPath} (private, never printed)`)
    const delivery = await probeSfwCaDelivery(certPath, runCommand)
    reportSfwCaDelivery(logger, delivery)
    const trusted = await probeSfwCaTrust(platform, runCommand)
    reportSfwCaTrust(logger, platform, certPath, { delivery, trusted })
    return { ok: true, reason: 'CA already present', skipped: false }
  }

  if (state === 'complete') {
    logger.warn(`${STEP} — --force: replacing the existing CA pair.`)
    logger.warn(
      '  Any OS trust store entry for the OLD cert is now stale; re-run the trust command below.',
    )
  }

  mkdirSync(getSfwCaDirFor(certPath), { mode: 0o700, recursive: true })
  const failure = await generateSfwCaPair(certPath, keyPath, runCommand)
  if (failure) {
    logger.fail(
      `${STEP}: openssl could not generate the CA pair.\n` +
        `  Where: ${path.dirname(certPath)}.\n` +
        `  Saw: ${failure}; wanted a 2048-bit RSA key plus a self-signed '${SFW_CA_COMMON_NAME}' certificate.\n` +
        '  Fix: read the openssl error above, then re-run pnpm run setup:sfw-ca --force.',
    )
    return { ok: false, reason: 'openssl generation failed', skipped: false }
  }

  logger.success(`${STEP} — persistent CA generated.`)
  logger.log(`  cert: ${certPath} (0644)`)
  logger.log(`  key:  ${keyPath} (0600, private, never printed)`)
  logger.log(
    '  Wrappers + the shell-rc block export SFW_CA_CERT_PATH / SFW_CA_KEY_PATH at these paths.',
  )
  const delivery = await probeSfwCaDelivery(certPath, runCommand)
  reportSfwCaDelivery(logger, delivery)
  const trusted = await probeSfwCaTrust(platform, runCommand)
  reportSfwCaTrust(logger, platform, certPath, { delivery, trusted })
  return { ok: true, skipped: false }
}

/**
 * The directory a CA file belongs to. Falls back to the canonical CA dir when
 * the path has no parent, so a bare filename override in a test still lands
 * somewhere real.
 */
export function getSfwCaDirFor(certPath: string): string {
  const dir = path.dirname(certPath)
  return dir === '.' ? getSfwCaDir() : dir
}

if (isMainModule(import.meta.url)) {
  const { force, help } = parseSfwCaArgs(process.argv.slice(2))
  if (help) {
    mainLogger.log(sfwCaHelpText())
    process.exitCode = 0
  } else {
    setupSfwCa({ force }).then(
      result => {
        if (!result.ok) {
          process.exitCode = 1
        }
      },
      (e: unknown) => {
        mainLogger.error(errorMessage(e))
        process.exitCode = 1
      },
    )
  }
}
