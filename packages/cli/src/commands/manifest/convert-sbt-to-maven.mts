// CLI output formatting: multi-line user-facing messages where embedded \n
// produces the intended layout. Splitting into logger.log("") + logger.log(...)
// pairs is the canonical rewrite but doesnt preserve the visual flow for these
// specific outputs.
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- intended layout */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeReadFile } from '@socketsecurity/lib-stable/fs/read-file'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import {
  buildSystemToolEnv,
  describeSystemToolFailure,
  findSystemTool,
} from '../../util/spawn/system-tool.mts'

import type { ManifestResult } from './output-manifest.mts'
import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

/**
 * How to run sbt: the executable to spawn and, when it came from a trusted PATH
 * lookup, the environment the child is allowed to search.
 */
export type SbtExecutable = {
  executable: string
  environment: Record<string, string | undefined> | undefined
}

const SBT_INSTALL_HINT =
  'Install sbt outside the repository (`brew install sbt`, `apt install sbt`, or SDKMAN) and put its directory on PATH, or name one explicitly with `--bin <path>`.'

/**
 * `out` is a stdout switch, not a write destination: sbt writes the poms itself
 * and the only thing read from `out` is the `out === '-'` comparison below. It
 * needs no path containment check.
 */
export async function convertSbtToMaven({
  bin,
  cwd,
  out,
  outputKind = 'text',
  sbtOpts,
  verbose,
}: {
  bin: string
  cwd: string
  out: string
  outputKind?: OutputKind | undefined
  sbtOpts: string[]
  verbose: boolean
}): Promise<CResult<ManifestResult>> {
  const isTextMode = outputKind === 'text'

  const resolution = await resolveSbtExecutable(bin, cwd)
  if (!resolution.ok) {
    if (isTextMode) {
      process.exitCode = 1
      logger.fail(resolution.message)
    }
    return resolution
  }
  const { environment, executable } = resolution.data

  if (isTextMode) {
    logger.group('sbt2maven:')
    logger.info(`- executing: \`${executable}\``)
    logger.info(`- src dir: \`${cwd}\``)
    logger.groupEnd()
  }

  const spinner = isTextMode ? getDefaultSpinner() : undefined
  try {
    spinner?.start(
      `Converting sbt to maven from \`${executable}\` on \`${cwd}\`...`,
    )

    // Run sbt with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    const output = await spawn(executable, ['makePom', ...sbtOpts], {
      cwd,
      ...(environment ? { env: environment } : {}),
    })

    spinner?.stop()

    if (verbose && isTextMode) {
      logger.group('[VERBOSE] sbt stdout:')
      logger.log(output)
      logger.groupEnd()
    }
    if (output.stderr) {
      if (isTextMode) {
        process.exitCode = 1
        logger.fail('There were errors while running sbt')
        // In verbose mode, stderr was printed above, no need to repeat it
        if (!verbose) {
          logger.group('[VERBOSE] stderr:')
          logger.error(output.stderr)
          logger.groupEnd()
        }
      }
      return {
        ok: false,
        message: 'There were errors while running sbt',
        cause: output.stderr,
      }
    }
    const poms: string[] = []
    const stdoutStr = output.stdout
    stdoutStr.replace(/Wrote (.*?.pom)\n/g, (_all: string, fn: string) => {
      poms.push(fn)
      return fn
    })
    if (!poms.length) {
      const message =
        'There were no errors from sbt but it seems to not have generated any poms either'
      if (isTextMode) {
        process.exitCode = 1
        logger.fail(message)
      }
      return {
        ok: false,
        message,
      }
    }
    // Handle stdout output: Only supported for single file output.
    // Note: Multiple file stdout output could be supported in the future with separators
    // or a flag to select specific files, but currently errors out for clarity.
    if (out === '-' && poms.length === 1 && isTextMode) {
      logger.log('Result:\n```')
      logger.log(await safeReadFile(poms[0]!))
      logger.log('```')
      logger.success('OK')
    } else if (out === '-') {
      const message =
        'Requested output target was stdout but there are multiple generated files'
      if (isTextMode) {
        process.exitCode = 1
        logger.error('')
        logger.fail(message)
        logger.error('')
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- callback uses expression body
        poms.forEach(fn => logger.info('-', fn))
        if (poms.length > 10) {
          logger.error('')
          logger.fail(message)
        }
        logger.error('')
        logger.info('Exiting now…')
      }
      return {
        ok: false,
        message,
        data: { files: poms },
      }
    }

    if (out === '-') {
      return {
        ok: true,
        data: {
          files: poms,
          type: 'sbt',
          success: true,
        },
      }
    }

    // sbt writes poms inside each project's `target/` directory, which is
    // typically gitignored. Copy them out to a sibling of `target/` so
    // downstream SBOM/scan steps see them.
    const copied: string[] = []
    const outBasename = path.basename(out) || 'pom.xml'
    for (let i = 0, { length } = poms; i < length; i += 1) {
      const pomPath = poms[i]!
      let destPath: string
      if (poms.length === 1 && out !== outBasename) {
        // Honor the full `--out` path verbatim when exactly one pom was
        // produced and the user (or default) supplied a path, not just a
        // bare filename.
        destPath = path.resolve(cwd, out)
      } else {
        const projectRoot = findProjectRootAboveTarget(pomPath)
        if (!projectRoot) {
          if (isTextMode) {
            logger.warn(
              `Could not locate \`target/\` ancestor for \`${pomPath}\`, leaving in place`,
            )
          }
          copied.push(pomPath)
          continue
        }
        destPath = path.join(projectRoot, outBasename)
      }
      try {
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.copyFile(pomPath, destPath)
        copied.push(destPath)
      } catch (e) {
        if (isTextMode) {
          logger.warn(
            `Failed to copy \`${pomPath}\` to \`${destPath}\`: ${errorMessage(e)}`,
          )
        }
      }
    }

    if (isTextMode) {
      logger.success(
        `Generated ${copied.length} pom file${copied.length === 1 ? '' : 's'}`,
      )
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- callback uses expression body
      copied.forEach(fn => logger.log('-', fn))
      logger.success('OK')
    }

    return {
      ok: true,
      data: {
        files: copied,
        type: 'sbt',
        success: true,
      },
    }
  } catch (e) {
    const summary =
      'There was an unexpected error while running this' +
      (verbose ? '' : ' (use --verbose for details)')

    if (isTextMode) {
      process.exitCode = 1
      spinner?.stop()
      logger.fail(summary)
      if (verbose) {
        logger.group('[VERBOSE] error:')
        logger.log(e)
        logger.groupEnd()
      }
    }

    return {
      ok: false,
      message: summary,
      cause: errorMessage(e),
    }
  }
}

