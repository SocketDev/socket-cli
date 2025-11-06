/**
 * @fileoverview Copy build/cli.js to dist/cli.js.
 *
 * This script copies the CLI bundle from the build directory to dist.
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-external/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const buildPath = path.join(rootPath, 'build')
const distPath = path.join(rootPath, 'dist')

const cliPath = path.join(buildPath, 'cli.js')
const distCliPath = path.join(distPath, 'cli.js')

const logger = getDefaultLogger()

// Ensure dist/ directory exists.
mkdirSync(distPath, { recursive: true })

// Copy cli.js to dist/.
copyFileSync(cliPath, distCliPath)

logger.success('Copied cli.js to dist/')
