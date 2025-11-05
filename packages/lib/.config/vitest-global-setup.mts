/**
 * @fileoverview Global setup for Vitest.
 * Ensures necessary directories exist before running tests.
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

export async function setup() {
  // Ensure coverage/.tmp directory exists to prevent ENOENT errors
  // when vitest's v8 coverage provider writes temporary coverage files.
  const coverageTmpDir = path.join(projectRoot, 'coverage', '.tmp')
  await mkdir(coverageTmpDir, { recursive: true })
}
