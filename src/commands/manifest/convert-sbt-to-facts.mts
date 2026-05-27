import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

// Shown when the sbt launcher dies on a modern JDK. sbt 0.13 (and some early
// 1.x) install a SecurityManager, which JDK 18+ removed, so the launcher
// throws before our plugin runs. We don't pick a JDK for the user — they own
// their toolchain — but we point them at the fix.
const JDK_HINT =
  'Hint: old sbt (0.13.x and early 1.x) cannot run on modern JDKs because the Java Security Manager was removed in JDK 18+. Run with a compatible JDK by setting JAVA_HOME (e.g. Java 11) or passing `--sbt-opts "--java-home <path>"`.'

// The socket-owned global base sbt compiles our plugin into. Living under the
// app data dir (not the user's `~/.sbt`) means we never mutate their sbt
// config, while persisting the compiled plugin between runs. sbt namespaces
// the compiled output by Scala/sbt version (`target/scala-2.10/sbt-0.13`,
// `target/scala-2.12/sbt-1.0`, ...), so a single base safely serves every sbt
// version with no version detection needed.
function resolveGlobalBase(): string {
  const { socketAppDataPath } = constants
  return socketAppDataPath
    ? path.join(path.dirname(socketAppDataPath), 'sbt-facts')
    : path.join(os.tmpdir(), 'socket-sbt-facts')
}

// Drop the shipped plugin source into `<globalBase>/plugins/`, rewriting only
// when its content changed so sbt's incremental compiler can reuse the cache.
async function ensurePluginSource(
  pluginSrcPath: string,
  pluginsDir: string,
): Promise<void> {
  const source = await fs.readFile(pluginSrcPath, 'utf8')
  const destPath = path.join(pluginsDir, 'SocketFactsPlugin.scala')
  let current: string | undefined
  if (existsSync(destPath)) {
    current = await fs.readFile(destPath, 'utf8')
  }
  if (current !== source) {
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(destPath, source, 'utf8')
  }
}

export async function convertSbtToFacts({
  bin,
  configs,
  cwd,
  ignoreUnresolved,
  sbtOpts,
  verbose,
}: {
  bin: string
  configs: string
  cwd: string
  ignoreUnresolved: boolean
  sbtOpts: string[]
  verbose: boolean
}): Promise<void> {
  logger.group('sbt2facts:')
  logger.info(`- executing: \`${bin}\``)
  logger.info(`- src dir: \`${cwd}\``)
  if (!existsSync(cwd)) {
    logger.warn(
      'Warning: It appears the src dir could not be found. An error might be printed later because of that.',
    )
  }
  logger.groupEnd()

  try {
    const pluginSrcPath = path.join(
      constants.distPath,
      'socket-facts.plugin.scala',
    )
    const globalBase = resolveGlobalBase()
    await ensurePluginSource(pluginSrcPath, path.join(globalBase, 'plugins'))

    // `-Dsbt.global.base` points sbt at our isolated plugins dir, so the
    // source-only plugin activates without touching the user's `~/.sbt`. The
    // resolution options are passed as JVM system properties the plugin reads.
    const socketProps: string[] = []
    if (ignoreUnresolved) {
      socketProps.push('-Dsocket.ignoreUnresolved=true')
    }
    if (configs) {
      socketProps.push(`-Dsocket.configs=${configs}`)
    }
    const commandArgs = [
      `-Dsbt.global.base=${globalBase}`,
      ...socketProps,
      ...sbtOpts,
      '--batch',
      'socketFacts',
    ]
    if (verbose) {
      logger.log('[VERBOSE] Executing:', [bin], ', args:', commandArgs)
    }
    logger.log(`Generating Socket facts from \`${bin}\` on \`${cwd}\` ...`)

    const output = await execSbt(bin, commandArgs, cwd, verbose)
    if (output.code) {
      process.exitCode = 1
      logger.fail(`sbt exited with exit code ${output.code}`)
      if (!verbose) {
        const errorLines = extractErrorLines(output.stdout, output.stderr)
        if (errorLines) {
          logger.group('sbt output:')
          logger.error(errorLines)
          logger.groupEnd()
        }
      }
      if (/security ?manager/i.test(output.stdout + output.stderr)) {
        logger.warn(JDK_HINT)
      }
      return
    }
    logger.success('Executed sbt successfully')
    if (verbose) {
      // Output already streamed inline; nothing to re-summarize.
      logger.log('')
      logger.log(
        'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
      )
      return
    }
    // `spawn` already strips ANSI from captured output, and the plugin prints
    // these lines bare (via println, no sbt `[info]` prefix), so plain line
    // matching is stable.
    const exports: string[] = []
    for (const m of output.stdout.matchAll(
      /Socket facts file written to: (.+)/g,
    )) {
      const reported = m[1]?.trim()
      if (reported) {
        exports.push(reported)
      }
    }
    if (exports.length) {
      logger.log('Reported exports:')
      for (const fn of exports) {
        logger.log('- ', fn)
      }
    } else {
      // The plugin skips emission when the build has no resolvable deps.
      const skipMatch = output.stdout.match(
        /\[socket-facts\] no resolvable dependencies.*/,
      )
      if (skipMatch) {
        logger.warn(skipMatch[0])
      }
    }
    logger.log('')
    logger.log(
      'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
    )
  } catch (e) {
    process.exitCode = 1
    // A missing sbt launcher is the most common setup failure; surface it
    // clearly instead of the generic message.
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.fail(
        `Could not run \`${bin}\`. Make sure sbt is installed and on your PATH, or pass --bin with the path to your sbt launcher.`,
      )
    } else {
      logger.fail(
        'There was an unexpected error while generating Socket facts' +
          (verbose ? '' : '  (use --verbose for details)'),
      )
    }
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
  }
}

// Pull the actionable lines out of a noisy sbt run so a failure surfaces the
// plugin's own message (and sbt's `[error]` lines) without dumping the whole
// resolution log.
function extractErrorLines(stdout: string, stderr: string): string {
  return `${stdout}\n${stderr}`
    .split('\n')
    .filter(line =>
      /\[error]|Socket facts|could not resolve|unresolved/i.test(line),
    )
    .join('\n')
    .trim()
}

async function execSbt(
  bin: string,
  commandArgs: string[],
  cwd: string,
  verbose: boolean,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // When verbose, stream sbt output straight to the terminal so the user can
  // watch resolution progress; otherwise show a spinner and capture output for
  // the post-run summary.
  if (verbose) {
    logger.info('(Running sbt with output streaming. This can take a while.)')
    const output = await spawn(bin, commandArgs, { cwd, stdio: 'inherit' })
    return { code: output.code, stdout: '', stderr: '' }
  }

  const { spinner } = constants
  let pass = false
  try {
    logger.info(
      '(Running sbt can take a while, depending on the size of the project)',
    )
    logger.info(
      '(No live output. Pass --verbose to stream sbt output instead.)',
    )
    spinner.start('Running sbt...')
    const output = await spawn(bin, commandArgs, { cwd })
    pass = true
    const { code, stderr, stdout } = output
    return { code, stdout, stderr }
  } finally {
    if (pass) {
      spinner.successAndStop('Gracefully completed sbt execution.')
    } else {
      spinner.failAndStop('There was an error while trying to run sbt.')
    }
  }
}
