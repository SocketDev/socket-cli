import crypto from 'node:crypto'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../src/core/firewall/certificates.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('firewall certificates', () => {
  it('persists a restrictive CA and issues matching DNS and IP leaves', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-certificates-'),
    )
    try {
      const paths = await ensureFirewallCertificateAuthority({ directory })
      const first = await readFile(paths.certificatePath, 'utf8')
      expect(await ensureFirewallCertificateAuthority({ directory })).toEqual(
        paths,
      )
      expect(await readFile(paths.certificatePath, 'utf8')).toBe(first)
      const authority = await loadFirewallCertificateAuthority(paths)
      for (const hostname of ['registry.example', '127.0.0.1']) {
        const leaf = authority.issue(hostname)
        const certificate = new crypto.X509Certificate(leaf.cert)
        expect(
          certificate.verify(new crypto.X509Certificate(first).publicKey),
        ).toBe(true)
        expect(
          certificate.checkPrivateKey(crypto.createPrivateKey(leaf.key)),
        ).toBe(true)
        expect(certificate.ca).toBe(false)
        expect(authority.issue(hostname)).toBe(leaf)
      }
      await chmod(paths.keyPath, 0o644)
      await expect(loadFirewallCertificateAuthority(paths)).rejects.toThrow()
    } finally {
      await safeDelete(directory)
    }
  })
  it('refuses an incomplete persistent pair without overwriting it', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-certificates-'),
    )
    try {
      await writeFile(path.join(directory, 'ca.key'), 'incomplete fixture', {
        mode: 0o600,
      })
      await expect(
        ensureFirewallCertificateAuthority({ directory }),
      ).rejects.toThrow()
      expect(await readFile(path.join(directory, 'ca.key'), 'utf8')).toBe(
        'incomplete fixture',
      )
    } finally {
      await safeDelete(directory)
    }
  })
})

it('rejects unsafe directories, mismatched keys, and non-CA certificates', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'firewall-invalid-ca-'),
  )
  try {
    const first = await ensureFirewallCertificateAuthority({
      directory: path.join(directory, 'first'),
    })
    const second = await ensureFirewallCertificateAuthority({
      directory: path.join(directory, 'second'),
    })
    await expect(
      loadFirewallCertificateAuthority({
        certificatePath: first.certificatePath,
        keyPath: second.keyPath,
      }),
    ).rejects.toThrow()
    const future = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(3000, 0, 1))
    try {
      await expect(loadFirewallCertificateAuthority(first)).rejects.toThrow()
    } finally {
      future.mockRestore()
    }
    const authority = await loadFirewallCertificateAuthority(first)
    const leaf = authority.issue('registry.example')
    await writeFile(first.certificatePath, leaf.cert)
    await expect(loadFirewallCertificateAuthority(first)).rejects.toThrow()
    if (process.platform !== 'win32') {
      await chmod(path.join(directory, 'second'), 0o777)
      await expect(
        ensureFirewallCertificateAuthority({
          directory: path.join(directory, 'second'),
        }),
      ).rejects.toThrow()
    }
  } finally {
    await safeDelete(directory)
  }
})
