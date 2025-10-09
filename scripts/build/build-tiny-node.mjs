
/**
 * @fileoverview Build custom Node.js with yao-pkg and custom patches
 *
 * This script downloads Node.js source, applies patches, and builds a custom
 * binary for use with @yao-pkg/pkg. It supports configurable Node versions
 * and custom patches.
 *
 * Usage:
 *   node scripts/build-tiny-node.mjs [options]
 *
 * Options:
 *   --version=v24.9.0  Node.js version to build (default: v24.9.0)
 *   --skip-download    Skip downloading if source already exists
 *   --skip-yao-patch   Skip applying yao-pkg patches
 *   --custom-patches   Apply custom patches from .custom-node-patches/
 *   --help             Show help
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { cpus, platform } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { parseTarGzip } from 'nanotar'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Simple logger implementation
const logger = {
  info: (msg) => console.log(msg),
  success: (msg) => console.log(`✅${msg}`),
  warn: (msg) => console.warn(`⚠️ ${msg}`),
  error: (msg) => console.error(msg)
}

// Configuration
const ROOT_DIR = join(__dirname, '../..')
const BUILD_DIR = join(ROOT_DIR, 'build', 'tiny-node')
const CUSTOM_PATCHES_DIR = join(__dirname, 'stub', 'patches', 'socket')

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    nodeVersion: 'v24.9.0',
    skipDownload: false,
    skipYaoPatch: false,
    customPatches: false,
    skipCodeMods: false,
    help: false
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--version=')) {
      options.nodeVersion = arg.split('=')[1]
    } else if (arg === '--skip-download') {
      options.skipDownload = true
    } else if (arg === '--skip-yao-patch') {
      options.skipYaoPatch = true
    } else if (arg === '--custom-patches') {
      options.customPatches = true
    } else if (arg === '--skip-code-mods') {
      options.skipCodeMods = true
    }
  }

  return options
}

// Show help
function showHelp() {
  logger.info(`Socket CLI Custom Node Builder
==============================

Usage: node scripts/build-tiny-node.mjs [options]

Options:
  --version=VERSION   Node.js version to build (default: v24.9.0)
                      Examples: --version=v24.9.0, --version=v22.19.0
  --skip-download     Skip downloading if source already exists
  --skip-yao-patch    Skip applying yao-pkg patches
  --custom-patches    Apply custom patches from build/tiny-node/patches/
  --skip-code-mods    Skip V8 flags and node-gyp modifications
  --help, -h          Show this help

Examples:
  # Build default version (v24.9.0)
  node scripts/build-tiny-node.mjs

  # Build specific version
  node scripts/build-tiny-node.mjs --version=v22.19.0

  # Rebuild existing source with custom patches
  node scripts/build-tiny-node.mjs --skip-download --custom-patches

Custom Patches:
  Place .patch files in scripts/build/stub/patches/socket/ directory.
  They will be applied after yao-pkg patches.
`)
}

/**
 * Execute a command and stream output
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  logger.info(`$ ${command} ${args.join(' ')}`)

  const exitCode = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
    })
    child.on('exit', (code) => resolve(code || 0))
    child.on('error', () => resolve(1))
  })

  if (exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${exitCode}: ${command} ${args.join(' ')}`,
    )
  }

  return { code: exitCode }
}

/**
 * Execute a command and capture output
 */
async function execCapture(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  const result = await new Promise((resolve) => {
    let stdout = ''
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'pipe',
      shell: false,
    })
    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })
    child.on('exit', (code) => {
      resolve({ code: code || 0, stdout })
    })
    child.on('error', () => {
      resolve({ code: 1, stdout: '' })
    })
  })

  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }

  return result.stdout.trim()
}

/**
 * Download file using Node.js https module (cross-platform)
 */
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)

    httpsGet(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        return downloadFile(response.headers.location, destPath).then(resolve, reject)
      }

      if (response.statusCode !== 200) {
        file.close()
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }

      pipeline(response, file)
        .then(() => resolve())
        .catch(reject)
    }).on('error', (err) => {
      file.close()
      reject(err)
    })
  })
}

/**
 * Find yao-pkg patch for the given Node version
 */
