/** @fileoverview Vitest setup file for test utilities. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Disable debug output during tests
process.env.DEBUG = ''
delete process.env.NODE_DEBUG

// Load inlined environment variables from external-tools.json.
// These are normally inlined at build time by esbuild, but tests run from source.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '..', 'external-tools.json')

if (existsSync(externalToolsPath)) {
  try {
    const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8'))

    // Set inlined environment variables if not already set.
    const toolVersions: Record<string, string | undefined> = {
      INLINED_SOCKET_CLI_CDXGEN_VERSION:
        externalTools['@cyclonedx/cdxgen']?.version,
      INLINED_SOCKET_CLI_COANA_VERSION:
        externalTools['@coana-tech/cli']?.version,
      INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION:
        externalTools['@cyclonedx/cdxgen']?.version,
      INLINED_SOCKET_CLI_HOMEPAGE: 'https://github.com/SocketDev/socket-cli',
      INLINED_SOCKET_CLI_NAME: '@socketsecurity/cli',
      INLINED_SOCKET_CLI_OPENGREP_VERSION: externalTools['opengrep']?.version,
      INLINED_SOCKET_CLI_PUBLISHED_BUILD: '',
      INLINED_SOCKET_CLI_PYCLI_VERSION:
        externalTools['socketsecurity']?.version,
      INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: externalTools['python']?.buildTag,
      INLINED_SOCKET_CLI_PYTHON_VERSION: externalTools['python']?.version,
      INLINED_SOCKET_CLI_SENTRY_BUILD: '',
      INLINED_SOCKET_CLI_SFW_VERSION: externalTools['sfw']?.version,
      INLINED_SOCKET_CLI_SOCKET_PATCH_VERSION:
        externalTools['socket-patch']?.version,
      INLINED_SOCKET_CLI_SYNP_VERSION: externalTools['synp']?.version,
      INLINED_SOCKET_CLI_TRIVY_VERSION: externalTools['trivy']?.version,
      INLINED_SOCKET_CLI_TRUFFLEHOG_VERSION:
        externalTools['trufflehog']?.version,
      INLINED_SOCKET_CLI_VERSION: '0.0.0-test',
      INLINED_SOCKET_CLI_VERSION_HASH: '0.0.0-test:abc1234:test',
    }

    for (const [key, value] of Object.entries(toolVersions)) {
      if (!process.env[key] && value) {
        process.env[key] = value
      }
    }
  } catch {
    // Ignore errors loading external-tools.json.
  }
}
