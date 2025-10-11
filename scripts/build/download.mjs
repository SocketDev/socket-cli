/**
 * @fileoverview Download and extraction utilities for Node.js source
 */

import { createWriteStream, promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { parseTarGzip } from 'nanotar'

import { exec, logger, moveWithRetry } from './core.mjs'

/**
 * Download a file using Node.js https module
 */
export async function downloadFile(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true })

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        if (response.headers.location) {
          downloadFile(response.headers.location, destPath).then(resolve).catch(reject)
        } else {
          reject(new Error('Redirect without location header'))
        }
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
        return
      }

      const fileStream = createWriteStream(destPath)
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
      let downloadedBytes = 0

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length
        if (totalBytes > 0) {
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1)
          process.stdout.write(`\r   Downloaded: ${percent}%`)
        }
      })

      pipeline(response, fileStream)
        .then(() => {
          process.stdout.write('\r\x1b[K')
          logger.success(' Download complete')
          resolve()
        })
        .catch(reject)
    }).on('error', reject)
  })
}

/**
 * Extract tar.gz using nanotar (cross-platform)
 */
export async function extractTarGz(tarballPath, targetDir) {
  const tarballData = await fs.readFile(tarballPath)
  const entries = parseTarGzip(tarballData)

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name)

    if (entry.type === 'directory') {
      await fs.mkdir(fullPath, { recursive: true }) // eslint-disable-line no-await-in-loop
    } else if (entry.type === 'file') {
      await fs.mkdir(path.dirname(fullPath), { recursive: true }) // eslint-disable-line no-await-in-loop
      await fs.writeFile(fullPath, entry.data) // eslint-disable-line no-await-in-loop
    }
  }
}

/**
 * Get GitHub tag SHA for verification
 */
export async function getTagSha(version) {
  try {
    const url = `https://api.github.com/repos/nodejs/node/git/refs/tags/${version}`
    const response = await fetch(url)
    if (!response.ok) {return null}

    const data = await response.json()
    return data.object?.sha?.substring(0, 7) || null
  } catch {
    return null
  }
}

/**
 * Download Node.js source
 */
export async function downloadNodeSource(version, targetDir, buildDir) {
  logger.log(`📥 Downloading Node.js ${version} source...`)

  // Use GitHub archive URL for better security (immutable, verifiable)
  const githubUrl = `https://github.com/nodejs/node/archive/refs/tags/${version}.tar.gz`
  const tarballPath = path.join(buildDir, `node-${version}.tar.gz`)

  // Try to get SHA for logging/verification
  const sha = await getTagSha(version)
  if (sha) {
    logger.log(`   GitHub tag SHA: ${sha}`)
  }
  logger.log(`   Source: ${githubUrl}`)

  // Download tarball
  await downloadFile(githubUrl, tarballPath)

  // Extract using nanotar (cross-platform, no native tar required)
  logger.log('📦 Extracting source using nanotar...')

  try {
    // Try native tar first if available (faster for large files)
    await exec('tar', ['-xzf', tarballPath, '-C', buildDir])
    logger.log('   Using native tar (faster)')
  } catch {
    // Fall back to nanotar (works everywhere)
    logger.log('   Using nanotar (cross-platform)')
    await extractTarGz(tarballPath, buildDir)
  }

  // Move to target directory
  // GitHub archives extract as 'node-24.9.0' (without 'v' prefix)
  const versionWithoutV = version.startsWith('v') ? version.substring(1) : version
  const extractedDir = path.join(buildDir, `node-${versionWithoutV}`)
  if (extractedDir !== targetDir) {
    await moveWithRetry(extractedDir, targetDir)
  }

  logger.success(` Source extracted to ${targetDir}`)
}