function findYaoPkgPatch(nodeVersion) {
  // Look for the patch in node_modules
  const pkgFetchDirs = readdirSync(join(ROOT_DIR, 'node_modules', '.pnpm'))
    .filter(dir => dir.startsWith('@yao-pkg+pkg-fetch'))
    .sort()
    .reverse() // Use newest version

  for (const dir of pkgFetchDirs) {
    const patchPath = join(
      ROOT_DIR,
      'node_modules',
      '.pnpm',
      dir,
      'node_modules',
      '@yao-pkg',
      'pkg-fetch',
      'patches',
      `node.${nodeVersion}.cpp.patch`
    )

    if (existsSync(patchPath)) {
      return patchPath
    }
  }

  return null
}

/**
 * Robust move operation with retry logic for Windows
 * Tries rename first (fast), falls back to copy+delete if needed
 */
async function moveWithRetry(src, dest, maxRetries = 3) {
  let lastError

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Try rename first (fastest if on same filesystem)
      await rename(src, dest)
      return
    } catch (error) {
      lastError = error

      // If it's a cross-device error (EXDEV), try copy + delete
      if (error.code === 'EXDEV') {
        try {
          // Use recursive copy for directories
          await cp(src, dest, { recursive: true })
          await rm(src, { recursive: true, force: true })
          return
        } catch (copyError) {
          lastError = copyError
        }
      }

      // On Windows, files might be locked temporarily
      if (platform() === 'win32' && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)))
      }
    }
  }

  throw lastError
}

/**
 * Extract tar.gz using nanotar (cross-platform)
 */
async function extractTarGz(tarballPath, outputDir) {
  await mkdir(outputDir, { recursive: true })

  // Read the tar.gz file
  const tarballBuffer = await readFile(tarballPath)

  // Parse and extract using nanotar
  const files = parseTarGzip(tarballBuffer)

  // Extract all files
  for (const [filepath, content] of files) {
    const fullPath = join(outputDir, filepath)
    await mkdir(dirname(fullPath), { recursive: true })

    if (content) {
      await writeFile(fullPath, content)
    } else {
      // Directory entry
      await mkdir(fullPath, { recursive: true })
    }
  }
}

/**
 * Download Node.js source
 */
async function downloadNodeSource(version, targetDir) {
  logger.info(`📥 Downloading Node.js ${version} source...`)

  const tarballUrl = `https://nodejs.org/dist/${version}/node-${version}.tar.gz`
  const tarballPath = join(BUILD_DIR, `node-${version}.tar.gz`)

  // Download tarball using Node.js https module for cross-platform support
  await downloadFile(tarballUrl, tarballPath)

  // Extract using nanotar (cross-platform, no native tar required)
  logger.info('📦 Extracting source using nanotar...')

  try {
    // Try native tar first if available (faster for large files)
    await exec('tar', ['-xzf', tarballPath, '-C', BUILD_DIR])
    logger.info('   Using native tar (faster)')
  } catch {
    // Fall back to nanotar (works everywhere)
    logger.info('   Using nanotar (cross-platform)')
    await extractTarGz(tarballPath, BUILD_DIR)
  }

  // Move to target directory using robust move function
  const extractedDir = join(BUILD_DIR, `node-${version}`)
  if (extractedDir !== targetDir) {
    if (existsSync(targetDir)) {
      await rm(targetDir, { recursive: true })
    }
    await moveWithRetry(extractedDir, targetDir)
  }

  // Clean up tarball
  await rm(tarballPath)

  logger.success(' Source downloaded and extracted')
}

/**
 * Parse a unified diff patch file
 */
function parsePatch(patchContent) {
  const files = []
  const lines = patchContent.split('\n')

  let currentFile = null
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Look for file headers
    if (line.startsWith('--- ')) {
      const fromFile = line.substring(4).replace(/^[ab]\//, '')
      const toLine = lines[++i]
      if (toLine && toLine.startsWith('+++ ')) {
        let toFile = toLine.substring(4).replace(/^[ab]\//, '')

        // Strip common prefixes like 'node/' that yao-pkg patches have
        if (toFile.startsWith('node/')) {
          toFile = toFile.substring(5)
        }

        currentFile = {
          from: fromFile,
          to: toFile,
          hunks: []
        }
        files.push(currentFile)
      }
    }
    // Look for hunk headers
    else if (line.startsWith('@@ ') && currentFile) {
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
      if (match) {
        const hunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newLines: parseInt(match[4] || '1', 10),
          lines: []
        }

        // Collect hunk lines
        i++
        while (i < lines.length && !lines[i].startsWith('--- ') && !lines[i].startsWith('@@ ')) {
          const hunkLine = lines[i]
          if (hunkLine.startsWith('+') || hunkLine.startsWith('-') || hunkLine.startsWith(' ')) {
            hunk.lines.push({
              type: hunkLine[0],
              content: hunkLine.substring(1)
            })
          }
          i++
        }
        i-- // Back up one since we'll increment at the end of the loop

        currentFile.hunks.push(hunk)
      }
    }

    i++
  }

  return files
}

