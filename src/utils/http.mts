/**
 * HTTP download utility for fetching files from remote URLs.
 */

import { promises as fs, createWriteStream } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

/**
 * Download a file from a URL to a local path.
 *
 * @param url - The URL to download from.
 * @param destPath - The destination file path.
 * @returns Promise that resolves to true on success, false on failure.
 */
export async function httpDownload(
  url: string,
  destPath: string,
): Promise<boolean> {
  try {
    // Ensure destination directory exists.
    const destDir = path.dirname(destPath)
    await fs.mkdir(destDir, { recursive: true })

    // Choose http or https based on URL protocol.
    const client = url.startsWith('https:') ? https : http

    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath)

      const request = client.get(url, response => {
        // Handle redirects.
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            httpDownload(redirectUrl, destPath).then(resolve).catch(reject)
            return
          }
        }

        // Check for successful response.
        if (response.statusCode !== 200) {
          file.close()
          fs.unlink(destPath).catch(() => {}) // Clean up partial file.
          reject(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
          )
          return
        }

        // Pipe response to file.
        response.pipe(file)

        file.on('finish', () => {
          file.close()
          resolve(true)
        })
      })

      request.on('error', err => {
        file.close()
        fs.unlink(destPath).catch(() => {}) // Clean up partial file.
        reject(err)
      })

      file.on('error', err => {
        fs.unlink(destPath).catch(() => {}) // Clean up partial file.
        reject(err)
      })
    })
  } catch (error) {
    return false
  }
}
