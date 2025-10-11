/**
 * @fileoverview Node.js configuration and build utilities
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createBuildSpinner, createSimpleSpinner, exec, execCapture, execQuiet, logger } from './core.mjs'
import { downloadFile } from './download.mjs'

/**
 * Check if Visual Studio Build Tools are installed
 */
export async function checkVSBuildTools() {
  try {
    await execCapture('vswhere', ['-version', '[16.0,18.0)', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'])
    return true
  } catch {
    return false
  }
}

/**
 * Ensure Visual Studio Build Tools are installed
 */
export async function ensureVSBuildTools(buildDir) {
  if (await checkVSBuildTools()) {
    logger.success(' Visual Studio Build Tools found')
    return
  }

  logger.warn('  Visual Studio Build Tools not found')
  logger.log('   This is required to build Node.js on Windows')
  logger.log("")

  const vsbtDir = path.join(buildDir, 'vsbt')
  const installerPath = path.join(vsbtDir, 'vs_buildtools.exe')
  const vsbtUrl = 'https://aka.ms/vs/17/release/vs_buildtools.exe'

  logger.log('📥 Downloading Visual Studio Build Tools installer...')
  logger.log('   Note: This is a ~2MB bootstrapper that will download ~2GB during install')
  logger.log("")

  await fs.mkdir(vsbtDir, { recursive: true })

  if (!existsSync(installerPath)) {
    await downloadFile(vsbtUrl, installerPath)
    logger.success(' Installer downloaded')
  }

  const configPath = path.join(vsbtDir, 'install-config.json')
  const vsConfig = {
    version: '17.0',
    components: [
      "Microsoft.VisualStudio.Workload.VCTools",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "Microsoft.VisualStudio.Component.Windows11SDK.22000",
      "Microsoft.VisualStudio.Component.VC.CMake.Project"
    ]
  }

  await fs.writeFile(configPath, JSON.stringify(vsConfig, null, 2))

  logger.log('\n' + '='.repeat(60))
  logger.log('📝 MANUAL INSTALLATION REQUIRED')
  logger.log('='.repeat(60))
  logger.log("")
  logger.log('Visual Studio Build Tools must be installed manually.')
  logger.log("")
  logger.log('Option 1: Run the installer with recommended settings:')
  logger.log(`   ${installerPath}`)
  logger.log("")
  logger.log('Option 2: Silent install (run as Administrator):')
  logger.log(`   "${installerPath}" --quiet --wait --config "${configPath}"`)
  logger.log("")
  logger.log('Option 3: Download from:')
  logger.log('   https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022')
  logger.log("")
  logger.log('After installation, restart your terminal and run this script again.')
  logger.log('='.repeat(60))
  logger.log("")

  throw new Error('Visual Studio Build Tools required. Please install and try again.')
}

/**
 * Check if Python is available
 */
async function checkPython() {
  try {
    await execCapture('python3', ['--version'])
    return true
  } catch {
    try {
      await execCapture('python', ['--version'])
      return true
    } catch {
      return false
    }
  }
}

/**
 * Ensure Python is available
 */
export async function ensurePython(buildDir) {
  if (await checkPython()) {
    logger.success(' Python 3.x found')
    return
  }

  if (os.platform() === 'win32') {
    logger.warn('  Python 3.x not found')
    logger.log('   Downloading Python 3.x for Windows...')

    const pythonZip = 'python-3.11.9-embed-amd64.zip'
    const pythonUrl = `https://www.python.org/ftp/python/3.11.9/${pythonZip}`
    const pythonDir = path.join(buildDir, 'python-3x')
    const pythonExe = path.join(pythonDir, 'python.exe')

    if (!existsSync(pythonExe)) {
      const zipPath = path.join(buildDir, pythonZip)

      logger.log(`   Downloading from: ${pythonUrl}`)
      await downloadFile(pythonUrl, zipPath)

      logger.log('   Extracting Python...')
      await fs.mkdir(pythonDir, { recursive: true })

      try {
        await exec('powershell', [
          '-Command',
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${pythonDir}" -Force`
        ])
        logger.success(' Python extracted')
      } catch (error) {
        throw new Error(`Failed to extract Python: ${error.message}`)
      }
    }

    process.env.PATH = `${pythonDir};${process.env.PATH}`
    logger.success(' Python configured')
    return
  }

  throw new Error(
    'Python 3.x is required but not found. Please install Python 3.x from python.org'
  )
}

/**
 * Configure Node.js build
 */
export async function configureNode(nodeDir, buildConfig, options = {}) {
  logger.log('⚙️  Configuring Node.js build...')

  const configArgs = buildConfig.node?.build?.configureArgs || [
    '--without-intl',
    '--without-npm',
    '--without-corepack',
    '--without-inspector',
    '--without-amaro',
    '--without-sqlite',
    '--without-node-snapshot',
    '--without-node-code-cache',
  ]

  if (options.extraConfigArgs) {
    configArgs.push(...options.extraConfigArgs)
  }

  logger.log('   Configuration:')
  logger.log('   KEEP: WASM, SSL/crypto, JIT')
  logger.log('   REMOVE: ICU, npm, corepack, inspector, amaro, sqlite, snapshot, code cache')
  logger.log("")

  const configSpinner = createSimpleSpinner('Configuring build')
  configSpinner.start()

  try {
    if (os.platform() === 'win32') {
      const pythonCmd = existsSync('python3') ? 'python3' : 'python'
      await execQuiet(pythonCmd, ['configure', ...configArgs], { cwd: nodeDir })
    } else {
      await execQuiet('./configure', configArgs, { cwd: nodeDir })
    }

    configSpinner.stop(true)
  } catch (error) {
    configSpinner.stop(false)
    throw error
  }
}

/**
 * Build Node.js
 */
export async function buildNode(nodeDir) {
  const cpuCount = os.cpus().length

  logger.log('🏗️  Building Node.js...')
  logger.log(`   Using ${cpuCount} CPU cores`)
  logger.log('   Estimated time: 30-60 minutes (first build), 5-10 minutes (rebuilds)')
  logger.log("")

  const spinner = createBuildSpinner('Building Node.js')
  spinner.start()

  try {
    if (os.platform() === 'win32') {
      const vcxproj = path.join(nodeDir, 'node.vcxproj')
      if (!existsSync(vcxproj)) {
        spinner.stop(false)
        throw new Error('node.vcxproj not found. Did configure run successfully?')
      }

      try {
        await execQuiet('msbuild', [
          'node.vcxproj',
          '/p:Configuration=Release',
          `/p:Platform=${process.arch === 'x64' ? 'x64' : 'Win32'}`,
          `/maxcpucount:${cpuCount}`
        ], { cwd: nodeDir })
      } catch {
        await execQuiet('vcbuild.bat', ['release', process.arch], { cwd: nodeDir })
      }
    } else {
      await execQuiet('make', [`-j${cpuCount}`], { cwd: nodeDir })
    }

    spinner.stop(true)
  } catch (error) {
    spinner.stop(false)
    throw error
  }
}