/**
 * Apply a parsed patch to a file
 */
async function applyPatchToFile(filePath, hunks) {
  const content = await readFile(filePath, 'utf8')

  // Detect line ending style
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)

  // Apply hunks in reverse order to maintain line numbers
  for (let h = hunks.length - 1; h >= 0; h--) {
    const hunk = hunks[h]
    const startLine = hunk.oldStart - 1 // Convert to 0-based index

    // Verify context matches
    let contextMatches = true
    let lineIndex = startLine

    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === ' ' || hunkLine.type === '-') {
        if (lineIndex >= lines.length || lines[lineIndex] !== hunkLine.content) {
          contextMatches = false
          break
        }
        if (hunkLine.type === ' ') {lineIndex++}
        if (hunkLine.type === '-') {lineIndex++}
      }
    }

    if (!contextMatches) {
      // Try to find the hunk by searching for context
      const searchWindow = 100 // Search within 100 lines
      let found = false

      for (let offset = -searchWindow; offset <= searchWindow; offset++) {
        const testStart = startLine + offset
        if (testStart < 0 || testStart >= lines.length) {continue}

        lineIndex = testStart
        contextMatches = true

        for (const hunkLine of hunk.lines) {
          if (hunkLine.type === ' ' || hunkLine.type === '-') {
            if (lineIndex >= lines.length || lines[lineIndex] !== hunkLine.content) {
              contextMatches = false
              break
            }
            if (hunkLine.type === ' ') {lineIndex++}
            if (hunkLine.type === '-') {lineIndex++}
          }
        }

        if (contextMatches) {
          found = true
          hunk.oldStart = testStart + 1 // Update for found location
          break
        }
      }

      if (!found) {
        throw new Error(`Could not find matching context for hunk at line ${hunk.oldStart}`)
      }
    }

    // Apply the hunk
    const newLines = []
    lineIndex = startLine

    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === '+') {
        newLines.push(hunkLine.content)
      } else if (hunkLine.type === ' ') {
        newLines.push(lines[lineIndex])
        lineIndex++
      } else if (hunkLine.type === '-') {
        lineIndex++ // Skip removed lines
      }
    }

    // Replace the lines
    lines.splice(startLine, hunk.oldLines, ...newLines)
  }

  await writeFile(filePath, lines.join('\n'))
}

/**
 * Apply a patch file (cross-platform)
 */
async function applyPatch(patchPath, targetDir, description) {
  logger.info(`🩹 Applying ${description}...`)
  logger.info(`   Patch: ${patchPath}`)

  try {
    const patchContent = await readFile(patchPath, 'utf8')
    const files = parsePatch(patchContent)

    let successCount = 0
    for (const file of files) {
      const filePath = join(targetDir, file.to)

      if (!existsSync(filePath)) {
        logger.info(`   ⚠️  File not found: ${file.to}`)
        continue
      }

      try {
        await applyPatchToFile(filePath, file.hunks)
        successCount++
        logger.info(`   ✅ Patched ${file.to}`)
      } catch (error) {
        logger.info(`   ❌ Failed to patch ${file.to}: ${error.message}`)
      }
    }

    if (successCount === files.length) {
      logger.success(` ${description} applied successfully`)
      return true
    } else if (successCount > 0) {
      logger.warn(`  ${description} partially applied (${successCount}/${files.length} files)`)
      return true
    } else {
      throw new Error('No files were patched')
    }
  } catch (error) {
    logger.error(`❌ Failed to apply ${description}: ${error.message}`)
    return false
  }
}

/**
 * Apply custom patches from directory
 */
