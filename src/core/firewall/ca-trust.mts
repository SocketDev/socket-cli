import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  buildSystemToolEnv,
  findSystemTool,
} from '../../util/spawn/system-tool.mts'
import { safeProcessEnv } from '@socketsecurity/lib-stable/env/rewire'

export function formatFirewallTrustCommand(
  command: FirewallTrustCommand,
  platform: NodeJS.Platform = process.platform,
): string {
  return [command.executable, ...command.args]
    .map(value => {
      if (platform === 'win32') {
        return `'${value.replaceAll("'", "''")}'`
      }
      return `'${value.replaceAll("'", "'\\''")}'`
    })
    .join(' ')
}

export interface FirewallTrustCommand {
  executable: string
  args: string[]
}

export interface FirewallTrustStore {
  certificate: string
  certificatePath: string
  label: string
  commands: FirewallTrustCommand[]
  check: FirewallTrustCommand | undefined
  anchor: string | undefined
  fingerprint: string
  verify: FirewallTrustCommand
}

export function getFirewallTrustStore(config: {
  certificatePath: string
  certificate: string
  verifyCertificatePath: string
  platform?: NodeJS.Platform | undefined
  exists?: ((filename: string) => boolean) | undefined
}): FirewallTrustStore {
  const platform = config.platform ?? process.platform
  const exists = config.exists ?? existsSync
  const certificate = new crypto.X509Certificate(config.certificate)
  const fingerprint = certificate.fingerprint256.replaceAll(':', '')
  const common = {
    certificate: certificate.toString(),
    certificatePath: config.certificatePath,
    fingerprint,
    anchor: undefined,
    check: undefined,
  }
  if (platform === 'darwin') {
    const keychain = '/Library/Keychains/System.keychain'
    return {
      ...common,
      label: 'macOS system keychain',
      verify: {
        executable: '/usr/bin/security',
        args: [
          'verify-cert',
          '-L',
          '-k',
          keychain,
          '-p',
          'ssl',
          '-n',
          'localhost',
          '-c',
          config.verifyCertificatePath,
        ],
      },
      commands: [
        {
          executable: '/usr/bin/security',
          args: [
            'add-trusted-cert',
            '-d',
            '-r',
            'trustRoot',
            '-k',
            keychain,
            config.certificatePath,
          ],
        },
      ],
      check: {
        executable: '/usr/bin/security',
        args: ['find-certificate', '-a', '-Z', keychain],
      },
    }
  }
  if (platform === 'win32') {
    return {
      ...common,
      label: 'Windows LocalMachine Root store',
      verify: {
        executable: 'certutil.exe',
        args: [
          '-verify',
          '-sslpolicy',
          'localhost',
          config.verifyCertificatePath,
        ],
      },
      fingerprint: certificate.fingerprint.replaceAll(':', ''),
      commands: [
        {
          executable: 'certutil.exe',
          args: ['-addstore', 'Root', config.certificatePath],
        },
      ],
      check: {
        executable: 'certutil.exe',
        args: ['-store', 'Root', certificate.fingerprint.replaceAll(':', '')],
      },
    }
  }
  if (platform === 'linux') {
    const redhat = '/etc/pki/ca-trust/source/anchors'
    const debian = '/usr/local/share/ca-certificates'
    const directory = exists(redhat)
      ? redhat
      : exists(debian)
        ? debian
        : undefined
    if (directory) {
      const anchor = path.join(directory, 'socket-firewall.crt')
      return {
        ...common,
        anchor,
        label: 'Linux system trust store',
        verify: {
          executable: '/usr/bin/openssl',
          args: [
            'verify',
            '-trusted',
            directory === redhat
              ? '/etc/pki/tls/certs/ca-bundle.crt'
              : '/etc/ssl/certs/ca-certificates.crt',
            '-purpose',
            'sslserver',
            '-verify_hostname',
            'localhost',
            config.verifyCertificatePath,
          ],
        },
        commands: [
          {
            executable: '/bin/cp',
            args: ['--', config.certificatePath, anchor],
          },
          {
            executable:
              directory === redhat
                ? '/usr/bin/update-ca-trust'
                : '/usr/sbin/update-ca-certificates',
            args: [],
          },
        ],
      }
    }
  }
  throw new Error(
    `Unsupported firewall trust store on ${platform}. Expected macOS, Windows, or a configured Linux CA store. Install the CA with your system trust manager.`,
  )
}

