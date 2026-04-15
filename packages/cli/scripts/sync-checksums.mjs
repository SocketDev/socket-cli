#!/usr/bin/env node
/**
 * Sync checksums from GitHub releases to bundle-tools.json.
 *
 * For each GitHub-released tool, this script:
 * 1. Fetches checksums.txt from the release (if available)
 * 2. Or downloads each asset and computes SHA-256 checksums
 * 3. Updates bundle-tools.json with the new checksums
 *
 * Usage:
 *   node scripts/sync-checksums.mjs [--tool=<tool>] [--force] [--dry-run]
 *
 * Options:
 *   --tool=<name>  Only sync specific tool
 *   --force        Force update even if checksums haven't changed
 *   --dry-run      Show what would be updated without writing
 */

import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  readFileSync,
  promises as fs,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const EXTERNAL_TOOLS_FILE = path.join(packageRoot, 'bundle-tools.json')

/**
 * Compute SHA-256 hash of a file.
 */
async function computeFileHash(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Parse checksums.txt content into a map.
 */
function parseChecksums(content) {
  const checksums = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    // Format: hash  filename (two spaces or whitespace between)
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (match) {
      checksums[match[2]] = match[1]
    }
  }
  return checksums
}

/**
 * Download a file from a URL.
 */
async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'socket-cli-sync-checksums',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const fileStream = await fs.open(destPath, 'w')
  try {
    const writer = fileStream.createWriteStream()
    await pipeline(response.body, writer)
  } finally {
    await fileStream.close()
  }
}

/**
 * Fetch checksums for a GitHub release.
 * First tries checksums.txt, then falls back to downloading assets.
 */
async function fetchGitHubReleaseChecksums(
  repo,
  releaseTag,
  existingChecksums = {},
) {
  const [owner, repoName] = repo.split('/')
  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/releases/tags/${releaseTag}`

  console.log(`  Fetching release info from ${apiUrl}...`)

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'socket-cli-sync-checksums',
    },
  })

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    )
  }

  const release = await response.json()
  const assets = release.assets || []

  // Try to find checksums.txt in assets.
  const checksumsAsset = assets.find(a => a.name === 'checksums.txt')
  if (checksumsAsset) {
    console.log(`  Found checksums.txt, downloading...`)
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'socket-checksums-'),
    )
    const checksumPath = path.join(tempDir, 'checksums.txt')

    try {
      await downloadFile(checksumsAsset.browser_download_url, checksumPath)
      const content = await fs.readFile(checksumPath, 'utf8')
      const checksums = parseChecksums(content)

      // Clean up.
      await fs.rm(tempDir, { recursive: true })

      console.log(
        `  Parsed ${Object.keys(checksums).length} checksums from checksums.txt`,
      )
      return checksums
    } catch (error) {
      console.log(`  Failed to download checksums.txt: ${error.message}`)
      await fs.rm(tempDir, { recursive: true }).catch(() => {})
      // Fall through to download assets.
    }
  }

  // No checksums.txt - need to download assets and compute checksums.
  // Only download assets that are in existingChecksums (to avoid downloading unnecessary files).
  const assetNames = Object.keys(existingChecksums)
  if (assetNames.length === 0) {
    console.log(`  No existing checksums to update and no checksums.txt found`)
    return {}
  }

  console.log(
    `  No checksums.txt found, downloading ${assetNames.length} assets to compute checksums...`,
  )

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-checksums-'))
  const checksums = {}

  try {
    for (const assetName of assetNames) {
      const asset = assets.find(a => a.name === assetName)
      if (!asset) {
        console.log(`    Warning: Asset ${assetName} not found in release`)
        continue
      }

      const assetPath = path.join(tempDir, assetName)
      console.log(`    Downloading ${assetName}...`)
      await downloadFile(asset.browser_download_url, assetPath)

      const hash = await computeFileHash(assetPath)
      checksums[assetName] = hash
      console.log(`    ${assetName}: ${hash.slice(0, 16)}...`)

      // Clean up as we go to save disk space.
      await fs.unlink(assetPath)
    }
  } finally {
    await fs.rm(tempDir, { recursive: true }).catch(() => {})
  }

  return checksums
}

/**
 * Main sync function.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] : undefined

  // Load current bundle-tools.json.
  if (!existsSync(EXTERNAL_TOOLS_FILE)) {
    console.error(`Error: ${EXTERNAL_TOOLS_FILE} not found`)
    process.exitCode = 1
    return
  }

  const externalTools = JSON.parse(readFileSync(EXTERNAL_TOOLS_FILE, 'utf8'))

  // Find all GitHub-released tools.
  const githubTools = Object.entries(externalTools)
    .filter(([key, value]) => {
      if (key.startsWith('$')) {
        return false
      } // Skip schema keys
      return value.release === 'asset'
    })
    .map(([key, value]) => ({ key, ...value }))

  if (toolFilter) {
    const filtered = githubTools.filter(t => t.key === toolFilter)
    if (filtered.length === 0) {
      console.error(
        `Error: Tool '${toolFilter}' not found or is not a GitHub release tool`,
      )
      console.log(
        `Available GitHub release tools: ${githubTools.map(t => t.key).join(', ')}`,
      )
      process.exitCode = 1
      return
    }
    githubTools.length = 0
    githubTools.push(...filtered)
  }

  console.log(
    `Syncing checksums for ${githubTools.length} GitHub release tool(s)...\n`,
  )

  let updated = 0
  let unchanged = 0
  let failed = 0

  for (const tool of githubTools) {
    const repoPath = tool.repository.replace(/^[^:]+:/, '')
    const releaseTag = tool.tag ?? tool.version
    console.log(`[${tool.key}] ${repoPath} @ ${releaseTag}`)

    try {
      const newChecksums = await fetchGitHubReleaseChecksums(
        repoPath,
        releaseTag,
        tool.checksums || {},
      )

      if (Object.keys(newChecksums).length === 0) {
        console.log(`  Skipped: No checksums found\n`)
        unchanged++
        continue
      }

      // Check if update is needed.
      const oldChecksums = tool.checksums || {}
      const checksumChanged =
        JSON.stringify(newChecksums) !== JSON.stringify(oldChecksums)

      if (!force && !checksumChanged) {
        console.log(
          `  Unchanged: ${Object.keys(newChecksums).length} checksums\n`,
        )
        unchanged++
        continue
      }

      // Update the data.
      externalTools[tool.key].checksums = newChecksums

      const oldCount = Object.keys(oldChecksums).length
      const newCount = Object.keys(newChecksums).length
      console.log(`  Updated: ${oldCount} -> ${newCount} checksums\n`)
      updated++
    } catch (error) {
      console.log(`  Error: ${error.message}\n`)
      failed++
    }
  }

  // Write updated file.
  if (updated > 0 && !dryRun) {
    await fs.writeFile(
      EXTERNAL_TOOLS_FILE,
      JSON.stringify(externalTools, null, 2) + '\n',
      'utf8',
    )
    console.log(`Updated ${EXTERNAL_TOOLS_FILE}`)
  } else if (dryRun && updated > 0) {
    console.log('Dry run - no changes written')
  }

  // Summary.
  console.log(
    `\nSummary: ${updated} updated, ${unchanged} unchanged, ${failed} failed`,
  )

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`Sync failed: ${error.message}`)
  process.exitCode = 1
})