/**
 * Walk up from a pom path to find a `target` directory ancestor and return
 * its parent (the project root). Returns undefined if no `target` ancestor
 * is found, which means the file cannot safely be lifted out of the ignored
 * build dir.
 */
export function findProjectRootAboveTarget(
  pomPath: string,
): string | undefined {
  let dir = path.dirname(pomPath)
  const { root } = path.parse(dir)
  while (dir !== root) {
    if (path.basename(dir) === 'target') {
      return path.dirname(dir)
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * Decide which sbt binary to spawn.
 *
 * A bare `sbt` is a PATH lookup, and the CLI runs with its working directory
 * inside a checkout that can seed PATH with its own directories, so the bare
 * form goes through the trusted lookup and the child inherits the sanitized
 * PATH. A `bin` carrying a path separator was named by the operator — `--bin`,
 * or a `--trust-socket-json` run — and is spawned as written.
 *
 * Unlike gradle, sbt has no project-local wrapper convention: the conventional
 * invocation is the system install, so strict resolution matches the normal
 * workflow rather than fighting it.
 */
export async function resolveSbtExecutable(
  bin: string,
  cwd: string,
): Promise<CResult<SbtExecutable>> {
  if (bin.includes('/') || bin.includes('\\')) {
    return { ok: true, data: { environment: undefined, executable: bin } }
  }
  const resolution = await findSystemTool(bin, { cwd })
  if (!resolution) {
    return {
      ok: false,
      message: `Could not resolve the \`${bin}\` executable`,
      cause: await describeSystemToolFailure(bin, {
        cwd,
        installHint: SBT_INSTALL_HINT,
      }),
    }
  }
  return {
    ok: true,
    data: {
      environment: buildSystemToolEnv(process.env, resolution.searchPath),
      executable: resolution.executable,
    },
  }
}