async function applyCustomPatches(targetDir) {
  if (!existsSync(CUSTOM_PATCHES_DIR)) {
    logger.info(`📂 No custom patches directory found at ${CUSTOM_PATCHES_DIR}`)
    return
  }

  const patchFiles = readdirSync(CUSTOM_PATCHES_DIR)
    .filter(file => file.endsWith('.patch'))
    .sort()

  if (patchFiles.length === 0) {
    logger.info('📂 No custom patches found')
    return
  }

  logger.info(`\n📋 Found ${patchFiles.length} custom patches to apply`)

  for (const patchFile of patchFiles) {
    const patchPath = join(CUSTOM_PATCHES_DIR, patchFile)
    await applyPatch(patchPath, targetDir, `Custom patch: ${patchFile}`)
    logger.info()
  }
}

/**
 * Apply code modifications based on configuration
 */
async function applyCodeModifications(nodeDir, nodeVersion) {
  const codeModsPath = join(CUSTOM_PATCHES_DIR, 'code-mods.json')

  // If no code-mods.json, use legacy inline modifications
  if (!existsSync(codeModsPath)) {
    return applyLegacyCodeModifications(nodeDir)
  }

  logger.info('\n🔧 Applying configured code modifications...')

  const config = JSON.parse(readFileSync(codeModsPath, 'utf8'))
  let appliedCount = 0

  for (const [modName, mod] of Object.entries(config.mods)) {
    if (!mod.enabled) {
      continue
    }

    // Check version compatibility
    if (mod.versions && !mod.versions.includes(nodeVersion)) {
      logger.info(`   ⏭️  Skipping ${modName} (not for ${nodeVersion})`)
      continue
    }

    logger.info(`   Applying: ${mod.description}`)

    try {
      switch (mod.type) {
        case 'patch': {
          const patchFile = join(CUSTOM_PATCHES_DIR, mod.file)
          if (existsSync(patchFile)) {
            const success = await applyPatch(patchFile, nodeDir, modName)
            if (success) {appliedCount++}
          } else {
            logger.info(`     ⚠️  Patch file not found: ${mod.file}`)
          }
          break
        }

        case 'replace': {
          for (const fileConfig of mod.files) {
            const filePath = join(nodeDir, fileConfig.path)
            if (existsSync(filePath)) {
              let content = readFileSync(filePath, 'utf8')
              let modified = false

              for (const replacement of fileConfig.replacements) {
                if (content.includes(replacement.search)) {
                  content = content.replace(
                    new RegExp(replacement.search, 'g'),
                    replacement.replace
                  )
                  modified = true
                }
              }

              if (modified) {
                await writeFile(filePath, content)
                logger.info(`     ✅ Modified ${fileConfig.path}`)
                appliedCount++
              }
            }
          }
          break
        }

        case 'append': {
          for (const fileConfig of mod.files) {
            const filePath = join(nodeDir, fileConfig.path)
            if (existsSync(filePath)) {
              const content = readFileSync(filePath, 'utf8')

              // For .gypi files, parse as JSON
              if (filePath.endsWith('.gypi')) {
                // Handle Python-style comments in gypi files
                const jsonContent = content.replace(/^#.*$/gm, '')
                const data = JSON.parse(jsonContent)

                if (!data.variables) {data.variables = {}}
                if (!data.variables[fileConfig.section]) {
                  data.variables[fileConfig.section] = []
                }

                data.variables[fileConfig.section].push(...fileConfig.values)

                await writeFile(filePath, JSON.stringify(data, null, 2))
                logger.info(`     ✅ Updated ${fileConfig.path}`)
                appliedCount++
              }
            }
          }
          break
        }
      }
    } catch (error) {
      logger.info(`     ❌ Failed to apply ${modName}: ${error.message}`)
    }
  }

  logger.success(` Applied ${appliedCount} code modifications`)
}

/**
 * Legacy inline code modifications (fallback)
 */
async function applyLegacyCodeModifications(nodeDir) {
  logger.info('\n🔧 Applying legacy code modifications...')

  // V8 flags modification
  const v8FlagsFile = join(nodeDir, 'src', 'node_contextify.cc')
  if (existsSync(v8FlagsFile)) {
    logger.info('   Modifying V8 flags (kAllowHarmonyDynamicImport: 1 → 0)...')

    let content = readFileSync(v8FlagsFile, 'utf8')
    if (content.includes('kAllowHarmonyDynamicImport, 1')) {
      content = content.replace(
        /kAllowHarmonyDynamicImport,\s*1/g,
        'kAllowHarmonyDynamicImport, 0'
      )
      await writeFile(v8FlagsFile, content)
      logger.info('   ✅ V8 flags modified')
    } else {
      logger.info('   ⚠️  V8 flags pattern not found')
    }
  }

  logger.success(' Legacy modifications complete')
}

/**
 * Check if Visual Studio Build Tools are installed
 */
async function checkVSBuildTools() {
  if (platform() !== 'win32') {return true}

  // Check for MSBuild
  try {
    await execCapture('msbuild', ['/version'])
    return true
  } catch {}

  // Check for VS Build Tools via vswhere
  try {
    const programFiles = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')

    if (existsSync(vswhere)) {
      const result = await execCapture(vswhere, [
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath'
      ])
      if (result) {return true}
    }
  } catch {}

  return false
}

/**
 * Download and setup Visual Studio Build Tools
 */
async function ensureVSBuildTools() {
  if (await checkVSBuildTools()) {
    logger.success(' Visual Studio Build Tools found')
    return
  }

  logger.warn('  Visual Studio Build Tools not found')
  logger.info('   This is required to build Node.js on Windows')
  logger.info()

  const vsbtDir = join(BUILD_DIR, 'vsbt')
  const installerPath = join(vsbtDir, 'vs_buildtools.exe')

  // VS Build Tools download URL (2022 version)
  const vsbtUrl = 'https://aka.ms/vs/17/release/vs_buildtools.exe'

  logger.info('📥 Downloading Visual Studio Build Tools installer...')
  logger.info('   Note: This is a ~2MB bootstrapper that will download ~2GB during install')
  logger.info()

  await mkdir(vsbtDir, { recursive: true })

  // Download the installer
  if (!existsSync(installerPath)) {
    await downloadFile(vsbtUrl, installerPath)
    logger.success(' Installer downloaded')
  }

  // Create a response file for unattended installation
  const configPath = join(vsbtDir, 'build-tools.vsconfig')
  const vsConfig = {
    "version": "1.0",
    "components": [
      "Microsoft.VisualStudio.Component.Windows10SDK.19041",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "Microsoft.VisualStudio.Component.VC.Redist.14.Latest",
      "Microsoft.VisualStudio.Component.Windows11SDK.22000",
      "Microsoft.VisualStudio.Component.VC.CMake.Project"
    ]
  }

  await writeFile(configPath, JSON.stringify(vsConfig, null, 2))

  logger.info('\n' + '='.repeat(60))
  logger.info('📝 MANUAL INSTALLATION REQUIRED')
  logger.info('='.repeat(60))
  logger.info()
  logger.info('Visual Studio Build Tools must be installed manually.')
  logger.info()
  logger.info('Option 1: Run the installer with recommended settings:')
  logger.info(`   ${installerPath}`)
  logger.info()
  logger.info('Option 2: Silent install (run as Administrator):')
  logger.info(`   "${installerPath}" --quiet --wait --config "${configPath}"`)
  logger.info()
  logger.info('Option 3: Download from:')
  logger.info('   https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022')
  logger.info()
  logger.info('After installation, restart your terminal and run this script again.')
  logger.info('='.repeat(60))
  logger.info()

  throw new Error('Visual Studio Build Tools required. Please install and try again.')
}

/**
 * Ensure Python is available (download if needed on Windows)
 */
async function ensurePython() {
  // Check if Python is already available
  try {
    const version = await execCapture('python', ['--version'])
    if (version.includes('Python 3.')) {
      logger.success(` Python found: ${version}`)
      return 'python'
    }
  } catch {}

  try {
    const version = await execCapture('python3', ['--version'])
    if (version.includes('Python 3.')) {
      logger.success(` Python3 found: ${version}`)
      return 'python3'
    }
  } catch {}

  // On Windows, download embeddable Python if not found
  if (platform() === 'win32') {
    logger.warn('  Python not found, downloading embeddable Python...')

    const pythonVersion = '3.12.8'
    const pythonArch = process.arch === 'x64' ? 'amd64' : 'win32'
    const pythonZip = `python-${pythonVersion}-embed-${pythonArch}.zip`
    const pythonUrl = `https://www.python.org/ftp/python/${pythonVersion}/${pythonZip}`
    const pythonDir = join(BUILD_DIR, 'python-3x')
    const pythonExe = join(pythonDir, 'python.exe')

    // Check if already downloaded
    if (!existsSync(pythonExe)) {
      const zipPath = join(BUILD_DIR, pythonZip)

      // Download Python
      logger.info(`   Downloading from: ${pythonUrl}`)
      await downloadFile(pythonUrl, zipPath)

      // Extract using Node.js built-in functionality
      // For zip files, we'll need a different approach
      logger.info('   Extracting Python...')
      await mkdir(pythonDir, { recursive: true })

      // Try to use PowerShell to extract (available on all Windows)
      try {
        await exec('powershell', [
          '-Command',
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${pythonDir}" -Force`
        ])
      } catch {
        // If PowerShell fails, user needs to install Python manually
        throw new Error(
          'Could not extract Python. Please install Python 3.x manually from python.org'
        )
      }

      // Clean up zip
      await rm(zipPath)
      logger.success(' Python downloaded and extracted')
    }

    return pythonExe
  }

  throw new Error(
    'Python 3.x is required but not found. Please install Python 3.x from python.org'
  )
}

/**
 * Configure Node.js build
 */
async function configureNode(nodeDir, options = {}) {
  logger.info('⚙️  Configuring Node.js build...')

  const configArgs = [
    '--without-intl',          // Remove ICU (saves ~30MB)
    '--without-npm',            // Remove npm
    '--without-corepack',       // Remove corepack
    '--without-inspector',      // Remove inspector/debugger
    '--without-amaro',          // Remove amaro
    '--without-sqlite',         // Remove SQLite
    '--without-node-snapshot',  // Disable snapshot
    '--without-node-code-cache', // Disable code cache
  ]

  // Add any additional configure options
  if (options.extraConfigArgs) {
    configArgs.push(...options.extraConfigArgs)
  }

  logger.info('   Configuration:')
  logger.info('   KEEP: WASM, SSL/crypto, JIT')
  logger.info('   REMOVE: ICU, npm, corepack, inspector, amaro, sqlite, snapshot, code cache')
  logger.info()

  // On Windows, use configure.bat or python configure
  if (platform() === 'win32') {
    const pythonCmd = await ensurePython()

    if (existsSync(join(nodeDir, 'configure.bat'))) {
      await exec('configure.bat', configArgs, { cwd: nodeDir })
    } else {
      await exec(pythonCmd, ['configure', ...configArgs], { cwd: nodeDir })
    }
  } else {
    await exec('./configure', configArgs, { cwd: nodeDir })
  }
}

/**
 * Simple build progress animation
 */
function createBuildSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const buildStages = [
    'Compiling V8 engine',
    'Building libuv',
    'Compiling OpenSSL',
    'Building Node.js core',
    'Linking executable',
    'Finalizing build'
  ]

  let frameIndex = 0
  let stageIndex = 0
  const startTime = Date.now()
  let interval

  const start = () => {
    // Clear line and write initial message
    process.stdout.write(`\r${frames[0]} ${message}...`)

    interval = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length

      // Update stage every ~5 minutes
      const elapsed = Date.now() - startTime
      const minutes = Math.floor(elapsed / 60000)
      const newStageIndex = Math.min(Math.floor(minutes / 5), buildStages.length - 1)

      if (newStageIndex !== stageIndex) {
        stageIndex = newStageIndex
        logger.info(`\n   ✓ ${buildStages[stageIndex - 1] || 'Starting build'}`)
      }

      const timeStr = `${minutes}m ${Math.floor((elapsed % 60000) / 1000)}s`
      const stage = buildStages[stageIndex]
      const frame = frames[frameIndex]

      // Clear line and update
      process.stdout.write(`\r${frame} ${message}... [${timeStr}] - ${stage}`)
    }, 100)
  }

  const stop = (success = true) => {
    if (interval) {
      clearInterval(interval)
      const elapsed = Date.now() - startTime
      const minutes = Math.floor(elapsed / 60000)
      const seconds = Math.floor((elapsed % 60000) / 1000)

      if (success) {
        logger.info(`\n✅ Build completed in ${minutes}m ${seconds}s`)
      } else {
        logger.info(`\n❌ Build failed after ${minutes}m ${seconds}s`)
      }
    }
  }

  return { start, stop }
}

