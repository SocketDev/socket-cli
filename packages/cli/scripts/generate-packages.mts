/**
 * Generate template-based packages required for CLI build. Runs the package
 * generation scripts from package-builder.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageBuilderScripts = path.resolve(
  __dirname,
  '../../package-builder/scripts',
)

const scripts = [
  path.join(packageBuilderScripts, 'generate-cli-packages.mts'),
  path.join(packageBuilderScripts, 'generate-cli-exe-packages.mts'),
]

async function main(): Promise<void> {
  for (let i = 0, { length } = scripts; i < length; i += 1) {
    const script = scripts[i]
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
}

main().catch((e: unknown) => {
  logger.error(`Error: ${errorMessage(e)}`)
  process.exitCode = 1
})
