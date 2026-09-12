import crypto from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, open, rename } from 'node:fs/promises'
import path from 'node:path'
import { isIP } from 'node:net'

import forge from 'node-forge'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

export function createFirewallCertificateSerial(): string {
  const bytes = crypto.randomBytes(16)
  bytes[0] = bytes[0]! & 0x7f || 1
  return bytes.toString('hex')
}

export async function ensureFirewallCertificateAuthority(config: {
  directory: string
}): Promise<{ certificatePath: string; keyPath: string }> {
  const opts = { __proto__: null, ...config } as typeof config
  await prepareFirewallCertificateDirectory(opts.directory)
  return await withFirewallCertificateLock(opts.directory, async () => {
    const { certificatePath, keyPath } = getFirewallCertificatePaths(
      opts.directory,
    )
    const exists = await Promise.all(
      [certificatePath, keyPath].map(async certificateFilePath => {
        try {
          await access(certificateFilePath)
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false
          }
          throw error
        }
      }),
    )
    if (exists.every(Boolean)) {
      await loadFirewallCertificateAuthority({ certificatePath, keyPath })
      return { __proto__: null, certificatePath, keyPath }
    }
    if (exists.some(Boolean)) {
      throw new Error(
        'Incomplete firewall CA pair: expected both certificate and private key. Repair certificate setup.',
      )
    }
    const keys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const certificate = forge.pki.createCertificate()
    certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey)
    certificate.serialNumber = createFirewallCertificateSerial()
    certificate.validity.notBefore = new Date(Date.now() - 60_000)
    certificate.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
    certificate.setSubject([
      { name: 'commonName', value: 'Socket Firewall Local CA' },
    ])
    certificate.setIssuer(certificate.subject.attributes)
    certificate.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ])
    certificate.sign(
      forge.pki.privateKeyFromPem(keys.privateKey),
      forge.md.sha256.create(),
    )
    const keyFile = await open(keyPath, 'wx', 0o600)
    try {
      await keyFile.writeFile(keys.privateKey)
      await keyFile.sync()
    } finally {
      await keyFile.close()
    }
    const certificateFile = await open(certificatePath, 'wx', 0o600)
    try {
      await certificateFile.writeFile(forge.pki.certificateToPem(certificate))
      await certificateFile.sync()
    } finally {
      await certificateFile.close()
    }
    return { __proto__: null, certificatePath, keyPath }
  })
}

export function firewallAuthorityKeyIdentifier(
  certificate: forge.pki.Certificate,
): string {
  const extension = certificate.getExtension('subjectKeyIdentifier') as
    | { subjectKeyIdentifier?: string | undefined }
    | undefined
  return extension?.subjectKeyIdentifier
    ? forge.util.hexToBytes(extension.subjectKeyIdentifier)
    : certificate.generateSubjectKeyIdentifier().getBytes()
}

export function getFirewallCertificatePaths(directory: string): {
  certificatePath: string
  keyPath: string
} {
  return {
    certificatePath: path.join(directory, 'ca.crt'),
    keyPath: path.join(directory, 'ca.key'),
  }
}

export async function loadFirewallCertificateAuthority(config: {
  certificatePath: string
  keyPath: string
}): Promise<FirewallCertificateAuthority> {
  const opts = { __proto__: null, ...config } as typeof config
  const { 0: certificate, 1: key } = await Promise.all([
    readFirewallCertificateFile(opts.certificatePath),
    readFirewallCertificateFile(opts.keyPath, true),
  ])
  const authority = new crypto.X509Certificate(certificate)
  const now = Date.now()
  if (
    !authority.ca ||
    Date.parse(authority.validFrom) > now ||
    Date.parse(authority.validTo) <= now ||
    !authority.checkPrivateKey(crypto.createPrivateKey(key))
  ) {
    throw new Error(
      'Invalid firewall certificate authority: expected a valid CA and matching private key. Run firewall certificate setup.',
    )
  }
  const signingKey = forge.pki.privateKeyFromPem(key)
  const issuer = forge.pki.certificateFromPem(certificate)
  const leafKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const cache = new Map<string, FirewallCertificate>()
  return {
    certificate,
    issue(hostname) {
      const cached = cache.get(hostname)
      if (cached) {
        return cached
      }
      const leaf = forge.pki.createCertificate()
      leaf.publicKey = forge.pki.publicKeyFromPem(leafKeys.publicKey)
      leaf.serialNumber = createFirewallCertificateSerial()
      leaf.validity.notBefore = new Date(Date.now() - 60_000)
      leaf.validity.notAfter = new Date(
        Math.min(Date.now() + 86_400_000, Date.parse(authority.validTo)),
      )
      leaf.setSubject([{ name: 'commonName', value: hostname }])
      leaf.setIssuer(issuer.subject.attributes)
      leaf.setExtensions([
        { name: 'basicConstraints', cA: false, critical: true },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectKeyIdentifier' },
        {
          name: 'authorityKeyIdentifier',
          keyIdentifier: firewallAuthorityKeyIdentifier(issuer),
        },
        {
          name: 'subjectAltName',
          altNames: [
            isIP(hostname)
              ? { type: 7, ip: hostname }
              : { type: 2, value: hostname },
          ],
        },
      ])
      leaf.sign(signingKey, forge.md.sha256.create())
      const result = {
        cert: forge.pki.certificateToPem(leaf),
        key: leafKeys.privateKey,
      }
      if (cache.size >= 256) {
        cache.delete(cache.keys().next().value!)
      }
      cache.set(hostname, result)
      return result
    },
  }
}