/**
 * Build Node.js
 */
async function buildNode(nodeDir) {
  const cpuCount = cpus().length

  logger.info('🏗️  Building Node.js...')
  logger.info(`   Using ${cpuCount} CPU cores`)
  logger.info('   Estimated time: 30-60 minutes (first build), 5-10 minutes (rebuilds)')
  logger.info()

  const spinner = createBuildSpinner('Building Node.js')
  spinner.start()

  try {
    if (platform() === 'win32') {
      // On Windows, use MSBuild
      // Node.js configure creates a .vcxproj file
      const vcxproj = join(nodeDir, 'node.vcxproj')
      if (!existsSync(vcxproj)) {
        spinner.stop(false)
        throw new Error('node.vcxproj not found. Did configure run successfully?')
      }

      // Try to use msbuild or Visual Studio's vcbuild.bat
      try {
        await exec('msbuild', [
          'node.vcxproj',
          '/p:Configuration=Release',
          `/p:Platform=${process.arch === 'x64' ? 'x64' : 'Win32'}`,
          `/maxcpucount:${cpuCount}`
        ], { cwd: nodeDir })
      } catch {
        // Fallback to vcbuild.bat if msbuild not in PATH
        await exec('vcbuild.bat', ['release', process.arch], { cwd: nodeDir })
      }
    } else {
      await exec('make', [`-j${cpuCount}`], { cwd: nodeDir })
    }

    spinner.stop(true)
  } catch (error) {
    spinner.stop(false)
    throw error
  }
}

