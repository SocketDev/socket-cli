import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import AdmZip from 'adm-zip'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { externalTools, logger } from './external-tools-config.mts'

/**
 * Download, extract, and install a single external security tool for the
 * given platform. Handles standalone binaries, zip/tar archives, and the
 * Python runtime's additional pip-install steps.
 *
 * @returns Promise resolving to the tar entry name(s) to bundle for this tool.
 */
export async function downloadAndInstallTool(
  toolName,
  assetName,
  config,
  toolsDir,
  platform,
) {
  const installed = []

  const isPlatWin = platform === 'win32'
  const binaryName = toolName + (isPlatWin ? '.exe' : '')
  const binaryPath = normalizePath(path.join(toolsDir, binaryName))

  // Skip if already downloaded.
  if (
    existsSync(binaryPath) ||
    (toolName === 'python' && existsSync(path.join(toolsDir, 'python')))
  ) {
    logger.log(`  ✓ ${toolName} already downloaded`)
    return [toolName === 'python' ? 'python' : binaryName]
  }

  logger.log(`  Downloading ${toolName}...`)
  const archivePath = normalizePath(path.join(toolsDir, assetName))

  // Download archive directly from GitHub releases.
  // Release tags can be any format (v1.6.1, 3.11.14, 20260203, etc.).
  const tag = config.version
  const url = `https://github.com/${config.owner}/${config.repo}/releases/download/${tag}/${assetName}`

  // Get SHA256 checksum from bundle-tools.json.
  // SECURITY: Checksum verification is REQUIRED for all external tool downloads.
  // If checksum is missing, the build MUST fail.
  const toolConfig = externalTools[toolName]
  const sha256 = toolConfig?.checksums?.[assetName]

  if (!sha256) {
    throw new Error(
      `bundle-tools.json tools["${toolName}"].checksums has no entry for "${assetName}" (seen: ${joinAnd(Object.keys(toolConfig?.checksums ?? {})) || '<empty>'}); run \`pnpm run sync-checksums\` to populate — builds must verify every external download`,
    )
  }

  await httpDownload(url, archivePath, {
    logger,
    progressInterval: 10,
    retries: 2,
    retryDelay: 5000,
    sha256,
  })

  // Extract binary (or handle standalone binaries).
  const isZip = assetName.endsWith('.zip')
  const isTarGz = assetName.endsWith('.tar.gz') || assetName.endsWith('.tgz')
  const isStandalone = !isZip && !isTarGz

  if (isStandalone) {
    // Standalone binary - create node_modules structure for VFS compatibility.
    // node-smol VFS requires all files to be under node_modules/ for security.
    logger.log(`  Preparing ${toolName}...`)

    // Create node_modules/@socketsecurity/{toolName}-bin/ structure.
    const packageDir = normalizePath(
      path.join(toolsDir, 'node_modules', '@socketsecurity', `${toolName}-bin`),
    )
    await safeMkdir(packageDir)

    const packageBinaryPath = normalizePath(path.join(packageDir, binaryName))

    // Move binary into package directory.
    if (archivePath !== packageBinaryPath) {
      try {
        await fs.rename(archivePath, packageBinaryPath)
      } catch (e) {
        // Fallback to copy + delete for cross-device moves.
        await fs.copyFile(archivePath, packageBinaryPath)
        await safeDelete(archivePath)
      }
    }

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(packageBinaryPath, 0o755)
    }

    logger.log(`  ✓ ${toolName} ready`)
    return [`node_modules/@socketsecurity/${toolName}-bin`]
  }

  logger.log(`  Extracting ${toolName}...`)

  if (isZip) {
    // Extract zip archive using adm-zip.
    // adm-zip provides cross-platform zip extraction with zero dependencies
    // and built-in path traversal protection (fixed in v0.4.9, CVE-2018-1002204).
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(toolsDir, true)
  } else {
    // Use tar command.
    const tarResult = await spawn('tar', ['-xzf', archivePath, '-C', toolsDir])
    if (tarResult && tarResult.code !== 0) {
      throw new Error(`Failed to extract ${assetName}`)
    }
  }

  // Find and move binary to final location.
  let extractedBinaryPath

  if (toolName === 'python') {
    // Python extracts to different structures on Windows vs Unix.
    // Unlike other tools, Python requires its entire directory structure (stdlib, lib,
    // include directories) to function. The python-build-standalone package is a
    // complete, self-contained Python installation (~19 MB compressed).
    //
    // Unix directory structure after extraction:
    // python/
    // ├── bin/           # Python executable and symlinks.
    // ├── lib/           # Standard library and site-packages.
    // ├── include/       # C headers for extension modules.
    // └── share/         # Documentation and other resources.
    //
    // Windows directory structure after extraction:
    // python/
    // ├── python.exe     # Python executable at root.
    // ├── DLLs/          # Python DLLs and extensions.
    // ├── Lib/           # Standard library and site-packages.
    // ├── libs/          # Import libraries for linking.
    // └── include/       # C headers for extension modules.
    //
    // We keep the entire python/ directory in the VFS for socket-basics to use.
    const pythonBinPath = normalizePath(
      path.join(
        toolsDir,
        'python',
        isPlatWin ? 'python.exe' : path.join('bin', 'python'),
      ),
    )

    // Verify Python installation is complete.
    if (!existsSync(pythonBinPath)) {
      throw new Error(
        `Python binary not found after extraction: ${pythonBinPath}`,
      )
    }

    // Make all binaries executable on Unix (python, python3, python3.11, etc.).
    if (!isPlatWin) {
      const binDir = path.join(toolsDir, 'python', 'bin')
      const binFiles = await fs.readdir(binDir)
      for (let i = 0, { length } = binFiles; i < length; i += 1) {
        const file = binFiles[i]
        const filePath = path.join(binDir, file)
        // oxlint-disable-next-line socket/prefer-exists-sync -- reads .isFile() for chmod eligibility, not an existence check.
        const stats = await fs.lstat(filePath)
        if (stats.isFile()) {
          await fs.chmod(filePath, 0o755)
        }
      }
    }

    // Install socketsecurity (pycli) into the bundled Python environment.
    // This pre-installs the package so SEA mode doesn't need network access.
    const pyCliConfig = externalTools['socketsecurity']
    if (pyCliConfig) {
      const pyCliVersion = pyCliConfig.version
      const wheelFilename = `socketsecurity-${pyCliVersion}-py3-none-any.whl`
      const wheelSha256 = pyCliConfig.checksums?.[wheelFilename]

      if (!wheelSha256) {
        throw new Error(
          `bundle-tools.json tools.socketsecurity.checksums has no entry for "${wheelFilename}" (seen: ${joinAnd(Object.keys(pyCliConfig.checksums ?? {})) || '<empty>'}); run \`pnpm run sync-checksums\` to populate from PyPI — builds must verify the wheel hash`,
        )
      }

      logger.log(`  Installing socketsecurity ${pyCliVersion} into Python…`)

      // Fetch wheel URL from PyPI JSON API.
      const pypiResponse = await httpRequest(
        `https://pypi.org/pypi/socketsecurity/${pyCliVersion}/json`,
      )
      if (!pypiResponse.ok) {
        throw new Error(
          `Failed to fetch socketsecurity ${pyCliVersion} from PyPI: ${pypiResponse.status}`,
        )
      }
      const pypiData = JSON.parse(pypiResponse.body.toString('utf8'))
      const wheelInfo = pypiData.urls.find(u => u.filename === wheelFilename)
      if (!wheelInfo) {
        throw new Error(
          `Wheel ${wheelFilename} not found in PyPI release ${pyCliVersion}`,
        )
      }

      // Download wheel from PyPI.
      const wheelPath = normalizePath(path.join(toolsDir, wheelFilename))

      await httpDownload(wheelInfo.url, wheelPath, {
        logger,
        progressInterval: 10,
        retries: 2,
        retryDelay: 5000,
        sha256: wheelSha256,
      })

      // Install wheel into Python's site-packages using pip.
      const pipResult = await spawn(pythonBinPath, [
        '-m',
        'pip',
        'install',
        '--quiet',
        '--no-deps',
        wheelPath,
      ])

      if (pipResult && pipResult.code !== 0) {
        throw new Error(
          `Failed to install socketsecurity into bundled Python: exit code ${pipResult.code}`,
        )
      }

      // Clean up wheel file.
      await safeDelete(wheelPath)

      logger.log(`  ✓ socketsecurity ${pyCliVersion} installed`)
    }

    // Install socket_basics from GitHub source (not on PyPI).
    // socket_basics orchestrates the security tools (trivy, trufflehog, opengrep).
    const socketBasicsConfig = externalTools['socket-basics']
    if (socketBasicsConfig && socketBasicsConfig.release === 'archive') {
      const repoPath = socketBasicsConfig.repository.replace(/^[^:]+:/, '')
      const releaseVersion = socketBasicsConfig.version
      const version = releaseVersion.replace(/^v/, '') // Remove 'v' prefix for version

      // Checksum key matches the local filename convention used for
      // archive-style releases (`socket-basics-v<ver>.tar.gz`).
      const archiveKey = `socket-basics-${releaseVersion}.tar.gz`
      const archiveSha256 = socketBasicsConfig.checksums?.[archiveKey]
      if (!archiveSha256) {
        throw new Error(
          `bundle-tools.json tools["socket-basics"].checksums has no entry for "${archiveKey}" (seen: ${joinAnd(Object.keys(socketBasicsConfig.checksums ?? {})) || '<empty>'}); run \`pnpm run sync-checksums\` to populate from the GitHub release — builds must verify the source tarball hash`,
        )
      }

      logger.log(`  Installing socket_basics ${version} from GitHub…`)

      // Download source tarball from GitHub.
      const tarballUrl = `https://github.com/${repoPath}/archive/refs/tags/${releaseVersion}.tar.gz`
      const tarballPath = normalizePath(
        path.join(toolsDir, `socket-basics-${version}.tar.gz`),
      )

      await httpDownload(tarballUrl, tarballPath, {
        logger,
        progressInterval: 10,
        retries: 2,
        retryDelay: 5000,
        sha256: archiveSha256,
      })

      // Install from tarball using pip (handles building and dependencies).
      const pipInstallResult = await spawn(pythonBinPath, [
        '-m',
        'pip',
        'install',
        '--quiet',
        tarballPath,
      ])

      if (pipInstallResult && pipInstallResult.code !== 0) {
        throw new Error(
          `Failed to install socket_basics from source: exit code ${pipInstallResult.code}`,
        )
      }

      // Clean up tarball.
      await safeDelete(tarballPath)

      logger.log(`  ✓ socket_basics ${version} installed`)
    }

    // Don't clean up - keep the whole python directory.
    // We'll include the entire directory in the tar.gz.
    installed.push('python')
  } else if (toolName === 'opengrep') {
    // OpenGrep binary is named opengrep-core in the archive.
    extractedBinaryPath = normalizePath(
      path.join(toolsDir, `opengrep-core${isPlatWin ? '.exe' : ''}`),
    )

    if (extractedBinaryPath !== binaryPath && existsSync(extractedBinaryPath)) {
      try {
        await fs.rename(extractedBinaryPath, binaryPath)
      } catch (e) {
        // Fallback to copy + delete for cross-device moves.
        await fs.copyFile(extractedBinaryPath, binaryPath)
        await safeDelete(extractedBinaryPath)
      }
    } else if (!existsSync(binaryPath)) {
      throw new Error(
        `Binary not found after extraction: ${extractedBinaryPath}`,
      )
    }

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(binaryPath, 0o755)
    }

    installed.push(binaryName)
  } else {
    // Other tools extract with their own name.
    extractedBinaryPath = normalizePath(
      path.join(toolsDir, toolName + (isPlatWin ? '.exe' : '')),
    )

    if (extractedBinaryPath !== binaryPath && existsSync(extractedBinaryPath)) {
      try {
        await fs.rename(extractedBinaryPath, binaryPath)
      } catch (e) {
        // Fallback to copy + delete for cross-device moves.
        await fs.copyFile(extractedBinaryPath, binaryPath)
        await safeDelete(extractedBinaryPath)
      }
    } else if (!existsSync(binaryPath)) {
      throw new Error(
        `Binary not found after extraction: ${extractedBinaryPath}`,
      )
    }

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(binaryPath, 0o755)
    }

    installed.push(binaryName)
  }

  // Clean up archive.
  await safeDelete(archivePath)

  logger.log(`  ✓ ${toolName} ready`)

  return installed
}
