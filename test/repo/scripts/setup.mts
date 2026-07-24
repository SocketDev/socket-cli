/**
 * @file Repo-specific vitest setup, wired via `setupFiles` in
 *   `.config/repo/vitest.config.mts` (loaded only when present; fleet-canonical
 *   setup lives in test/fleet/scripts/setup.mts). Injects the INLINED_* env
 *   values that esbuild's define step inlines into built artifacts — tests run
 *   from source, so modules that read process.env['INLINED_*'] at import time
 *   (e.g. packages/cli/src/constants/env.mts → env/coana-version.mts) would
 *   otherwise throw "process.env.INLINED_COANA_VERSION is empty at runtime".
 *   Values come from packages/cli/bundle-tools.json, the same source the build
 *   feeds esbuild, so source-run tests see the versions a real build would
 *   inline. Runs before each test file's imports in every worker, covering the
 *   root-config lanes (test --all, cover) that never load
 *   packages/cli/vitest.config.mts or packages/cli/test/setup.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { scrubAmbientSocketEnv } from '../_shared/lib/scrub-socket-env.mts'

// Drop ambient Socket credentials (developer shell tokens) so spawned CLI
// children resolve tokens from each test's --config override, matching the
// credential-free CI runners.
scrubAmbientSocketEnv()

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const bundleToolsPath = path.join(repoRoot, 'packages/cli/bundle-tools.json')

if (existsSync(bundleToolsPath)) {
  try {
    const tools = JSON.parse(readFileSync(bundleToolsPath, 'utf8')).tools as
      | Record<
          string,
          { version?: string | undefined; tag?: string | undefined }
        >
      | undefined
    const toolVersions: Record<string, string | undefined> = {
      INLINED_CDXGEN_VERSION: tools?.['@cyclonedx/cdxgen']?.version,
      INLINED_COANA_VERSION: tools?.['@coana-tech/cli']?.version,
      INLINED_CYCLONEDX_CDXGEN_VERSION: tools?.['@cyclonedx/cdxgen']?.version,
      INLINED_HOMEPAGE: 'https://github.com/SocketDev/socket-cli',
      INLINED_NAME: '@socketsecurity/cli',
      INLINED_OPENGREP_VERSION: tools?.['opengrep']?.version,
      INLINED_PUBLISHED_BUILD: '',
      INLINED_PYCLI_VERSION: tools?.['socketsecurity']?.version,
      INLINED_PYTHON_BUILD_TAG: tools?.['python']?.tag,
      INLINED_PYTHON_VERSION: tools?.['python']?.version,
      INLINED_SENTRY_BUILD: '',
      INLINED_SFW_VERSION: tools?.['sfw']?.version,
      INLINED_SOCKET_PATCH_VERSION: tools?.['socket-patch']?.version,
      INLINED_SYNP_VERSION: tools?.['synp']?.version,
      INLINED_TRIVY_VERSION: tools?.['trivy']?.version,
      INLINED_TRUFFLEHOG_VERSION: tools?.['trufflehog']?.version,
      INLINED_VERSION: '0.0.0-test',
      INLINED_VERSION_HASH: '0.0.0-test:abc1234:test',
    }
    for (const [key, value] of Object.entries(toolVersions)) {
      if (!process.env[key] && value) {
        process.env[key] = value
      }
    }
  } catch {
    // Ignore — packages/cli/test/setup.mts covers the package-config lane.
  }
}
