/** @fileoverview CycloneDX cdxgen runner for Socket CLI. Executes cdxgen SBOM generator via npx. Converts yarn.lock to package-lock.json using synp for better accuracy. Applies Socket secure defaults for lifecycle and output. */

import { existsSync } from 'node:fs'
import path from 'node:path'

import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import { removeSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_HELP, YARN } from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { runShadowCommand } from '../../utils/shadow-runner.mts'

import type { ShadowBinResult } from '../../shadow/npm/bin.mts'
import type { ChildProcess } from 'node:child_process'

const { PACKAGE_LOCK_JSON, YARN_LOCK } = constants

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  'npm',
  'pnpm',
  'ts',
  'tsx',
  'typescript',
])

function hasArg(args: readonly string[], ...flags: string[]): boolean {
  return flags.some(flag => args.includes(flag))
}

function getArgValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag)
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]
  }
  // Check for --flag=value format.
  const prefix = `${flag}=`
  const arg = args.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : undefined
}

export async function runCdxgen(
  args: readonly string[],
): Promise<ShadowBinResult> {
  const argsMutable = [...args]

  // Detect lockfiles for synp conversion.
  const npmLockPath = await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })

  const yarnLockPath = npmLockPath
    ? undefined
    : await findUp(YARN_LOCK, { onlyFiles: true })

  const typeValue =
    getArgValue(argsMutable, '--type') || getArgValue(argsMutable, '-t')

  let cleanupPackageLock = false
  if (
    yarnLockPath &&
    typeValue !== YARN &&
    (!typeValue || nodejsPlatformTypes.has(typeValue))
  ) {
    if (!npmLockPath) {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        const synpVersion = constants.ENV['INLINED_SOCKET_CLI_SYNP_VERSION']
        const synpPackageSpec = `synp@${synpVersion}`

        await runShadowCommand(
          synpPackageSpec,
          ['--source-file', `./${YARN_LOCK}`],
          {
            ipc: {
              [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
              [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
                constants.SOCKET_PUBLIC_API_TOKEN,
              [constants.SOCKET_CLI_SHADOW_SILENT]: true,
            },
            stdio: 'inherit',
          },
        )

        cleanupPackageLock = true
      } catch {}
    }
  }

  // Apply Socket secure defaults when not requesting help/version.
  const isHelpRequest = hasArg(argsMutable, FLAG_HELP, '-h', '--version', '-v')
  if (!isHelpRequest) {
    // Set lifecycle to 'pre-build' to avoid arbitrary code execution.
    // https://github.com/CycloneDX/cdxgen/issues/1328
    if (!hasArg(argsMutable, '--lifecycle')) {
      argsMutable.push('--lifecycle', 'pre-build')
      argsMutable.push('--no-install-deps')
      logger.info(
        `Setting cdxgen --lifecycle to "pre-build" to avoid arbitrary code execution on this scan.\n  Pass "--lifecycle build" to generate a BOM consisting of information obtained during the build process.\n  See cdxgen ${terminalLink(
          'BOM lifecycles documentation',
          'https://cyclonedx.github.io/cdxgen/#/ADVANCED?id=bom-lifecycles',
        )} for more details.\n`,
      )
    }

    // Set default output filename.
    if (!hasArg(argsMutable, '--output', '-o')) {
      argsMutable.push('--output', 'socket-cdx.json')
    }
  }

  // Run cdxgen via npx.
  const cdxgenVersion =
    constants.ENV['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION']
  const cdxgenPackageSpec = `@cyclonedx/cdxgen@${cdxgenVersion}`

  const result = await runShadowCommand(cdxgenPackageSpec, argsMutable, {
    ipc: {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
    },
    stdio: 'inherit',
  })

  // Create fake ShadowBinResult for backward compatibility.
  // Note: Help/version requests should always exit with code 0.
  const exitCode = result.ok || isHelpRequest ? 0 : (result.code ?? 1)
  const stdioResult = {
    cmd: 'cdxgen',
    args: [] as const,
    code: exitCode,
    signal: null,
    stderr: Buffer.from(''),
    stdout: Buffer.from(result.ok ? result.data : ''),
  }

  // Create a mock ChildProcess with event emitter methods for backward compatibility.
  // The ShadowBinResult interface expects a ChildProcess, but runShadowCommand doesn't
  // return one. This mock provides the minimum EventEmitter interface needed by callers
  // while maintaining API compatibility. Each method returns 'this' to support chaining.
  const mockProcess = {
    on: () => mockProcess,
    once: () => mockProcess,
    off: () => mockProcess,
    removeListener: () => mockProcess,
  } as unknown as ChildProcess

  const shadowResult: ShadowBinResult = {
    spawnPromise: Object.assign(Promise.resolve(stdioResult), {
      process: mockProcess,
      stdin: null,
    }),
  }

  // Handle cleanup on process exit.
  if (cleanupPackageLock) {
    try {
      // This removes the temporary package-lock.json we created for cdxgen.
      removeSync(`./${PACKAGE_LOCK_JSON}`)
    } catch {}
  }

  const outputPath =
    getArgValue(argsMutable, '--output') || getArgValue(argsMutable, '-o')
  if (outputPath) {
    const fullOutputPath = path.join(process.cwd(), outputPath)
    if (existsSync(fullOutputPath)) {
      logger.log(colors.cyanBright(`${outputPath} created!`))
    }
  }

  return shadowResult
}
