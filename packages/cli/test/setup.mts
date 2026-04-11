/** @fileoverview Vitest setup file for test utilities. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Disable debug output during tests
process.env.DEBUG = ''
delete process.env.NODE_DEBUG

// Load inlined environment variables from bundle-tools.json.
// These are normally inlined at build time by esbuild, but tests run from source.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '..', 'bundle-tools.json')

if (existsSync(externalToolsPath)) {
  try {
    const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8'))

    // Set inlined environment variables if not already set.
    // All tools now use 'version' field. GitHub-released tools also have optional 'tag'.
    const toolVersions: Record<string, string | undefined> = {
      INLINED_CDXGEN_VERSION:
        externalTools['@cyclonedx/cdxgen']?.version,
      INLINED_COANA_VERSION:
        externalTools['@coana-tech/cli']?.version,
      INLINED_CYCLONEDX_CDXGEN_VERSION:
        externalTools['@cyclonedx/cdxgen']?.version,
      INLINED_HOMEPAGE: 'https://github.com/SocketDev/socket-cli',
      INLINED_NAME: '@socketsecurity/cli',
      INLINED_OPENGREP_VERSION:
        externalTools['opengrep']?.version,
      INLINED_PUBLISHED_BUILD: '',
      INLINED_PYCLI_VERSION:
        externalTools['socketsecurity']?.version,
      INLINED_PYTHON_BUILD_TAG: externalTools['python']?.tag,
      INLINED_PYTHON_VERSION:
        externalTools['python']?.version,
      INLINED_SENTRY_BUILD: '',
      INLINED_SFW_NPM_VERSION: externalTools['sfw']?.npm?.version,
      INLINED_SFW_VERSION: externalTools['sfw']?.version,
      INLINED_SOCKET_PATCH_VERSION:
        externalTools['socket-patch']?.version,
      INLINED_SYNP_VERSION: externalTools['synp']?.version,
      INLINED_TRIVY_VERSION: externalTools['trivy']?.version,
      INLINED_TRUFFLEHOG_VERSION:
        externalTools['trufflehog']?.version,
      INLINED_VERSION: '0.0.0-test',
      INLINED_VERSION_HASH: '0.0.0-test:abc1234:test',
    }

    for (const [key, value] of Object.entries(toolVersions)) {
      if (!process.env[key] && value) {
        process.env[key] = value
      }
    }
  } catch {
    // Ignore errors loading bundle-tools.json.
  }
}