/**
 * Post-process the binary
 */
async function postProcessBinary(binaryPath) {
  const platform = process.platform
  const arch = process.arch

  // Get file size in MB (cross-platform)
  const getSize = async (path) => {
    const stats = await stat(path)
    return `${(stats.size / (1024 * 1024)).toFixed(1)}MB`
  }

  logger.info('\n📏 Binary optimization...')
  const originalSize = await getSize(binaryPath)
  logger.info(`   Original size: ${originalSize}`)

  // Strip debug symbols (Unix-like systems only)
  if (platform !== 'win32') {
    try {
      logger.info('🔪 Stripping debug symbols...')
      const strippedPath = `${binaryPath}-stripped`

      if (platform === 'darwin') {
        await exec('strip', ['-x', binaryPath, '-o', strippedPath])
      } else {
        await exec('strip', [binaryPath, '-o', strippedPath])
      }

      // Use robust move function for cross-platform support
      await moveWithRetry(strippedPath, binaryPath)
      const strippedSize = await getSize(binaryPath)
      logger.info(`   After stripping: ${strippedSize}`)
    } catch (error) {
      logger.warn('  strip command not available, skipping debug symbol removal')
    }
  }

  // Sign for macOS ARM64
  if (platform === 'darwin' && arch === 'arm64') {
    logger.info('\n🔏 Signing binary for macOS ARM64...')
    await exec('codesign', ['--sign', '-', '--force', binaryPath])
    logger.success(' Binary signed')
  }

  // UPX compression for non-macOS (optional)
  if (platform !== 'darwin') {
    try {
      logger.info('\n📦 Attempting compression with UPX...')
      await exec('upx', ['--best', '--lzma', binaryPath])
      const compressedSize = await getSize(binaryPath)
      logger.info(`   After UPX: ${compressedSize}`)
    } catch {
      logger.warn('  UPX not available, skipping compression')
    }
  }
}

