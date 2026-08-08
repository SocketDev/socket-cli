/**
 * Unit tests for the Maven extension build script's cache-root resolution.
 *
 * Purpose: build-jar.sh creates the Maven home up front, then runs Maven from
 * inside the extension directory. Those two steps must agree on which
 * directory they mean, so the resolved home has to be absolute before the cd.
 *
 * Related Files:
 * - src/commands/manifest/scripts/maven-extension/build-jar.sh (implementation)
 */

import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BUILD_JAR_PATH = path.join(
  __dirname,
  '../../../src/commands/manifest/scripts/maven-extension/build-jar.sh',
)

/**
 * The script's leading cache-root resolution, up to the subshell that invokes
 * Maven. Running just this part exercises the shipped lines without needing a
 * JDK, the Maven wrapper, or the network.
 */
function readResolutionPrelude(): string {
  const lines = readFileSync(BUILD_JAR_PATH, 'utf8').split(/\r?\n/)
  const subshellAt = lines.indexOf('(')
  if (subshellAt === -1) {
    throw new Error('build-jar.sh no longer opens a subshell with a bare "("')
  }
  return lines.slice(0, subshellAt).join('\n')
}

/**
 * Run the prelude with `cwd` as the working directory and report the
 * `maven_home` it settled on.
 */
async function resolveMavenHome(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const preludePath = path.join(cwd, 'prelude.sh')
  writeFileSync(
    preludePath,
    `${readResolutionPrelude()}\nprintf '%s\\n' "$maven_home"\n`,
  )

  const result = await spawn('bash', [preludePath], {
    cwd,
    env: { ...process.env, ...env },
  })
  return result.stdout.trim()
}

describe('maven-extension build-jar.sh cache root', () => {
  let workDir: string

  beforeEach(() => {
    workDir = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'build-jar-test-')),
    )
  })

  afterEach(async () => {
    await safeDelete(workDir)
  })

  it('anchors a relative SOCKET_CLI_MAVEN_HOME to the caller, not the extension directory', async () => {
    const mavenHome = await resolveMavenHome(workDir, {
      SOCKET_CLI_MAVEN_HOME: 'relative/maven-home',
    })

    // Absolute, so the cd into the extension directory cannot re-anchor it.
    expect(path.isAbsolute(mavenHome)).toBe(true)
    expect(realpathSync(mavenHome)).toBe(
      path.join(workDir, 'relative/maven-home'),
    )
    // The directory the script created is the one Maven will be pointed at.
    expect(statSync(mavenHome).isDirectory()).toBe(true)
  })

  it('anchors a relative TMPDIR to the caller', async () => {
    const mavenHome = await resolveMavenHome(workDir, {
      SOCKET_CLI_MAVEN_HOME: undefined,
      TMPDIR: 'relative-tmp',
    })

    expect(path.isAbsolute(mavenHome)).toBe(true)
    expect(realpathSync(mavenHome)).toBe(
      path.join(workDir, 'relative-tmp/socket-cli-maven-home'),
    )
  })

  it('leaves an absolute SOCKET_CLI_MAVEN_HOME alone', async () => {
    const absoluteHome = path.join(workDir, 'absolute/maven-home')

    const mavenHome = await resolveMavenHome(workDir, {
      SOCKET_CLI_MAVEN_HOME: absoluteHome,
    })

    expect(realpathSync(mavenHome)).toBe(absoluteHome)
  })
})