export async function installFirewallCaTrust(
  store: FirewallTrustStore,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (await isFirewallCaTrusted(store)) {
    return
  }
  const elevated =
    platform === 'win32'
      ? (
          await runFirewallTrustCommand({
            executable: 'powershell.exe',
            args: [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'try { $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [System.Security.Principal.WindowsPrincipal]::new($identity); if ($principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 }; exit 1 } catch { exit 1 }',
            ],
          })
        ).status === 0
      : process.getuid?.() === 0
  if (!elevated) {
    const commands = store.commands
      .map(
        command =>
          `${platform === 'win32' ? '& ' : 'sudo '}${formatFirewallTrustCommand(command, platform)}`,
      )
      .join('\n')
    throw new Error(
      `Firewall CA is not trusted in the ${store.label}. Expected administrator privileges. Run these commands from an administrator terminal:\n${commands}`,
    )
  }
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-firewall-trust-install-'),
  )
  try {
    const certificatePath = path.join(directory, 'ca.crt')
    await writeFile(certificatePath, store.certificate, {
      flag: 'wx',
      mode: 0o600,
    })
    for (const command of store.commands) {
      const result = await runFirewallTrustCommand({
        executable: command.executable,
        args: command.args.map(arg =>
          arg === store.certificatePath ? certificatePath : arg,
        ),
      })
      if (result.status !== 0) {
        throw new Error(
          `Firewall CA installation failed in the ${store.label}. Expected exit 0; received ${result.status ?? result.signal}. Check administrator permissions and retry ca trust.`,
          { cause: result.error },
        )
      }
    }
    if (!(await isFirewallCaTrusted(store))) {
      throw new Error(
        `Firewall CA verification failed in the ${store.label}. Expected a trusted localhost server certificate chain. Check the system trust manager and retry ca trust.`,
      )
    }
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
}

export async function isFirewallCaTrusted(
  store: FirewallTrustStore,
): Promise<boolean> {
  let present = false
  if (store.anchor) {
    try {
      const contents = readFileSync(store.anchor)
      try {
        present =
          new crypto.X509Certificate(contents).fingerprint256.replaceAll(
            ':',
            '',
          ) === store.fingerprint
      } catch {
        return false
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false
      }
      throw error
    }
  } else if (store.check) {
    const result = await runFirewallTrustCommand(store.check)
    present =
      result.status === 0 &&
      (result.stdout ?? '')
        .replaceAll(':', '')
        .replaceAll(' ', '')
        .toUpperCase()
        .includes(store.fingerprint)
  }
  return present && (await runFirewallTrustCommand(store.verify)).status === 0
}

export async function runFirewallTrustCommand(command: FirewallTrustCommand) {
  const resolution = await findSystemTool(command.executable)
  if (!resolution) {
    throw new Error(
      `Firewall trust command unavailable: ${command.executable}. Expected a trusted system executable. Install the system certificate tools.`,
    )
  }
  const env = {
    ...buildSystemToolEnv(safeProcessEnv() ?? {}, resolution.searchPath),
  }
  const untrustedOverrides = new Set([
    'CURL_CA_BUNDLE',
    'NODE_EXTRA_CA_CERTS',
    'OPENSSL_CONF',
    'OPENSSL_ENGINES',
    'OPENSSL_MODULES',
    'REQUESTS_CA_BUNDLE',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
  ])
  const keys = Object.keys(env)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (untrustedOverrides.has(key.toUpperCase())) {
      delete env[key]
    }
  }
  return spawnSync(resolution.executable, command.args, {
    encoding: 'utf8',
    shell: false,
    env,
  })
}