export async function prepareFirewallCertificateDirectory(
  directoryPath: string,
): Promise<void> {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 })
  const directory = await lstat(directoryPath)
  if (
    !directory.isDirectory() ||
    (process.platform !== 'win32' &&
      ((directory.mode & 0o022) !== 0 || directory.uid !== process.getuid?.()))
  ) {
    throw new Error(
      'Unsafe firewall CA directory: expected an owned directory without group or other write permission. Repair directory permissions.',
    )
  }
}

export type FirewallCertificate = { cert: string; key: string }
export type FirewallCertificateAuthority = {
  certificate: string
  issue: (hostname: string) => FirewallCertificate
}

export async function readFirewallCertificateFile(
  certificateFilePath: string,
  privateFile = false,
): Promise<string> {
  const file = await open(
    certificateFilePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  try {
    // Validate ownership, permissions, and size from the opened descriptor.
    // oxlint-disable-next-line socket/prefer-exists-sync -- Metadata required.
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.size > 1024 * 1024 ||
      (privateFile &&
        process.platform !== 'win32' &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    ) {
      throw new Error(
        'Invalid firewall certificate file: use a regular PEM file and restrict private key permissions to 0600.',
      )
    }
    return await file.readFile('utf8')
  } finally {
    await file.close()
  }
}

export async function rotateFirewallCertificateAuthority(config: {
  directory: string
}): Promise<{
  certificatePath: string
  keyPath: string
  backupDirectory: string
}> {
  const opts = { __proto__: null, ...config } as typeof config
  await prepareFirewallCertificateDirectory(opts.directory)
  return await withFirewallCertificateLock(opts.directory, async () => {
    const paths = getFirewallCertificatePaths(opts.directory)
    const stagingDirectory = await mkdtemp(
      path.join(opts.directory, '.ca-staging-'),
    )
    const backupDirectory = await mkdtemp(
      path.join(opts.directory, '.ca-backup-'),
    )
    const backup = getFirewallCertificatePaths(backupDirectory)
    const moved: Array<{ original: string; backup: string }> = []
    const installed: string[] = []
    try {
      const staging = await ensureFirewallCertificateAuthority({
        directory: stagingDirectory,
      })
      for (const key of ['certificatePath', 'keyPath'] as const) {
        if (existsSync(paths[key])) {
          await rename(paths[key], backup[key])
          moved.push({ original: paths[key], backup: backup[key] })
        }
      }
      for (const key of ['keyPath', 'certificatePath'] as const) {
        await rename(staging[key], paths[key])
        installed.push(paths[key])
      }
      await loadFirewallCertificateAuthority(paths)
      return { __proto__: null, ...paths, backupDirectory }
    } catch (error) {
      const failures: unknown[] = [error]
      const installedPaths = installed.toReversed()
      for (let i = 0, { length } = installedPaths; i < length; i += 1) {
        const installedPath = installedPaths[i]!
        try {
          await safeDelete(installedPath)
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
      }
      const originals = moved.toReversed()
      for (let i = 0, { length } = originals; i < length; i += 1) {
        const original = originals[i]!
        try {
          await rename(original.backup, original.original)
        } catch (restoreError) {
          failures.push(restoreError)
        }
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'Firewall CA rotation failed and rollback needs repair. The backup directory retains recoverable files.',
        )
      }
      throw error
    } finally {
      await safeDelete(stagingDirectory)
    }
  })
}

export async function withFirewallCertificateLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(directory, '.ca-lock')
  try {
    await mkdir(lockPath, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw Object.assign(
        new Error(
          'Firewall CA setup is already active in this directory. Wait for setup to finish before retrying.',
        ),
        { code: 'ELOCKED' },
      )
    }
    throw error
  }
  try {
    return await operation()
  } finally {
    await safeDelete(lockPath)
  }
}
