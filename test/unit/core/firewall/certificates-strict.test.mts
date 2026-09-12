import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import forge from 'node-forge'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createFirewallCertificateSerial,
  ensureFirewallCertificateAuthority,
  firewallAuthorityKeyIdentifier,
  loadFirewallCertificateAuthority,
} from '../../../../src/core/firewall/certificates.mts'
import type { FirewallCertificateAuthority } from '../../../../src/core/firewall/certificates.mts'
import {
  closeFirewallFixture,
  listenFirewallFixture,
} from './proxy-fixture.mts'

let directory: string
let certificatePath: string
let authority: FirewallCertificateAuthority
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-strict-ca-'))
  const paths = await ensureFirewallCertificateAuthority({ directory })
  certificatePath = paths.certificatePath
  authority = await loadFirewallCertificateAuthority(paths)
})
afterAll(async () => {
  await safeDelete(directory)
})

function readLeafAuthorityIdentifier(
  certificate: forge.pki.Certificate,
): string {
  const extension = certificate.getExtension('authorityKeyIdentifier') as {
    value: string
  }
  const sequence = forge.asn1.fromDer(extension.value)
  const identifier = (sequence.value as forge.asn1.Asn1[]).find(
    item =>
      item.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
      item.type === forge.asn1.Type.NONE,
  )
  return forge.util.bytesToHex(identifier!.value as string)
}

describe('firewall strict certificate verification', () => {
  it('issues distinct positive minimally encoded serials', () => {
    const serials = Array.from({ length: 100 }, createFirewallCertificateSerial)
    expect(new Set(serials).size).toBe(serials.length)
    for (let i = 0, { length } = serials; i < length; i += 1) {
      const serial = serials[i]!
      expect(serial).toHaveLength(32)
      expect(Number.parseInt(serial.slice(0, 2), 16)).toBeGreaterThan(0)
      expect(Number.parseInt(serial.slice(0, 2), 16)).toBeLessThan(128)
    }
  })
  it('identifies the actual issuer key and supplies leaf SKI and server authentication', async () => {
    const issuer = forge.pki.certificateFromPem(
      await readFile(certificatePath, 'utf8'),
    )
    const leaf = forge.pki.certificateFromPem(
      authority.issue('registry.example').cert,
    )
    const issuerIdentifier = (
      issuer.getExtension('subjectKeyIdentifier') as {
        subjectKeyIdentifier: string
      }
    ).subjectKeyIdentifier
    expect(readLeafAuthorityIdentifier(leaf)).toBe(issuerIdentifier)
    expect(
      (
        leaf.getExtension('subjectKeyIdentifier') as {
          subjectKeyIdentifier: string
        }
      ).subjectKeyIdentifier,
    ).not.toBe(issuerIdentifier)
    expect(leaf.getExtension('extKeyUsage')).toMatchObject({ serverAuth: true })
    issuer.extensions = issuer.extensions.filter(
      extension => extension.name !== 'subjectKeyIdentifier',
    )
    expect(firewallAuthorityKeyIdentifier(issuer)).toBe(
      issuer.generateSubjectKeyIdentifier().getBytes(),
    )
  })
  it('passes OpenSSL strict server verification', async () => {
    const leafPath = path.join(directory, 'leaf.pem')
    await writeFile(leafPath, authority.issue('registry.example').cert)
    const result = spawnSync('openssl', [
      'verify',
      '-x509_strict',
      '-purpose',
      'sslserver',
      '-verify_hostname',
      'registry.example',
      '-CAfile',
      certificatePath,
      leafPath,
    ])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  })
  it('passes Python strict TLS over a real local connection', async () => {
    const server = https.createServer(
      authority.issue('localhost'),
      (request, response) => response.end('artifact'),
    )
    const port = await listenFirewallFixture(server)
    try {
      const result = await spawn(
        'python3',
        [
          '-c',
          'import socket,ssl,sys; context=ssl.create_default_context(cafile=sys.argv[1]); context.verify_flags |= ssl.VERIFY_X509_STRICT; connection=context.wrap_socket(socket.create_connection(("127.0.0.1",int(sys.argv[2]))),server_hostname="localhost"); connection.sendall(b"GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n"); data=connection.recv(4096); connection.close(); sys.exit(0 if b"200 OK" in data else 1)',
          certificatePath,
          String(port),
        ],
        { timeout: 10_000 },
      )
      expect(result.code).toBe(0)
    } finally {
      await closeFirewallFixture(server)
    }
  })
})
