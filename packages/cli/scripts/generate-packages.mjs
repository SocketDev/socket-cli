/**
 * Generate template-based packages required for CLI build.
 * Runs the package generation scripts from package-builder.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageBuilderScripts = path.resolve(
  __dirname,
  '../../package-builder/scripts',
)

const scripts = [
  path.join(packageBuilderScripts, 'generate-cli-packages.mjs'),
  path.join(packageBuilderScripts, 'generate-socketbin-packages.mjs'),
]

for (const script of scripts) {
  const result = await spawn('node', [script], { stdio: 'inherit' })

  if (!result) {
    process.exitCode = 1
    throw new Error(`Failed to start script: ${script}`)
  }

  if (result.code !== 0) {
    // Use nullish coalescing to handle signal-killed processes (code is null).
    process.exitCode = result.code ?? 1
    throw new Error(
      `Package generation failed for ${script} with exit code ${result.code}`,
    )
  }
}
