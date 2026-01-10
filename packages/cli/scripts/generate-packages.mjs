/**
 * Generate template-based packages required for CLI build.
 * Runs the package generation scripts from package-builder.
 */

import { spawn } from '@socketsecurity/lib/spawn'

const scripts = [
  '../package-builder/scripts/generate-cli-sentry-package.mjs',
  '../package-builder/scripts/generate-socket-package.mjs',
  '../package-builder/scripts/generate-socketbin-packages.mjs',
]

for (const script of scripts) {
  const result = await spawn('node', [script], { stdio: 'inherit' })
  if (result.code !== 0) {
    // Use nullish coalescing to handle signal-killed processes (code is null).
    process.exit(result.code ?? 1)
  }
}