/**
 * Copy binary to pkg cache
 */
async function copyToPkgCache(binaryPath, nodeVersion) {
  // Use os.homedir() for cross-platform home directory
  const { homedir } = await import('node:os')
  const pkgCacheDir = join(homedir(), '.pkg-cache', 'v3.5')

  if (!existsSync(pkgCacheDir)) {
    await mkdir(pkgCacheDir, { recursive: true })
  }

  const platform = process.platform === 'darwin' ? 'macos' : process.platform
  const arch = process.arch
  const cacheName = `built-${nodeVersion}-${platform}-${arch}`
  const cachePath = join(pkgCacheDir, cacheName)

  logger.info('\n📦 Copying to pkg cache...')
  logger.info(`   Cache path: ${cachePath}`)

  await copyFile(binaryPath, cachePath)
  logger.success(' Binary copied to pkg cache')

  return cachePath
}

/**
 * Main function
 *
 * CROSS-PLATFORM REQUIREMENTS:
 * - Windows: Visual Studio Build Tools, Python 3.x (auto-downloaded if needed)
 * - macOS: Xcode Command Line Tools, may require codesign for ARM64
 * - Linux: build-essential, python3, gcc/g++
 * - All platforms: 10GB+ free disk space, Node.js 18+
 *
 * FEATURES:
 * - Uses nanotar for cross-platform tar.gz extraction (no native tar required)
 * - Robust file move with retry logic for Windows file locking
 * - Auto-downloads Python on Windows if not installed
 * - Falls back to native tar if available (faster for large files)
 */
