import { readFileSync } from 'node:fs'
import { rootCertificates } from 'node:tls'

import { debugFn } from '@socketsecurity/registry/lib/debug'

import constants from '../constants.mts'

// Cached extra CA certificates for SSL_CERT_FILE support.
let extraCaCerts: string[] | undefined
let extraCaCertsResolved = false

// Node reads NODE_EXTRA_CA_CERTS only at process start. If only SSL_CERT_FILE
// is set, pass the extra certificates to each outbound TLS agent explicitly.
export function getExtraCaCerts(): string[] | undefined {
  if (extraCaCertsResolved) {
    return extraCaCerts
  }
  extraCaCertsResolved = true
  if (process.env['NODE_EXTRA_CA_CERTS']) {
    return undefined
  }
  const certPath = constants.ENV.NODE_EXTRA_CA_CERTS
  if (!certPath) {
    return undefined
  }
  try {
    const extraCerts = readFileSync(certPath, 'utf-8')
    extraCaCerts = [...rootCertificates, extraCerts]
    return extraCaCerts
  } catch (error) {
    debugFn('warn', `Failed to read certificate file: ${certPath}`, error)
    return undefined
  }
}
