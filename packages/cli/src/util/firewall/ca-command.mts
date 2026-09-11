import { parseArgs } from 'node:util'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { readFirewallConfig } from './config.mts'
import {
  ensureFirewallCertificateAuthority,
  getFirewallCertificatePaths,
  loadFirewallCertificateAuthority,
  rotateFirewallCertificateAuthority,
} from './certificates.mts'
import { getFirewallTrustStore, installFirewallCaTrust } from './ca-trust.mts'
import type { FirewallEnvironment } from './environment.mts'
import type { FirewallCertificateAuthority } from './certificates.mts'

const logger = getDefaultLogger()

export const FIREWALL_CA_HELP = `Manage the Socket Firewall certificate authority.

Usage:
  socket sfw ca init [--force] [--json]
  socket sfw ca path [--json]
  socket sfw ca trust [--json]

init creates a persistent CA and preserves an existing valid pair.
init --force rotates the persistent pair and retains a backup.
path prints the certificate path after validating the pair.
trust installs the certificate when the terminal has administrator privileges.
Otherwise, trust prints the required system commands.
Service and registry modes are unavailable.`

export async function runFirewallCaCommand(
  args: readonly string[],
  options: {
    env?: FirewallEnvironment | undefined
    home?: string | undefined
  } = {},
): Promise<void> {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      json: { type: 'boolean', default: false },
      describe: { type: 'boolean', default: false },
    },
  })
  if (parsed.values.help || parsed.values.describe) {
    logger.stdout.write(
      parsed.values.json
        ? JSON.stringify({
            commands: ['init', 'path', 'trust'],
            description: FIREWALL_CA_HELP,
          }) + '\n'
        : FIREWALL_CA_HELP + '\n',
    )
    return
  }
  const command = parsed.positionals[0]
  validateFirewallCaArguments(parsed.positionals, {
    force: parsed.values.force,
  })
  const config = await readFirewallConfig(options)
  const explicit = Boolean(config.certificatePath)
  let paths = explicit
    ? { certificatePath: config.certificatePath!, keyPath: config.keyPath! }
    : getFirewallCertificatePaths(config.caDirectory)
  let backupDirectory: string | undefined
  if (command === 'init') {
    if (parsed.values.force) {
      if (explicit) {
        throw new Error(
          'CA rotation refused for an externally configured certificate pair. Expected a managed persistent CA. Clear SFW_CA_CERT_PATH and SFW_CA_KEY_PATH to rotate the managed pair.',
        )
      }
      const rotated = await rotateFirewallCertificateAuthority({
        directory: config.caDirectory,
      })
      paths = rotated
      backupDirectory = rotated.backupDirectory
    } else if (!explicit) {
      paths = await ensureFirewallCertificateAuthority({
        directory: config.caDirectory,
      })
    }
  }
  const authority = await loadFirewallCertificateAuthority(paths)
  if (command === 'trust') {
    await trustFirewallAuthority(paths.certificatePath, authority)
  }
  writeFirewallCaResult({
    command: command!,
    certificatePath: paths.certificatePath,
    backupDirectory,
    json: parsed.values.json,
  })
}

export async function trustFirewallAuthority(
  certificatePath: string,
  authority: FirewallCertificateAuthority,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-firewall-verify-'),
  )
  try {
    const verifyCertificatePath = path.join(directory, 'localhost.crt')
    await writeFile(verifyCertificatePath, authority.issue('localhost').cert, {
      mode: 0o600,
      flag: 'wx',
    })
    await installFirewallCaTrust(
      getFirewallTrustStore({
        certificatePath,
        certificate: authority.certificate,
        verifyCertificatePath,
      }),
    )
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
}

export function validateFirewallCaArguments(
  positionals: string[],
  options: { force?: boolean | undefined } = {},
): void {
  const opts = { __proto__: null, ...options } as typeof options
  if (
    positionals.length !== 1 ||
    !['init', 'path', 'trust'].includes(positionals[0] ?? '') ||
    (opts.force && positionals[0] !== 'init')
  ) {
    throw new Error(
      'Invalid CA command at socket sfw ca. Expected init [--force], path, or trust. Run socket sfw ca --help.',
    )
  }
}

export function writeFirewallCaResult(result: {
  command: string
  certificatePath: string
  backupDirectory?: string | undefined
  json?: boolean | undefined
}): void {
  const { command, certificatePath, backupDirectory, json } = result
  logger.stdout.write(
    json
      ? JSON.stringify({
          command,
          certificatePath,
          backupDirectory,
        }) + '\n'
      : command === 'path'
        ? `${certificatePath}\n`
        : `Socket Firewall CA ${command === 'trust' ? 'trusted' : 'ready'}: ${certificatePath}\n${backupDirectory ? `Backup: ${backupDirectory}\n` : ''}`,
  )
}