async function main() {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  const { customPatches, nodeVersion, skipCodeMods, skipDownload, skipYaoPatch } = options

  logger.info(`🔨 Building Custom Node.js ${nodeVersion}`)
  logger.info('='.repeat(50))
  logger.info()

  // Setup directories
  const nodeDir = join(BUILD_DIR, `node-${nodeVersion}-custom`)
  await mkdir(BUILD_DIR, { recursive: true })

  // Create custom patches directory if using custom patches
  if (customPatches && !existsSync(CUSTOM_PATCHES_DIR)) {
    await mkdir(CUSTOM_PATCHES_DIR, { recursive: true })
    logger.info(`📁 Created custom patches directory: ${CUSTOM_PATCHES_DIR}`)
    logger.info('   Place your .patch files here')
    logger.info()
  }

  // Download or reset Node.js source
  if (!skipDownload || !existsSync(nodeDir)) {
    await downloadNodeSource(nodeVersion, nodeDir)
    logger.info()
  } else {
    logger.info('📂 Using existing Node.js source...')
    logger.info('   Resetting to clean state...')
    await exec('git', ['init'], { cwd: nodeDir })
    await exec('git', ['add', '.'], { cwd: nodeDir })
    await exec('git', ['commit', '-m', 'Initial'], { cwd: nodeDir })
    await exec('git', ['reset', '--hard'], { cwd: nodeDir })
    await exec('git', ['clean', '-fdx'], { cwd: nodeDir })
    logger.info()
  }

  // Apply yao-pkg patch
  if (!skipYaoPatch) {
    const yaoPatch = findYaoPkgPatch(nodeVersion)

    if (yaoPatch) {
      const success = await applyPatch(yaoPatch, nodeDir, 'yao-pkg patch')
      if (!success && !customPatches) {
        throw new Error('Failed to apply yao-pkg patch')
      }
      logger.info()
    } else {
      logger.warn(`⚠️  No yao-pkg patch found for ${nodeVersion}`)
      logger.warn('   The build may not work correctly with pkg')
      logger.info()
    }
  }

  // Apply custom patches
  if (customPatches) {
    await applyCustomPatches(nodeDir)
  }

  // Apply code modifications (V8 flags, node-gyp, etc.)
  if (!skipCodeMods) {
    await applyCodeModifications(nodeDir, nodeVersion)
  }

  // Configure
  await configureNode(nodeDir)
  logger.info()

  // Build
  await buildNode(nodeDir)
  logger.info()

  // Test the binary
  const binaryName = platform() === 'win32' ? 'node.exe' : 'node'
  const binaryPath = join(nodeDir, 'out', 'Release', binaryName)
  logger.success(' Testing binary...')

  const version = await execCapture(binaryPath, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' }
  })
  logger.info(`   Version: ${version}`)

  await exec(
    binaryPath,
    ['-e', 'console.log("Hello from custom Node.js!")'],
    { env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' } }
  )

  // Post-process
  await postProcessBinary(binaryPath)

  // Copy to pkg cache
  const cachePath = await copyToPkgCache(binaryPath, nodeVersion)

  // Summary
  logger.info()
  logger.info('='.repeat(50))
  logger.info('🎉 Build Complete!')
  logger.info('='.repeat(50))
  logger.info()
  logger.info(`📍 Binary location: ${binaryPath}`)
  logger.info(`📦 Pkg cache copy: ${cachePath}`)
  logger.info()
  logger.info('📝 To use with pkg:')
  logger.info('   1. Update .config/pkg.json:')
  logger.info(`      "node": "${binaryPath}"`)
  logger.info()
  logger.info('   2. Or use the cached version automatically')
  logger.info(`      The binary is available as: built-${nodeVersion}-${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`)
  logger.info()
  logger.info('🚀 Next steps:')
  logger.info('   node scripts/build.mjs --sea')
  logger.info()
}

// Run
main().catch(error => {
  logger.error()
  logger.error('❌ Build failed:', error.message)
  if (error.stack && process.env.DEBUG) {
    logger.error(error.stack)
  }
  process.exit(1)
})