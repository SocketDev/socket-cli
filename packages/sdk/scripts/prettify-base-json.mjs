/**
 * @fileoverview JSON prettification script for Socket API base files.
 * Formats and prettifies JSON configuration files for better readability.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import { getRootPath } from './utils/path-helpers.mjs'

const rootPath = getRootPath(import.meta.url)
const openApiJsonPath = path.join(rootPath, 'openapi.json')

async function main() {
  try {
    const openApiData = await fs.readFile(openApiJsonPath, 'utf8')
    await fs.writeFile(
      openApiJsonPath,
      JSON.stringify(JSON.parse(openApiData), null, 2),
    )
  } catch (e) {
    process.exitCode = 1
    console.error('Failed with error:', e.message)
  }
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
