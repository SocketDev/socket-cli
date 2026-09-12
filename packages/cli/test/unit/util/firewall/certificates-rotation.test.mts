import { mkdtemp, readFile, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  getFirewallCertificatePaths,
  loadFirewallCertificateAuthority,
  rotateFirewallCertificateAuthority,
  withFirewallCertificateLock,
} from '../../../../src/util/firewall/certificates.mts'

vi.mock(import('node:fs/promises'), async importOriginal => {
  const original = await importOriginal()
  return { ...original, rename: vi.fn(original.rename) }
})
afterEach(() => vi.mocked(rename).mockClear())

describe('firewall certificate rotation', () => {
  it('keeps the original pair in a private backup and installs a matching new pair', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-rotation-'),
    )
    try {
      const paths = await ensureFirewallCertificateAuthority({ directory })
      const before = await readFile(paths.certificatePath, 'utf8')
      const rotated = await rotateFirewallCertificateAuthority({ directory })
      expect(getFirewallCertificatePaths(directory)).toEqual(paths)
      expect(await readFile(rotated.certificatePath, 'utf8')).not.toBe(before)
      expect(
        await readFile(
          getFirewallCertificatePaths(rotated.backupDirectory).certificatePath,
          'utf8',
        ),
      ).toBe(before)
      await expect(
        loadFirewallCertificateAuthority(rotated),
      ).resolves.toHaveProperty('certificate')
      await expect(
        loadFirewallCertificateAuthority(
          getFirewallCertificatePaths(rotated.backupDirectory),
        ),
      ).resolves.toHaveProperty('certificate')
    } finally {
      await safeDelete(directory)
    }
  })
  it('rejects concurrent initialization and rotation', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-rotation-'),
    )
    try {
      await withFirewallCertificateLock(directory, async () => {
        await expect(
          ensureFirewallCertificateAuthority({ directory }),
        ).rejects.toMatchObject({ code: 'ELOCKED' })
        await expect(
          rotateFirewallCertificateAuthority({ directory }),
        ).rejects.toMatchObject({ code: 'ELOCKED' })
      })
      await expect(
        ensureFirewallCertificateAuthority({ directory }),
      ).resolves.toMatchObject({
        certificatePath: path.join(directory, 'ca.crt'),
        keyPath: path.join(directory, 'ca.key'),
      })
    } finally {
      await safeDelete(directory)
    }
  })
  it('restores the original pair after a partial installation failure', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-rotation-'),
    )
    try {
      const paths = await ensureFirewallCertificateAuthority({ directory })
      const before = await readFile(paths.certificatePath, 'utf8')
      const originalRename = vi.mocked(rename).getMockImplementation()!
      let failed = false
      vi.mocked(rename).mockImplementation(async (source, destination) => {
        if (
          !failed &&
          String(source).includes('.ca-staging-') &&
          destination === paths.certificatePath
        ) {
          failed = true
          throw Object.assign(new Error('fixture rename failure'), {
            code: 'EIO',
          })
        }
        return await originalRename(source, destination)
      })
      try {
        await expect(
          rotateFirewallCertificateAuthority({ directory }),
        ).rejects.toMatchObject({ code: 'EIO' })
      } finally {
        vi.mocked(rename).mockImplementation(originalRename)
      }
      expect(failed).toBe(true)
      expect(await readFile(paths.certificatePath, 'utf8')).toBe(before)
      await expect(
        loadFirewallCertificateAuthority(paths),
      ).resolves.toHaveProperty('certificate')
    } finally {
      await safeDelete(directory)
    }
  })
})
