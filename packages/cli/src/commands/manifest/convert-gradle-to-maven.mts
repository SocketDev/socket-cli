import fs from 'node:fs'
import path from 'node:path'

import { getSpinner } from '@socketsecurity/lib/constants/process'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { distPath } from '../../constants/paths.mjs'

import type { ManifestResult } from './output-manifest.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function convertGradleToMaven({
  bin,
  cwd,
  gradleOpts,
  outputKind = 'text',
  verbose,
}: {
  bin: string
  cwd: string
  gradleOpts: string[]
  outputKind?: OutputKind | undefined
  verbose: boolean
}): Promise<CResult<ManifestResult>> {
  // Note: Resolve bin relative to cwd (or use absolute path if provided).
  // We don't resolve against $PATH since gradlew is typically a local wrapper script.
  // Users can provide absolute paths if they need to reference system-wide installations.
  const rBin = path.resolve(cwd, bin)
  const binExists = fs.existsSync(rBin)
  const cwdExists = fs.existsSync(cwd)

  // Only show logging in text mode.
  const isTextMode = outputKind === 'text'

  if (isTextMode) {
    getDefaultLogger().group('gradle2maven:')
    getDefaultLogger().info(`- executing: \`${rBin}\``)
    if (!binExists) {
      getDefaultLogger().warn(
        'Warning: It appears the executable could not be found. An error might be printed later because of that.',
      )
    }
    getDefaultLogger().info(`- src dir: \`${cwd}\``)
    if (!cwdExists) {
      getDefaultLogger().warn(
        'Warning: It appears the src dir could not be found. An error might be printed later because of that.',
      )
    }
    getDefaultLogger().groupEnd()
  }

  try {
    // Run gradlew with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    // Note: init.gradle will be exported by .config/rollup.cli-js.config.mjs
    const initLocation = path.join(distPath, 'init.gradle')
    const commandArgs = ['--init-script', initLocation, ...gradleOpts, 'pom']
    if (verbose && isTextMode) {
      getDefaultLogger().log(
        '[VERBOSE] Executing:',
        [bin],
        ', args:',
        commandArgs,
      )
    }
    if (isTextMode) {
      getDefaultLogger().log(
        `Converting gradle to maven from \`${bin}\` on \`${cwd}\` ...`,
      )
    }
    const output = await execGradleWithSpinner(
      rBin,
      commandArgs,
      cwd,
      isTextMode,
    )
    if (verbose && isTextMode) {
      getDefaultLogger().group('[VERBOSE] gradle stdout:')
      getDefaultLogger().log(output)
      getDefaultLogger().groupEnd()
    }
    if (output.code) {
      if (isTextMode) {
        process.exitCode = 1
        getDefaultLogger().fail(`Gradle exited with exit code ${output.code}`)
        // (In verbose mode, stderr was printed above, no need to repeat it)
        if (!verbose) {
          getDefaultLogger().group('stderr:')
          getDefaultLogger().error(output.stderr)
          getDefaultLogger().groupEnd()
        }
      }
      return {
        ok: false,
        code: output.code,
        message: `Gradle exited with exit code ${output.code}`,
        cause: output.stderr,
      }
    }

    // Extract file paths from output.
    const files: string[] = []
    output.stdout.replace(
      /^POM file copied to: (.*)/gm,
      (_all: string, fn: string) => {
        files.push(fn)
        if (isTextMode) {
          getDefaultLogger().log('- ', fn)
        }
        return fn
      },
    )

    if (isTextMode) {
      getDefaultLogger().success('Executed gradle successfully')
      getDefaultLogger().log('Reported exports:')
      files.forEach(fn => getDefaultLogger().log('- ', fn))
      getDefaultLogger().log('')
      getDefaultLogger().log(
        'Next step is to generate a Scan by running the `socket scan create` command on the same directory',
      )
    }

    return {
      ok: true,
      data: {
        files,
        type: 'gradle',
        success: true,
      },
    }
  } catch (e) {
    const errorMessage =
      'There was an unexpected error while generating manifests' +
      (verbose ? '' : '  (use --verbose for details)')

    if (isTextMode) {
      process.exitCode = 1
      getDefaultLogger().fail(errorMessage)
      if (verbose) {
        getDefaultLogger().group('[VERBOSE] error:')
        getDefaultLogger().log(e)
        getDefaultLogger().groupEnd()
      }
    }

    return {
      ok: false,
      message: errorMessage,
      cause: e instanceof Error ? e.message : String(e),
    }
  }
}

async function execGradleWithSpinner(
  bin: string,
  commandArgs: string[],
  cwd: string,
  showSpinner: boolean,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let pass = false
  const spinner = showSpinner ? getSpinner() : undefined
  try {
    if (showSpinner) {
      getDefaultLogger().info(
        '(Running gradle can take a while, it depends on how long gradlew has to run)',
      )
      getDefaultLogger().info(
        '(It will show no output, you can use --verbose to see its output)',
      )
      spinner?.start('Running gradlew...')
    }

    const output = await spawn(bin, commandArgs, {
      // We can pipe the output through to have the user see the result
      // of running gradlew, but then we can't (easily) gather the output
      // to discover the generated files... probably a flag we should allow?
      // stdio: isDebug() ? 'inherit' : undefined,
      cwd,
    })

    pass = true
    const { code, stderr, stdout } = output
    return {
      code,
      stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
      stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
    }
  } finally {
    if (pass) {
      spinner?.successAndStop('Gracefully completed gradlew execution.')
    } else {
      spinner?.failAndStop('There was an error while trying to run gradlew.')
    }
  }
}
